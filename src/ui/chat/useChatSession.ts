import { createSignal, createMemo, createEffect, on, onMount, onCleanup } from "solid-js";
import {
  selectedIds,
  setSelectedIds,
  nodeMap,
  doc,
  updateDoc,
  layoutTree,
  setChatExpanded,
  restoredChat,
  resetToken,
  persistChat,
  zoomToFit
} from "../store";
import { snapshotPositions, trackLayoutTransitionsFromSnapshot } from "../../interaction/animate";
import { noteAgentEdits, clearAgentEditTargets, diffChangedNodeIds } from "../canvas/workingFrames";
import type { Message } from "../../agent/provider";
import type { PublicProvider } from "../../agent/credentials";
import type { Document } from "../../model/types";
import { decideAgentDocument } from "../agentDocument";
import { parseChoice, choiceValue } from "../ModelSelector";
import { captureDocumentPng } from "../../render/capture";
import { applyReviewFixes, applyReviewMessage, enforceAuditFindings, type ReviewResponse } from "../../agent/review";
import { digest } from "../../digest/digest";
import { currentDirection } from "../../design/styleSystem";
import { STYLE_METADATA_KEY } from "../../design/styleKeys";
import { loadHistory, recordRun, saveHistory } from "../../design/history";
import { auditDocument, formatAudit } from "../../design/evaluator";
import { flushSession } from "../persist";
import {
  type Entry,
  type PendingStep,
  AUTO_REVIEW_REVISIONS,
  modelLabel,
  createThumbnail,
  commitAgentPass
} from "./types";
import { fetchAgentStatus, streamAgentRun, fetchAgentReview } from "./chatClient";

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

let hasAutoFitInitial = false;

function applyCanvasUpdate(nextDoc: Document) {
  const oldMap = nodeMap();
  const oldPositions = snapshotPositions(layoutTree());
  updateDoc(nextDoc);
  trackLayoutTransitionsFromSnapshot(oldPositions, layoutTree(), 320);
  noteAgentEdits(diffChangedNodeIds(oldMap, nodeMap()), layoutTree());

  if (!hasAutoFitInitial && oldMap.size <= 1 && nextDoc.children.length > 0) {
    hasAutoFitInitial = true;
    setTimeout(() => {
      zoomToFit({ animate: true });
    }, 80);
  }
}

function rememberStyle(doc: Document, brief: string) {
  const recorded = doc.metadata?.[STYLE_METADATA_KEY] as
    | { palette?: unknown; headings?: unknown; elevation?: unknown }
    | undefined;
  const { palette, headings, elevation } = recorded ?? {};
  if (typeof palette !== "string" || typeof headings !== "string" || typeof elevation !== "string") {
    return;
  }
  const history = loadHistory();
  const last = history[history.length - 1];
  if (last?.palette === palette && last?.brief === brief) return;
  saveHistory(recordRun(history, { at: new Date().toISOString(), brief, palette, headings, elevation }));
}

