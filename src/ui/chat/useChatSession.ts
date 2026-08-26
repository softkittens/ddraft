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
  zoomToFit,
  activePage,
  setAgentRunning,
  beginEdit,
  endEdit
} from "../store";
import { snapshotPositions, trackLayoutTransitionsFromSnapshot } from "../../interaction/animate";
import { noteAgentEdits, clearAgentEditTargets, diffChangedNodeIds } from "../canvas/workingFrames";
import type { Message } from "../../agent/provider";
import type { PublicProvider } from "../../agent/credentials";
import type { Document } from "../../model/types";
import { decideAgentDocument } from "../agentDocument";
import { parseChoice, choiceValue } from "../ModelSelector";
import { defaultEffortForModelChoice } from "../../agent/catalog";
import { captureDocumentPng } from "../../render/capture";
import {
  applyReviewMessage,
  enforceAuditFindings,
  type ReviewResponse
} from "../../agent/review";
import { digest } from "../../digest/digest";
import { resolvePromptContext } from "../../agent/context";
import { pageScopedDocument } from "../../model/pages";
import { currentDirection } from "../../design/styleSystem";
import { STYLE_METADATA_KEY } from "../../design/styleKeys";
import { loadHistory, recordRun, saveHistory } from "../../design/history";
import { auditDocument, formatAuditForCritic } from "../../design/evaluator";
import { flushSession } from "../persist";
import {
  type Entry,
  type PendingStep,
  AUTO_REVIEW_REVISIONS,
  modelLabel,
  createThumbnail,
  commitAgentPass
} from "./types";
import { fetchAgentStatus, streamAgentRun, fetchAgentReview, authenticateAccessCode } from "./chatClient";
import { reviewLoopNext } from "./reviewLoop";

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

/**
 * Every user turn so far, joined — the same text the server builds the system
 * prompt from, so the context the critic is handed matches the one the builder
 * was given rather than being re-derived from the last sentence alone.
 */
function sessionTextOf(messages: Message[]): string {
  const texts: string[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string" && m.content.trim()) {
      texts.push(m.content.trim());
    } else if (Array.isArray(m.content)) {
      const text = m.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join(" ");
      if (text) texts.push(text);
    }
  }
  return texts.join(" ");
}

function rememberStyle(doc: Document, brief: string) {
  const recorded = doc.metadata?.[STYLE_METADATA_KEY] as
    | { composition?: unknown; palette?: unknown; headings?: unknown; elevation?: unknown; roundness?: unknown }
    | undefined;
  const { composition, palette, headings, elevation, roundness } = recorded ?? {};
  if (typeof palette !== "string" || typeof headings !== "string" || typeof elevation !== "string") {
    return;
  }
  const history = loadHistory();
  const direction = currentDirection(doc);
  saveHistory(recordRun(history, {
    at: new Date().toISOString(),
    brief,
    composition: typeof composition === "string" ? composition : undefined,
    palette,
    headings,
    elevation,
    roundness: typeof roundness === "string" ? roundness : undefined,
    thesis: direction?.thesis,
    firstViewport: direction?.firstViewport
  }));
}

