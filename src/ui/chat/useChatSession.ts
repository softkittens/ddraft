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
  activePage
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
  applyReviewFixes,
  applyReviewMessage,
  enforceAuditFindings,
  enforceRejectedFixes,
  type DesignReview,
  type ReviewResponse
} from "../../agent/review";
import { digest } from "../../digest/digest";
import { resolvePromptContext } from "../../agent/context";
import { pageScopedDocument } from "../../model/pages";
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
import { fetchAgentStatus, streamAgentRun, fetchAgentReview, authenticateAccessCode } from "./chatClient";
import { reviewLoopNext } from "./reviewLoop";

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

let hasAutoFitInitial = false;
const MAX_POST_FIX_REVIEWS = 1;

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
    | { palette?: unknown; headings?: unknown; elevation?: unknown; roundness?: unknown }
    | undefined;
  const { palette, headings, elevation, roundness } = recorded ?? {};
  if (typeof palette !== "string" || typeof headings !== "string" || typeof elevation !== "string") {
    return;
  }
  const history = loadHistory();
  const direction = currentDirection(doc);
  saveHistory(recordRun(history, {
    at: new Date().toISOString(),
    brief,
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

  async function runAgentPass(text: string, context: Message[], sessionId: string) {
    const next: Message[] = [...context, { role: "user", content: text }];
    const visibleBase = entries();
    setEntries([...visibleBase, { kind: "message", message: { role: "user", content: text } }]);

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
          pageId: activePage()?.id,
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
            if (decision.action === "abort") {
              controller.abort();
              failure = "The canvas changed, so the agent stopped before overwriting it.";
              note(failure, "error");
              return { finished, edited, messages: finalMessages, failure, toolsCalled };
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
            break;
          case "error":
            failure = event.message;
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

  async function runReview(
    sessionId: string
  ): Promise<{
    review?: ReviewResponse;
    error?: string;
    thumbnail?: string;
    sectionThumbnails?: { name: string; url: string }[];
  }> {
    zoomToFit({ animate: true });
    const selected = parseChoice(choice());
    reviewAbort?.abort();
    reviewAbort = new AbortController();
    const seq = ++reviewSeq;
    const signal = reviewAbort.signal;
    const captured = doc();
    // Pinned once for the whole review: the screenshots, the digest, the audit
    // and the resolved context all have to describe the same page, and the
    // user can switch pages while the request is in flight.
    const capturedPage = activePage()?.id;
    const pageDoc = pageScopedDocument(captured, capturedPage);

    setPending({ label: "Rendering the mockup", icon: "review" });
    const capture = await captureDocumentPng(captured, capturedPage);
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
          digest: digest(pageDoc),
          direction: currentDirection(captured),
          audit: formatAudit(auditDocument(pageDoc), "Measured design audit"),
          pageId: capturedPage,
          // The server sees only the brief. Without this the critic re-resolves
          // from that one string and can judge a mobile app against dashboard
          // criteria the builder never received.
          context: resolvePromptContext(lastBrief(), pageDoc, [...selectedIds()], sessionTextOf(agentMessages())),
          sessionId
        },
        signal
      );
      if (seq !== reviewSeq || doc() !== captured) return {};
      const thumbSrc = capture.screens[0]?.dataUrl || capture.dataUrl;
      const sectionThumbnails: { name: string; url: string }[] = [];
      for (const s of capture.screens) {
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
    let producedDesign = false;
    const sessionId = crypto.randomUUID();

    const initialScreenCount = doc().children.length;

    try {
      let reviewNumber = 0;
      for (let pass = 0; pass <= AUTO_REVIEW_REVISIONS; pass++) {
        const result = await runAgentPass(instruction, context, sessionId);
        context = result.messages;
        setAgentMessages(context);

        if (result.failure) break;
        if (!result.finished || !result.edited) break;
        producedDesign = true;

        // Action-based decision: Only run visual review for major changes (empty canvas build, new screen created, or set_style called)
        const isMajorDesignChange =
          initialScreenCount === 0 ||
          result.toolsCalled.includes("create_screen") ||
          result.toolsCalled.includes("set_style");

        if (!isMajorDesignChange) {
          break;
        }

        let reviewed = await runReview(sessionId);
        if (reviewed.error) {
          note(`Visual review could not run: ${reviewed.error}`, "error");
          break;
        }
        if (!reviewed.review) break;

        let finalReview: DesignReview | undefined;
        /*
         * True when the loop stopped at its budget with fixes freshly applied.
         *
         * At that point the canvas on screen is one the critic never saw: it
         * reviewed A, its fixes produced B, and the budget ran out before B
         * could be looked at. Printing A's verdict there is how "pass" came to
         * mean "an earlier version of this passed".
         */
        let fixesAwaitingReview = false;
        for (let fixReview = 0; fixReview <= MAX_POST_FIX_REVIEWS; fixReview++) {
          const measuredReview = enforceAuditFindings(reviewed.review, auditDocument(pageScopedDocument(doc(), activePage()?.id)));
          const beforeFixes = doc();
          const fixed = applyReviewFixes(beforeFixes, measuredReview);
          if (fixed.applied.length > 0 && doc() === beforeFixes) {
            applyCanvasUpdate(fixed.doc);
          }

          const displayedReview = enforceRejectedFixes(measuredReview, fixed.rejected);
          finalReview = displayedReview;
          reviewNumber += 1;
          setEntries((prev) => [
            ...prev,
            {
              kind: "review",
              pass: reviewNumber,
              review: displayedReview,
              applied: fixed.applied.length,
              thumbnail: reviewed.thumbnail,
              sectionThumbnails: reviewed.sectionThumbnails
            }
          ]);

          // Rejected fixes need coordinated agent work. Accepted fixes need a
          // fresh screenshot review; a verdict about the pre-fix canvas is not
          // evidence that the changed canvas passes.
          if (
            fixed.rejected.length > 0 ||
            fixed.applied.length === 0 ||
            fixReview === MAX_POST_FIX_REVIEWS
          ) {
            fixesAwaitingReview =
              fixed.applied.length > 0 && fixed.rejected.length === 0 && fixReview === MAX_POST_FIX_REVIEWS;
            break;
          }

          reviewed = await runReview(sessionId);
          if (reviewed.error) {
            note(`Post-fix visual review could not run: ${reviewed.error}`, "error");
            break;
          }
          if (!reviewed.review) {
            break;
          }
        }

        if (!finalReview) break;

        // One confirming look at the canvas the user is actually left with. Its
        // fixes are not applied — the fix budget is spent — so what it reports
        // is what is on screen. If it finds something, the outer pass hands it
        // to the agent like any other refine.
        if (fixesAwaitingReview) {
          const confirmed = await runReview(sessionId);
          if (!confirmed.error && confirmed.review) {
            const confirmedReview = enforceAuditFindings(confirmed.review, auditDocument(pageScopedDocument(doc(), activePage()?.id)));
            finalReview = confirmedReview;
            reviewNumber += 1;
            setEntries((prev) => [
              ...prev,
              {
                kind: "review",
                pass: reviewNumber,
                review: confirmedReview,
                applied: 0,
                thumbnail: confirmed.thumbnail,
                sectionThumbnails: confirmed.sectionThumbnails
              }
            ]);
          } else if (confirmed.error) {
            note(`Final visual review could not run: ${confirmed.error}`, "error");
          }
        }

        const next = reviewLoopNext({
          pass,
          maxRevisions: AUTO_REVIEW_REVISIONS,
          verdict: finalReview.verdict,
          hasReview: true
        });
        switch (next) {
          case "stop":
            break;
          case "revise":
            instruction = applyReviewMessage(lastBrief(), finalReview, doc());
            continue;
          case "apply_last": {
            instruction = applyReviewMessage(lastBrief(), finalReview, doc());
            const last = await runAgentPass(instruction, context, sessionId);
            context = last.messages;
            setAgentMessages(context);
            if (last.edited) producedDesign = true;
            break;
          }
          default: {
            const _exhaustive: never = next;
            void _exhaustive;
            break;
          }
        }
        break;
      }
    } finally {
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