export function useChatSession() {
  const [configured, setConfigured] = createSignal(false);
  const [providers, setProviders] = createSignal<PublicProvider[]>([]);
  const saved = restoredChat();
  const defaultChoice = choiceValue("vercel", "gpt-5.6-luna");
  const initialChoice =
    (typeof localStorage !== "undefined" && localStorage.getItem("pen_selected_model")) ||
    saved?.choice ||
    defaultChoice;
  const [choice, setChoice] = createSignal(initialChoice);

  const initialEffort =
    (typeof localStorage !== "undefined" && (localStorage.getItem("pen_selected_effort") as "low" | "medium" | "high")) ||
    saved?.effort ||
    "high";
  const [effort, setEffort] = createSignal<"low" | "medium" | "high">(initialEffort);

  const [entries, setEntries] = createSignal<Entry[]>(saved?.entries ?? []);
  const [agentMessages, setAgentMessages] = createSignal<Message[]>(saved?.agentMessages ?? []);
  const [inputPrompt, setInputPrompt] = createSignal("");
  const [running, setRunning] = createSignal(false);
  const [streamText, setStreamText] = createSignal("");
  const [streamReasoning, setStreamReasoning] = createSignal("");
  const [lastBrief, setLastBrief] = createSignal(saved?.lastBrief ?? "");
  const [pending, setPending] = createSignal<PendingStep | null>(null);

  // The transcript is saved with the canvas it describes.
  createEffect(
    on([entries, agentMessages, lastBrief, choice, effort], ([e, messages, brief, c, eff]) => {
      persistChat({ entries: e, agentMessages: messages, lastBrief: brief, choice: c, effort: eff });
      if (typeof localStorage !== "undefined") {
        if (c) localStorage.setItem("pen_selected_model", c);
        if (eff) localStorage.setItem("pen_selected_effort", eff);
      }
    }, { defer: true })
  );

  // Clearing the canvas clears the conversation about it — every node id in
  // those messages now refers to something that does not exist.
  createEffect(
    on(resetToken, () => {
      abort?.abort();
      reviewAbort?.abort();
      setEntries([]);
      setAgentMessages([]);
      setLastBrief("");
      setStreamText("");
      setStreamReasoning("");
      setPending(null);
      setRunning(false);
      clearAgentEditTargets();
    }, { defer: true })
  );

  let abort: AbortController | null = null;
  let reviewAbort: AbortController | null = null;
  let reviewSeq = 0;

  const note = (text: string, tone: "info" | "error" | "budget" = "info") =>
    setEntries((prev) => [...prev, { kind: "note", text, tone }]);

  const activeContextName = createMemo(() => {
    const ids = Array.from(selectedIds());
    const node = ids.length > 0 ? nodeMap().get(ids[0]) : null;
    if (!node) {
      const firstChild = doc().children[0];
      return firstChild?.name || firstChild?.id || "Full Canvas";
    }
    return node.name || node.id;
  });

  const choices = createMemo(() =>
    providers().flatMap((p) => p.models.map((m) => choiceValue(p.id, m.id)))
  );

  createEffect(() => {
    const list = choices();
    if (list.length === 0) return;
    const current = choice();
    if (list.includes(current)) return;
    const savedModel = typeof localStorage !== "undefined" ? localStorage.getItem("pen_selected_model") : null;
    if (savedModel && list.includes(savedModel)) {
      setChoice(savedModel);
    } else if (list.includes(defaultChoice)) {
      setChoice(defaultChoice);
    } else {
      setChoice(list[0]);
    }
  });

  onMount(async () => {
    const status = await fetchAgentStatus();
    setProviders(status.providers);
    setConfigured(status.configured);
  });

  createEffect(
    on(resetToken, () => {
      hasAutoFitInitial = false;
    })
  );

  onCleanup(() => {
    abort?.abort();
    reviewAbort?.abort();
  });

  function stop() {
    abort?.abort();
    reviewAbort?.abort();
    void flushSession();
  }

  async function runAgentPass(text: string, context: Message[], sessionId: string) {
    const next: Message[] = [...context, { role: "user", content: text }];
    const visibleBase = entries();
    setEntries([...visibleBase, { kind: "message", message: { role: "user", content: text } }]);

    const controller = new AbortController();
    abort = controller;
    const selected = parseChoice(choice());
    let expectedDoc = doc();
    let finished = false;
    let edited = false;
    let finalMessages = next;
    let failure: string | undefined;

    try {
      const stream = streamAgentRun(
        {
          messages: next,
          doc: expectedDoc,
          selection: Array.from(selectedIds()),
          providerId: selected?.providerId,
          model: selected?.model,
          reasoningEffort: effort(),
          recentStyles: loadHistory(),
          sessionId
        },
        controller.signal
      );

      let assembled = "";
      let reasoning = "";

      for await (const event of stream) {
        switch (event.type) {
          case "status":
            reasoning = "";
            setStreamReasoning("");
            setStreamText(event.content);
            break;
          case "reasoning":
            reasoning += event.content;
            setStreamReasoning(reasoning);
            break;
          case "delta":
            assembled += event.content;
            setStreamText(assembled);
            break;
          case "tool_start":
            setStreamReasoning("");
            setStreamText("");
            setPending(
              event.name === "generate_image"
                ? { label: "Generating image", detail: event.detail, icon: "image" }
                : { label: event.name, detail: event.detail, icon: "tool" }
            );
            break;
          case "tool":
            setStreamReasoning("");
            setStreamText("");
            setPending(null);
            assembled = "";
            setEntries((prev) => [
              ...prev,
              { kind: "message", message: { role: "tool", content: event.result }, tool: event.name }
            ]);
            const decision = decideAgentDocument(doc(), expectedDoc, event.doc);
            if (decision.action === "abort") {
              controller.abort();
              failure = "The canvas changed, so the agent stopped before overwriting it.";
              note(failure, "error");
              return { finished, edited, messages: finalMessages, failure };
            }
            if (decision.action === "accept") {
              edited = true;
              expectedDoc = decision.expected;
              applyCanvasUpdate(decision.expected);
            }
            break;
          case "done":
            setStreamReasoning("");
            setStreamText("");
            setPending(null);
            finalMessages = event.messages.filter((m) => m.role !== "system");
            setEntries((live) =>
              commitAgentPass({
                live,
                visibleBase,
                finalMessages,
                contextLength: context.length
              })
            );
            setSelectedIds((prev) => {
              const nextSel = new Set<string>();
              const valid = nodeMap();
              for (const id of prev) if (valid.has(id)) nextSel.add(id);
              return nextSel;
            });
            finished = true;
            if (context.length <= 1 && edited) {
              setTimeout(() => {
                zoomToFit({ animate: true });
              }, 120);
            }
            break;
          case "error":
            failure = event.message;
            setPending(null);
            note(event.message, event.code === "budget" ? "budget" : "error");
            break;
        }
      }
    } catch (err) {
      if (!isAbortError(err)) {
        failure = err instanceof Error ? err.message : String(err);
        note(failure, "error");
      }
    } finally {
      setPending(null);
      if (abort === controller) abort = null;
    }

    return { finished, edited, messages: finalMessages, failure };
  }

  async function runReview(
    sessionId: string
  ): Promise<{
    review?: ReviewResponse;
    error?: string;
    thumbnail?: string;
    sectionThumbnails?: { name: string; url: string }[];
  }> {
    const selected = parseChoice(choice());
    reviewAbort?.abort();
    reviewAbort = new AbortController();
    const seq = ++reviewSeq;
    const signal = reviewAbort.signal;
    const captured = doc();

    setPending({ label: "Rendering the mockup", icon: "review" });
    const capture = await captureDocumentPng(captured);
    if (seq !== reviewSeq || doc() !== captured) return {};
    if (!capture.ok) return { error: "the canvas could not be captured" };

    setPending({
      label: "Sending the mockup for review",
      detail: selected ? modelLabel(providers(), selected.providerId, selected.model) : undefined,
      icon: "review"
    });

    try {
      const review = await fetchAgentReview(
        {
          providerId: selected?.providerId,
          model: selected?.model,
          reasoningEffort: effort(),
          brief: lastBrief(),
          screenshot: capture.dataUrl,
          screenshots: capture.screens.map((s) => ({
            id: s.id,
            name: s.name,
            dataUrl: s.dataUrl,
            kind: s.kind,
            parentId: s.parentId
          })),
          digest: digest(captured),
          direction: currentDirection(captured),
          audit: formatAudit(auditDocument(captured), "Measured design audit"),
          sessionId
        },
        signal
      );
      if (seq !== reviewSeq || doc() !== captured) return {};
      const thumbSrc = capture.screens[0]?.dataUrl || capture.dataUrl;
      const sectionThumbnails: { name: string; url: string }[] = [];
      for (const s of capture.screens) {
        if (s.kind === "section") {
          const thumb = await createThumbnail(s.dataUrl);
          if (thumb) {
            sectionThumbnails.push({
              name: s.name,
              url: thumb
            });
          }
        }
      }
      return {
        review,
        thumbnail: await createThumbnail(thumbSrc),
        sectionThumbnails
      };
    } catch (err) {
      if (signal.aborted) return {};
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      setPending(null);
    }
  }

  async function sendText(text: string) {
    if (!text || !configured() || running()) return;
    setChatExpanded(true);
    setLastBrief(text);
    setInputPrompt("");
    setStreamText("");
    setRunning(true);
    reviewAbort?.abort();
    reviewSeq += 1;

    let instruction = text;
    let context = agentMessages();
    const sessionId = crypto.randomUUID();

    try {
      for (let pass = 0; pass <= AUTO_REVIEW_REVISIONS; pass++) {
        const result = await runAgentPass(instruction, context, sessionId);
        context = result.messages;
        setAgentMessages(context);

        if (result.failure) break;
        if (!result.finished || !result.edited) break;

        const reviewed = await runReview(sessionId);
        if (reviewed.error) {
          note(`Visual review could not run: ${reviewed.error}`, "error");
          break;
        }
        if (!reviewed.review) break;
        const review = enforceAuditFindings(reviewed.review, auditDocument(doc()));

        const beforeFixes = doc();
        const fixed = applyReviewFixes(beforeFixes, review);
        if (fixed.applied.length > 0 && doc() === beforeFixes) {
          applyCanvasUpdate(fixed.doc);
        }

        setEntries((prev) => [
          ...prev,
          {
            kind: "review",
            pass: pass + 1,
            review,
            applied: fixed.applied.length,
            thumbnail: reviewed.thumbnail,
            sectionThumbnails: reviewed.sectionThumbnails
          }
        ]);

        if (review.verdict !== "refine" || pass === AUTO_REVIEW_REVISIONS) break;
        instruction = applyReviewMessage(lastBrief(), review, doc());
      }
    } finally {
      abort = null;
      setPending(null);
      setRunning(false);
      clearAgentEditTargets();
      rememberStyle(doc(), text);
      void flushSession();
    }
  }

  const clearChat = () => {
    abort?.abort();
    reviewAbort?.abort();
    setEntries([]);
    setAgentMessages([]);
    setLastBrief("");
    setStreamText("");
    setStreamReasoning("");
    setPending(null);
    setRunning(false);
    clearAgentEditTargets();
    persistChat({ entries: [], agentMessages: [], lastBrief: "" });
    void flushSession();
  };

  return {
    configured,
    providers,
    choice,
    setChoice,
    effort,
    setEffort,
    entries,
    running,
    streamText,
    streamReasoning,
    pending,
    inputPrompt,
    setInputPrompt,
    activeContextName,
    send: () => sendText(inputPrompt().trim()),
    sendText,
    stop,
    clearChat
  };
}