export function useChatSession() {
  const [configured, setConfigured] = createSignal(false);
  const [providers, setProviders] = createSignal<PublicProvider[]>([]);
  const [requiresAccessCode, setRequiresAccessCode] = createSignal(false);
  const [authenticated, setAuthenticated] = createSignal(true);
  const saved = restoredChat();
  const defaultChoice = choiceValue("vercel", "gpt-5.6-luna");
  const initialChoice =
    (typeof localStorage !== "undefined" && localStorage.getItem("ddraft_selected_model")) ||
    saved?.choice ||
    defaultChoice;
  const [choice, setChoice] = createSignal(initialChoice);

  const initialEffort =
    (typeof localStorage !== "undefined" && (localStorage.getItem("ddraft_selected_effort") as "low" | "medium" | "high")) ||
    saved?.effort ||
    defaultEffortForModelChoice(initialChoice);
  const [effort, setEffort] = createSignal<"low" | "medium" | "high">(initialEffort);

  const handleChoiceChange = (newChoice: string) => {
    setChoice(newChoice);
    setEffort(defaultEffortForModelChoice(newChoice));
  };

  const [entries, setEntries] = createSignal<Entry[]>(saved?.entries ?? []);
  const [agentMessages, setAgentMessages] = createSignal<Message[]>(saved?.agentMessages ?? []);
  const [inputPrompt, setInputPrompt] = createSignal("");
  const [running, setRunning] = createSignal(false);
  const [streamText, setStreamText] = createSignal("");
  const [streamReasoning, setStreamReasoning] = createSignal("");
  const [lastBrief, setLastBrief] = createSignal(saved?.lastBrief ?? "");
  const [pending, setPending] = createSignal<PendingStep | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = createSignal(0);

  createEffect(() => {
    setAgentRunning(running());
  });

  createEffect(() => {
    if (!running()) {
      setElapsedSeconds(0);
      return;
    }
    const start = Date.now();
    setElapsedSeconds(0);
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 250);
    onCleanup(() => clearInterval(interval));
  });

  // The transcript is saved with the canvas it describes.
  createEffect(
    on([entries, agentMessages, lastBrief, choice, effort], ([e, messages, brief, c, eff]) => {
      persistChat({ entries: e, agentMessages: messages, lastBrief: brief, choice: c, effort: eff });
      if (typeof localStorage !== "undefined") {
        if (c) localStorage.setItem("ddraft_selected_model", c);
        if (eff) localStorage.setItem("ddraft_selected_effort", eff);
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
      setElapsedSeconds(0);
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
    const savedModel =
      typeof localStorage !== "undefined" ? localStorage.getItem("ddraft_selected_model") : null;
    if (savedModel && list.includes(savedModel)) {
      setChoice(savedModel);
    } else if (list.includes(defaultChoice)) {
      setChoice(defaultChoice);
    } else {
      setChoice(list[0]);
    }
  });

  const unlockWithCode = async (code: string): Promise<boolean> => {
    const success = await authenticateAccessCode(code);
    if (success) {
      const status = await fetchAgentStatus();
      setProviders(status.providers);
      setConfigured(status.configured);
      setRequiresAccessCode(status.requiresAccessCode === true);
      setAuthenticated(true);
      return true;
    }
    return false;
  };

  onMount(async () => {
    const status = await fetchAgentStatus();
    setProviders(status.providers);
    setConfigured(status.configured);
    setRequiresAccessCode(status.requiresAccessCode === true);
    setAuthenticated(status.authenticated !== false);
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

  async function runAgentPass(
    text: string,
    context: Message[],
    sessionId: string,
    pageId: string | undefined,
    opts: { visibleInput?: boolean } = {}
  ) {
    const visibleInput = opts.visibleInput ?? true;
    const next: Message[] = [...context, { role: "user", content: text }];
    const visibleBase = entries();
    if (visibleInput) {
      setEntries([...visibleBase, { kind: "message", message: { role: "user", content: text } }]);
    }

    const controller = new AbortController();
    abort = controller;
    const selected = parseChoice(choice());
    let expectedDoc = doc();
    let edited = false;
    let finished = false;
    let failure: string | undefined;
    let finalMessages = next;
    const toolsCalled: string[] = [];

    try {
      const stream = streamAgentRun(
        {
          messages: next,
          doc: expectedDoc,
          selection: Array.from(selectedIds()),
          pageId,
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
            toolsCalled.push(event.name);
            setStreamReasoning("");
            setStreamText("");
            setPending(null);
            assembled = "";
            setEntries((prev) => [
              ...prev,
              { kind: "message", message: { role: "tool", content: event.result }, tool: event.name }
            ]);
            const decision = decideAgentDocument(doc(), expectedDoc, event.doc);
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
            finished = true;
            finalMessages = event.messages.filter((m) => m.role !== "system");
            setEntries((live) =>
              commitAgentPass({
                live,
                visibleBase,
                finalMessages,
                contextLength: context.length,
                visibleInput
              })
            );
            setSelectedIds((prev) => {
              const nextSel = new Set<string>();
              const valid = nodeMap();
              for (const id of prev) if (valid.has(id)) nextSel.add(id);
              return nextSel;
            });
            break;
          case "error":
            failure = event.message;
            if (event.messages && event.messages.length > 0) {
              finalMessages = event.messages.filter((m) => m.role !== "system");
            }
            setPending(null);
            setStreamReasoning("");
            setStreamText("");
            note(event.message, event.code === "budget" ? "budget" : "error");
            break;
        }
      }
    } catch (err) {
      if (!isAbortError(err)) {
        failure = err instanceof Error ? err.message : String(err);
        setStreamReasoning("");
        setStreamText("");
        note(failure, "error");
      }
    } finally {
      setPending(null);
      if (abort === controller) abort = null;
    }

    return { finished, edited, messages: finalMessages, failure, toolsCalled };
  }

  async function runReview(sessionId: string | undefined, _focusedNodeIds: string[] | undefined, pageId: string | undefined): Promise<{
    review?: ReviewResponse;
    thumbnail?: string;
    sectionThumbnails?: { name: string; url: string }[];
    error?: string;
  }> {
    zoomToFit({ animate: true });
    const selected = parseChoice(choice());
    reviewAbort?.abort();
    reviewAbort = new AbortController();
    const seq = ++reviewSeq;
    const signal = reviewAbort.signal;
    const captured = doc();
    const pageDoc = pageScopedDocument(captured, pageId);

    setPending({ label: "Rendering the mockup", icon: "review" });
    const capture = await captureDocumentPng(captured, pageId);
    if (seq !== reviewSeq || doc() !== captured) return {};
    if (!capture.ok) return { error: "the canvas could not be captured" };

    setPending({
      label: "Sending the mockup for review",
      detail: selected ? modelLabel(providers(), selected.providerId, selected.model) : undefined,
      icon: "review"
    });

    try {
      const allScreens = capture.screens.map((s) => ({
        id: s.id,
        name: s.name,
        dataUrl: s.dataUrl,
        kind: s.kind,
        parentId: s.parentId
      }));

      // Send full representative evidence on every review so the critic evaluates the whole canvas
      const screensToSend = allScreens;

      const review = await fetchAgentReview(
        {
          providerId: selected?.providerId,
          model: selected?.model,
          reasoningEffort: effort(),
          brief: lastBrief(),
          screenshot: capture.dataUrl,
          screenshots: screensToSend,
          digest: digest(pageDoc),
          audit: formatAuditForCritic(auditDocument(pageDoc)),
          pageId,
          context: resolvePromptContext(lastBrief(), pageDoc, [...selectedIds()], sessionTextOf(agentMessages())),
          sessionId
        },
        signal
      );
      if (seq !== reviewSeq || doc() !== captured) return {};
      const thumbSrc = screensToSend[0]?.dataUrl || capture.screens[0]?.dataUrl || capture.dataUrl;
      const sectionThumbnails: { name: string; url: string }[] = [];
      for (const s of screensToSend) {
        if (s.kind === "section" || s.kind === "viewport") {
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
        thumbnail: thumbSrc ? await createThumbnail(thumbSrc) : undefined,
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
    let producedDesign = false;
    let targetedNodes: string[] | undefined;
    const sessionId = crypto.randomUUID();
    const targetPageId = activePage()?.id;

    const initialScreenCount = doc().children.length;
    beginEdit();

    try {
      let reviewNumber = 0;
      for (let pass = 0; pass <= AUTO_REVIEW_REVISIONS; pass++) {
        const passContext = pass === 0 ? context : [];
        const result = await runAgentPass(instruction, passContext, sessionId, targetPageId, {
          visibleInput: pass === 0
        });
        if (pass === 0) {
          context = result.messages;
          setAgentMessages(context);
        } else if (result.finished) {
          const closing = [...result.messages].reverse().find(
            (m: Message) => m.role === "assistant" && typeof m.content === "string" && m.content.trim().length > 0
          );
          if (closing) {
            context = [...context, closing];
            setAgentMessages(context);
          }
        }

        if (result.failure) {
          if (result.messages && result.messages.length > 0) {
            context = result.messages;
            setAgentMessages(context);
          }
          break;
        }
        if (!result.finished || !result.edited) break;

        const isInitialBuildOrRedesign =
          initialScreenCount === 0 ||
          result.toolsCalled.includes("create_screen") ||
          result.toolsCalled.includes("set_style") ||
          /\b(review|audit|critique|redesign)\b/i.test(text);

        if (!isInitialBuildOrRedesign) {
          break;
        }
        producedDesign = true;

        if (pass >= AUTO_REVIEW_REVISIONS) {
          break;
        }

        const reviewed = await runReview(sessionId, targetedNodes, targetPageId);
        if (reviewed.error) {
          note(`Visual review could not run: ${reviewed.error}`, "error");
          break;
        }
        if (!reviewed.review) break;

        const finalReview = enforceAuditFindings(
          reviewed.review,
          auditDocument(pageScopedDocument(doc(), targetPageId))
        );

        reviewNumber += 1;
        setEntries((prev) => [
          ...prev,
          {
            kind: "review",
            pass: reviewNumber,
            review: finalReview,
            thumbnail: reviewed.thumbnail,
            sectionThumbnails: reviewed.sectionThumbnails
          }
        ]);

        const next = reviewLoopNext({
          pass,
          maxRevisions: AUTO_REVIEW_REVISIONS,
          verdict: finalReview.verdict,
          hasReview: true
        });
        if (next === "stop") {
          if (finalReview.verdict === "refine") {
            setEntries((prev) => [
              ...prev,
              {
                kind: "message",
                message: {
                  role: "assistant",
                  content: "Auto-review has reached its limit of 3 revisions and some visual refinement items remain. Would you like me to continue the auto-review process?"
                }
              }
            ]);
          }
          break;
        }

        targetedNodes = finalReview.issues.flatMap((iss) => iss.nodeIds || []);
        instruction = applyReviewMessage(lastBrief(), finalReview, doc());
        continue;
      }
    } finally {
      endEdit();
      abort = null;
      setPending(null);
      setStreamReasoning("");
      setStreamText("");
      setRunning(false);
      clearAgentEditTargets();
      // Only a turn that actually built something is a design run. Recording
      // every turn let a conversational reply, a failed run, or a one-property
      // tweak evict real runs from a five-entry history and attach the existing
      // style to a brief that never asked for it.
      if (producedDesign) rememberStyle(doc(), text);
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
    setElapsedSeconds(0);
    clearAgentEditTargets();
    persistChat({ entries: [], agentMessages: [], lastBrief: "" });
    void flushSession();
  };

  return {
    configured,
    providers,
    requiresAccessCode,
    authenticated,
    unlockWithCode,
    choice,
    setChoice: handleChoiceChange,
    effort,
    setEffort,
    entries,
    running,
    elapsedSeconds,
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
