import { Component, For, Show, createMemo, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import {
  Sparkles,
  Minus,
  Maximize2,
  X,
  Radio,
  Square,
  ArrowUp,
  Wrench,
  Layers,
  Bot,
  Eye,
  ImagePlus,
  Loader
} from "lucide-solid";
import {
  chatVisible,
  setChatVisible,
  chatExpanded,
  setChatExpanded,
  selectedIds,
  setSelectedIds,
  nodeMap,
  doc,
  updateDoc,
  layoutTree
} from "./store";
import { snapshotPositions, trackLayoutTransitionsFromSnapshot } from "../interaction/animate";
import type { Message, MessageContent } from "../agent/provider";
import { parseSseData } from "../agent/stream";
import type { AgentEvent } from "../agent/session";
import { decideAgentDocument } from "./agentDocument";
import type { PublicProvider } from "../agent/credentials";
import type { Document } from "../model/types";
import { ModelSelector, parseChoice, choiceValue } from "./ModelSelector";
import { captureDocumentPng } from "../render/capture";
import { applyReviewFixes, applyReviewMessage, type ReviewResponse } from "../agent/review";
import { digest } from "../digest/digest";
import { EXAMPLE_PROMPTS } from "./examplePrompts";
import { currentDirection } from "../design/styleSystem";
import { STYLE_METADATA_KEY } from "../design/styleKeys";
import { loadHistory, recordRun, saveHistory } from "../design/history";
import { auditDocument, formatAudit } from "../design/evaluator";

const SETUP =
  "No provider key found. Add OPENAI_API_KEY, OPENCODE_GO_API_KEY, GEMINI_API_KEY, or DASHSCOPE_API_KEY to your .env file and restart. Keys stay on your local agent server.";
const AUTO_REVIEW_REVISIONS = 2;

/**
 * Name the tool a result came from.
 * Resolves tool name from the preceding assistant message's tool_calls.
 */
function toolLabel(messages: Message[], index: number): string {
  const id = messages[index]?.tool_call_id;
  if (!id) return "tool";
  for (let i = index - 1; i >= 0; i--) {
    const call = messages[i].tool_calls?.find((c) => c.id === id);
    if (call?.function.name) return call.function.name;
  }
  return id.startsWith("call_") || id.startsWith("chatcmpl") ? "tool" : id;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * One row of the panel.
 *
 * The agent transcript is Message[], but the panel also has to show things that
 * never reach the model: which model read the screenshot, what it scored, what
 * it corrected without spending a model turn. Those had nowhere to live, so the
 * panel printed a summary and then sat silent for the minutes the review and
 * its revision passes took.
 */
type Entry =
  | { kind: "message"; message: Message; tool?: string }
  | {
      kind: "review";
      pass: number;
      review: ReviewResponse;
      applied: number;
      /** The frame the critic was actually shown, small enough to keep around. */
      thumbnail?: string;
    }
  /**
   * A line from the run itself. "budget" is its own tone because a run that
   * spends its rounds is not a failure: it was announced, the canvas is kept,
   * and asking again continues from there. Rendering it as a red Provider
   * Notice said the opposite about the one thing that had gone right.
   */
  | { kind: "note"; text: string; tone: "info" | "error" | "budget" };

const THUMBNAIL_WIDTH = 320;

/**
 * Shrink the capture down to something the transcript can hold.
 *
 * The card shows what the critic saw, which is the only way to tell a critique
 * that missed something from one that was shown something else. The capture
 * itself runs to megabytes, and two of them per send would accumulate for the
 * life of the session, so what is kept is a thumbnail and not the evidence
 * frame that went to the model.
 */
async function thumbnail(dataUrl: string): Promise<string | undefined> {
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = dataUrl;
    });
    const scale = Math.min(1, THUMBNAIL_WIDTH / Math.max(image.width, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    // A missing thumbnail costs a picture, not a review.
    return undefined;
  }
}

function toEntries(messages: Message[]): Entry[] {
  return messages.map((message, i) => ({
    kind: "message" as const,
    message,
    tool: message.role === "tool" ? toolLabel(messages, i) : undefined
  }));
}

/**
 * What the panel calls a model.
 *
 * Read out of the /agent/status reply rather than the provider catalog: the
 * server already sent every label the picker needs, and importing the catalog
 * here would ship five providers' endpoints to the browser to spell one name.
 */
function modelLabel(providers: PublicProvider[], providerId: string | undefined, model: string): string {
  const spec = providers.find((p) => p.id === providerId);
  return spec?.models.find((m) => m.id === model)?.label ?? model;
}

/**
 * What the critic saw, and who saw it.
 *
 * The review used to leave no trace at all: fixes appeared on the canvas, a
 * revision pass ran for minutes, and the transcript showed a summary followed
 * by nothing. The card is the receipt — the verdict, the scores, the number of
 * corrections applied without a model turn, and the model that actually read
 * the screenshot when it was not the one drawing.
 */
const ReviewCard: Component<{
  entry: Extract<Entry, { kind: "review" }>;
  providers: PublicProvider[];
}> = (props) => {
  const review = () => props.entry.review;
  const by = () => review().reviewedBy;
  const scores = () => Object.entries(review().scores) as [string, number][];

  return (
    <div class="mr-auto w-full max-w-[96%] rounded-xl border border-indigo-200/70 bg-indigo-50/40 text-xs shadow-2xs overflow-hidden">
      <div class="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-indigo-200/60 bg-indigo-50/70">
        <Eye size={11} class="text-indigo-500 shrink-0" />
        <span class="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
          Visual review {props.entry.pass}
        </span>
        <span
          class={`ml-auto text-[9px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
            review().verdict === "pass"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {review().verdict}
        </span>
      </div>

      <div class="px-2.5 py-2 space-y-1.5">
        <Show when={props.entry.thumbnail}>
          {(src) => (
            <img
              src={src()}
              alt="The mockup the critic was shown"
              class="w-full max-h-44 object-contain rounded-md border border-indigo-200/60 bg-white"
            />
          )}
        </Show>

        <Show when={by()}>
          {(who) => (
            <div class="text-[10px] text-indigo-900/70 leading-relaxed">
              Read by <span class="font-medium">{modelLabel(props.providers, who().providerId, who().model)}</span>
              <Show when={who().handoff}>
                {(why) => <span class="opacity-70"> — {why()}</span>}
              </Show>
            </div>
          )}
        </Show>

        <div class="flex flex-wrap gap-1">
          <For each={scores()}>
            {([name, value]) => (
              <span class="rounded bg-white/80 border border-indigo-200/60 px-1.5 py-0.5 text-[10px] text-indigo-900">
                {name} <span class="font-semibold">{value}</span>/5
              </span>
            )}
          </For>
        </div>

        <Show when={props.entry.applied > 0}>
          <div class="text-[10px] text-indigo-900/70">
            {props.entry.applied} propert{props.entry.applied === 1 ? "y" : "ies"} corrected directly.
          </div>
        </Show>

        <Show when={review().issues.length > 0}>
          <ul class="space-y-1 pt-0.5">
            <For each={review().issues}>
              {(issue) => (
                <li class="text-[11px] text-neutral-700 leading-relaxed">
                  <span class="font-medium text-neutral-900">{issue.title}</span>
                  <span class="opacity-70"> — {issue.instruction}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
};

export const ChatPanel: Component = () => {
  const [configured, setConfigured] = createSignal(false);
  const [providers, setProviders] = createSignal<PublicProvider[]>([]);
  const [choice, setChoice] = createSignal(choiceValue("opencode-go", "gpt-5.6-luna"));
  const [effort, setEffort] = createSignal<"low" | "medium" | "high">("high");
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [agentMessages, setAgentMessages] = createSignal<Message[]>([]);
  const [inputPrompt, setInputPrompt] = createSignal("");
  const [running, setRunning] = createSignal(false);
  const [streamText, setStreamText] = createSignal("");
  const [expandedTools, setExpandedTools] = createSignal<Set<number>>(new Set());
  const [lastBrief, setLastBrief] = createSignal("");
  /** The step in flight, cleared the moment it produces a row of its own. */
  const [pending, setPending] = createSignal<{ label: string; detail?: string; icon: "tool" | "image" | "review" } | null>(null);

  const note = (text: string, tone: "info" | "error" | "budget" = "info") =>
    setEntries((prev) => [...prev, { kind: "note", text, tone }]);

  function renderMessageText(content: MessageContent | unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((p) => (typeof p === "object" && p && "type" in p && p.type === "text" ? p.text : ""))
        .join(" ");
    }
    return String(content ?? "");
  }

  /**
   * Text that belongs to the model and not to the reader. The revision brief is
   * one of these: the review card above it already says what the critic asked
   * for, and reprinting the instruction as a user bubble reads as though the
   * person typed it.
   */
  function isInternalMessage(content: MessageContent | unknown): boolean {
    const text = renderMessageText(content).trim();
    return text.startsWith("[IMAGE_PREVIEW]") || text.startsWith("[Visual review revision]");
  }

  const toggleTool = (idx: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  let abort: AbortController | null = null;
  let reviewAbort: AbortController | null = null;
  let reviewSeq = 0;
  let messagesContainerRef: HTMLDivElement | undefined;

  const activeContextName = createMemo(() => {
    const ids = Array.from(selectedIds());
    const node = ids.length > 0 ? nodeMap().get(ids[0]) : null;
    if (!node) {
      const firstChild = doc().children[0];
      return firstChild?.name || firstChild?.id || "Full Canvas";
    }
    return node.name || node.id;
  });

  async function refreshStatus() {
    try {
      const res = await fetch("/agent/status");
      const body = (await res.json()) as { configured?: boolean; providers?: PublicProvider[] };
      const list = body.providers ?? [];
      setProviders(list);
      setConfigured(body.configured === true && list.length > 0);
    } catch {
      setProviders([]);
      setConfigured(false);
    }
  }

  const choices = createMemo(() =>
    providers().flatMap((p) => p.models.map((m) => choiceValue(p.id, m.id)))
  );

  createEffect(() => {
    const list = choices();
    if (list.length === 0) return;
    if (!list.includes(choice())) setChoice(list[0]);
  });

  const scrollToBottom = () => {
    if (messagesContainerRef) {
      messagesContainerRef.scrollTop = messagesContainerRef.scrollHeight;
    }
  };

  createEffect(() => {
    entries();
    streamText();
    pending();
    scrollToBottom();
  });

  onMount(() => {
    void refreshStatus();
  });
  onCleanup(() => {
    abort?.abort();
    reviewAbort?.abort();
  });

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

    const applyIncoming = (incoming: Document | undefined): boolean => {
      const decision = decideAgentDocument(doc(), expectedDoc, incoming);
      if (decision.action === "abort") {
        controller.abort();
        failure = "The canvas changed, so the agent stopped before overwriting it.";
        note(failure, "error");
        return false;
      }
      if (decision.action === "accept") {
        edited = true;
        expectedDoc = decision.expected;
        const oldPositions = snapshotPositions(layoutTree());
        updateDoc(decision.expected);
        trackLayoutTransitionsFromSnapshot(oldPositions, layoutTree(), 320);
      }
      return true;
    };

    try {
      const res = await fetch("/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          doc: expectedDoc,
          selection: Array.from(selectedIds()),
          providerId: selected?.providerId,
          model: selected?.model,
          reasoningEffort: effort(),
          recentStyles: loadHistory(),
          sessionId
        }),
        signal: controller.signal
      });

      if (!res.ok || !res.body) {
        let errMessage = SETUP;
        try {
          const errJson = await res.json();
          if (errJson?.error) errMessage = errJson.error;
          else if (errJson?.message) errMessage = errJson.message;
        } catch {
          if (res.status !== 503) {
            errMessage = `Server error (${res.status}: ${res.statusText || "Request failed"})`;
          }
        }
        failure = errMessage;
        note(errMessage, "error");
        return { finished, edited, messages: finalMessages, failure };
      }

      let assembled = "";
      let reasoning = "";
      for await (const data of parseSseData(res.body)) {
        const event = JSON.parse(data) as AgentEvent;
        switch (event.type) {
          case "status":
            reasoning = "";
            setStreamText(event.content);
            break;
          case "reasoning":
            reasoning += event.content;
            setStreamText(reasoning);
            break;
          case "delta":
            assembled += event.content;
            setStreamText(assembled);
            break;
          case "tool_start":
            setStreamText("");
            setPending(
              event.name === "generate_image"
                ? { label: "Generating image", detail: event.detail, icon: "image" }
                : { label: event.name, detail: event.detail, icon: "tool" }
            );
            break;
          case "tool":
            setStreamText("");
            setPending(null);
            assembled = "";
            setEntries((prev) => [
              ...prev,
              { kind: "message", message: { role: "tool", content: event.result }, tool: event.name }
            ]);
            if (!applyIncoming(event.doc)) {
              return { finished, edited, messages: finalMessages, failure };
            }
            break;
          case "done":
            setStreamText("");
            setPending(null);
            finalMessages = event.messages.filter((m) => m.role !== "system");
            setEntries([...visibleBase, ...toEntries(finalMessages).slice(context.length)]);
            setSelectedIds((prev) => {
              const nextSel = new Set<string>();
              const valid = nodeMap();
              for (const id of prev) {
                if (valid.has(id)) nextSel.add(id);
              }
              return nextSel;
            });
            finished = true;
            break;
          case "error":
            failure = event.message;
            setPending(null);
            note(event.message, event.code === "budget" ? "budget" : "error");
            break;
          default: {
            const _never: never = event;
            void _never;
          }
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
        if (!result.finished || !result.edited || pass === AUTO_REVIEW_REVISIONS) break;

        const reviewed = await runReview(sessionId);
        if (reviewed.error) {
          note(`Visual review could not run: ${reviewed.error}`, "error");
          break;
        }
        const review = reviewed.review;
        if (!review) break;

        // Property corrections land here, not in another model round. The
        // critic already decided the node and the value; sending that back as
        // prose asks a model to re-derive a change we are holding.
        const beforeFixes = doc();
        const fixed = applyReviewFixes(beforeFixes, review);
        if (fixed.applied.length > 0 && doc() === beforeFixes) {
          const oldPositions = snapshotPositions(layoutTree());
          updateDoc(fixed.doc);
          trackLayoutTransitionsFromSnapshot(oldPositions, layoutTree(), 320);
        }
        setEntries((prev) => [
          ...prev,
          {
            kind: "review",
            pass: pass + 1,
            review,
            applied: fixed.applied.length,
            thumbnail: reviewed.thumbnail
          }
        ]);

        if (review.verdict !== "refine" || review.issues.length === 0) break;
        instruction = applyReviewMessage(lastBrief(), review, doc());
      }
    } finally {
      abort = null;
      setPending(null);
      setRunning(false);
      rememberStyle(text);
    }
  }

  /**
   * Record what this run settled on. Read after the run rather than from the
   * set_style call, so a style the model chose and then replaced is not
   * remembered as one it used.
   *
   * Read straight off the metadata: resolving it through currentStyle would
   * drag all fifty-eight palettes into the browser bundle for three strings.
   */
  function rememberStyle(brief: string) {
    const recorded = doc().metadata?.[STYLE_METADATA_KEY] as
      | { palette?: unknown; headings?: unknown; elevation?: unknown }
      | undefined;
    const palette = recorded?.palette;
    const headings = recorded?.headings;
    const elevation = recorded?.elevation;
    if (typeof palette !== "string" || typeof headings !== "string" || typeof elevation !== "string") {
      return;
    }
    const history = loadHistory();
    const last = history[history.length - 1];
    if (last?.palette === palette && last?.brief === brief) return;
    saveHistory(recordRun(history, {
      at: new Date().toISOString(), brief, palette, headings, elevation
    }));
  }

  async function runReview(
    sessionId: string
  ): Promise<{ review?: ReviewResponse; error?: string; thumbnail?: string }> {
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
      const res = await fetch("/agent/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: selected?.providerId,
          model: selected?.model,
          reasoningEffort: effort(),
          brief: lastBrief(),
          screenshot: capture.dataUrl,
          digest: digest(captured),
          direction: currentDirection(captured),
          audit: formatAudit(auditDocument(captured), "Measured design audit"),
          sessionId
        }),
        signal
      });
      if (seq !== reviewSeq) return {};
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: unknown } | null;
        return { error: typeof body?.error === "string" ? body.error : `request failed (${res.status})` };
      }
      const body = (await res.json()) as ReviewResponse;
      if (seq !== reviewSeq || doc() !== captured) return {};
      return { review: body, thumbnail: await thumbnail(capture.dataUrl) };
    } catch (err) {
      if (signal.aborted) return {};
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      setPending(null);
    }
  }

  async function send() {
    await sendText(inputPrompt().trim());
  }

  return (
    <Show when={chatVisible()}>
      <div
        class={
          chatExpanded()
            ? "w-[360px] h-full bg-white border-r border-neutral-200 flex flex-col z-20 select-none shadow-xs shrink-0"
            : "absolute bottom-4 left-4 z-30 flex flex-col w-[420px] shadow-2xl rounded-2xl bg-white/95 backdrop-blur-md border border-neutral-200/90 p-2.5 transition-all duration-150"
        }
      >
        {/* Header */}
        <div
          class={
            chatExpanded()
              ? "h-10 px-3.5 border-b border-neutral-200/80 flex items-center justify-between text-xs text-neutral-600 shrink-0 bg-neutral-50/50"
              : "h-8 px-1.5 flex items-center justify-between text-xs text-neutral-600 mb-1.5"
          }
        >
          <div class="flex items-center gap-2 truncate">
            <div class="w-5 h-5 rounded-md bg-blue-50 flex items-center justify-center text-blue-600 shrink-0 border border-blue-100">
              <Sparkles size={12} />
            </div>
            <span class="font-semibold text-neutral-800 text-xs tracking-tight">Pen AI</span>
            <span class="text-neutral-300">|</span>
            <div class="flex items-center gap-1 text-[11px] text-neutral-500 font-medium truncate max-w-[170px] bg-neutral-100/80 border border-neutral-200/60 rounded-md px-1.5 py-0.5">
              <Layers size={10} class="text-neutral-400 shrink-0" />
              <span class="truncate">{activeContextName()}</span>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button
              onClick={() => setChatExpanded(!chatExpanded())}
              class="p-1 text-neutral-400 hover:text-neutral-700 rounded-md hover:bg-neutral-100 transition"
              title={chatExpanded() ? "Dock down" : "Expand to left sidebar"}
            >
              <Show when={chatExpanded()} fallback={<Maximize2 size={12} />}>
                <Minus size={12} />
              </Show>
            </button>
            <button
              onClick={() => setChatVisible(false)}
              class="p-1 text-neutral-400 hover:text-neutral-700 rounded-md hover:bg-neutral-100 transition"
              title="Close panel"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Expanded Transcript Area */}
        <Show when={chatExpanded()}>
          <div
            ref={messagesContainerRef}
            class="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 min-h-0 bg-neutral-50/30"
          >
            <Show when={!configured()}>
              <div class="bg-amber-50/80 text-neutral-700 rounded-xl p-3 border border-amber-200/60 flex items-start gap-2.5 text-xs shadow-2xs">
                <Radio size={14} class="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <div class="font-semibold text-amber-900 mb-0.5">Agent Not Connected</div>
                  <div class="text-neutral-600 leading-relaxed text-[11px]">{SETUP}</div>
                </div>
              </div>
            </Show>

            <Show when={configured() && entries().length === 0 && doc().children.length === 0}>
              <div class="flex flex-col items-center text-center p-4 text-neutral-400">
                <div class="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-500 mb-3 shadow-xs">
                  <Bot size={20} />
                </div>
                <div class="font-medium text-neutral-700 text-xs mb-1">Start from a brief</div>
                <div class="text-[11px] text-neutral-400 max-w-[220px] leading-relaxed mb-3">
                  Pick a goal. Clicking fills the input; it does not send.
                </div>
                <div class="w-full space-y-1.5">
                  <For each={EXAMPLE_PROMPTS}>
                    {(example) => (
                      <button
                        type="button"
                        class="w-full text-left rounded-lg border border-neutral-200 bg-white px-2.5 py-2 hover:border-blue-300 hover:bg-blue-50/40 transition"
                        onClick={() => setInputPrompt(example.text)}
                      >
                        <div class="text-[11px] font-medium text-neutral-700">{example.title}</div>
                        <div class="text-[10px] text-neutral-500 leading-relaxed mt-0.5">{example.text}</div>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <For each={entries()}>
              {(entry, i) => (
                <div class="flex flex-col">
                  <Show when={entry.kind === "note" ? entry : null}>
                    {(item) => (
                      <div
                        class={`mr-auto max-w-[96%] rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs shadow-xs leading-relaxed ${
                          item().tone === "error"
                            ? "bg-rose-50/90 border border-rose-200 text-rose-900"
                            : item().tone === "budget"
                            ? "bg-amber-50/90 border border-amber-200 text-amber-900"
                            : "bg-white border border-neutral-200/80 text-neutral-800"
                        }`}
                      >
                        <div
                          class={`flex items-center gap-1 text-[10px] font-semibold mb-1 tracking-wider uppercase ${
                            item().tone === "error"
                              ? "text-rose-600"
                              : item().tone === "budget"
                              ? "text-amber-600"
                              : "text-neutral-400"
                          }`}
                        >
                          <Sparkles
                            size={9}
                            class={
                              item().tone === "error"
                                ? "text-rose-500"
                                : item().tone === "budget"
                                ? "text-amber-500"
                                : "text-blue-500"
                            }
                          />
                          <span>
                            {item().tone === "error"
                              ? "Provider Notice"
                              : item().tone === "budget"
                              ? "Budget"
                              : "Assistant"}
                          </span>
                        </div>
                        <div class="whitespace-pre-wrap">{item().text}</div>
                      </div>
                    )}
                  </Show>

                  <Show when={entry.kind === "review" ? entry : null}>
                    {(item) => <ReviewCard entry={item()} providers={providers()} />}
                  </Show>

                  <Show when={entry.kind === "message" ? entry : null}>
                    {(item) => {
                      const msg = () => item().message;
                      return (
                        <>
                          {/* User Bubble (clean, no header label, sleek dark pill) */}
                          <Show when={msg().role === "user" && !isInternalMessage(msg().content)}>
                            <div class="ml-auto max-w-[88%] bg-neutral-900 text-white rounded-2xl rounded-tr-xs px-3.5 py-2.5 text-xs shadow-xs font-normal leading-relaxed whitespace-pre-wrap">
                              {renderMessageText(msg().content)}
                            </div>
                          </Show>

                          {/* Assistant / Error Bubble */}
                          <Show when={msg().role === "assistant" && renderMessageText(msg().content).trim().length > 0}>
                            {(() => {
                              const text = renderMessageText(msg().content);
                              return (
                                <div class="mr-auto max-w-[96%] rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs shadow-xs leading-relaxed bg-white border border-neutral-200/80 text-neutral-800">
                                  <div class="flex items-center gap-1 text-[10px] font-semibold mb-1 tracking-wider uppercase text-neutral-400">
                                    <Sparkles size={9} class="text-blue-500" />
                                    <span>Assistant</span>
                                  </div>
                                  <div class="whitespace-pre-wrap">{text}</div>
                                </div>
                              );
                            })()}
                          </Show>

                          <Show when={msg().role === "tool"}>
                            {(() => {
                              const name = item().tool ?? "tool";
                              const isMeasure = name === "measure";
                              const isImage = name === "generate_image";

                              return (
                                <div class="mr-auto max-w-[96%] border rounded-lg text-xs shadow-2xs overflow-hidden transition-all bg-slate-50/90 border-slate-200/80 text-slate-700">
                                  <button
                                    onClick={() => toggleTool(i())}
                                    class="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-black/5 transition text-left cursor-pointer"
                                  >
                                    <div class="flex items-center gap-1.5 min-w-0">
                                      <Show when={isImage} fallback={<Wrench size={10} class="text-slate-400 shrink-0" />}>
                                        <ImagePlus size={10} class="text-violet-500 shrink-0" />
                                      </Show>
                                      <span class="font-mono font-medium text-[11px] truncate">{name}</span>
                                      <span class="opacity-40">·</span>
                                      <span class="text-[9px] font-sans font-medium">
                                        {isMeasure ? "measured" : isImage ? "image placed" : "executed"}
                                      </span>
                                    </div>
                                    <div class="text-[10px] opacity-60 font-sans shrink-0 hover:opacity-100">
                                      {expandedTools().has(i()) ? "hide ▴" : "view ▾"}
                                    </div>
                                  </button>

                                  <Show when={expandedTools().has(i())}>
                                    <div class="px-2.5 pb-2 pt-0.5 border-t border-black/5 bg-white/60">
                                      <div class="mt-1 font-mono text-[10px] bg-white rounded p-1.5 border border-black/10 leading-tight whitespace-pre-wrap max-h-36 overflow-y-auto">
                                        {renderMessageText(msg().content)}
                                      </div>
                                    </div>
                                  </Show>
                                </div>
                              );
                            })()}
                          </Show>
                        </>
                      );
                    }}
                  </Show>
                </div>
              )}
            </For>

            {/* What is happening right now, while it is happening. */}
            <Show when={pending()}>
              {(step) => (
                <div class="mr-auto max-w-[96%] flex items-center gap-2 rounded-lg border border-blue-200/70 bg-blue-50/60 px-2.5 py-1.5 text-[11px] text-blue-900 shadow-2xs">
                  <Show
                    when={step().icon === "image"}
                    fallback={
                      <Show when={step().icon === "review"} fallback={<Wrench size={11} class="text-blue-400 shrink-0" />}>
                        <Eye size={11} class="text-blue-500 shrink-0" />
                      </Show>
                    }
                  >
                    <ImagePlus size={11} class="text-violet-500 shrink-0" />
                  </Show>
                  <span class="font-medium shrink-0">{step().label}</span>
                  <Show when={step().detail}>
                    <span class="opacity-40 shrink-0">·</span>
                    <span class="truncate opacity-70">{step().detail}</span>
                  </Show>
                  <Loader size={11} class="ml-auto shrink-0 animate-spin text-blue-400" />
                </div>
              )}
            </Show>

            {/* Live Streaming Bubble */}
            <Show when={streamText()}>
              <div class="mr-auto max-w-[96%] bg-white border border-blue-200 text-neutral-800 rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs shadow-xs leading-relaxed">
                <div class="flex items-center gap-1 text-[10px] font-semibold text-blue-500 mb-1 tracking-wider uppercase">
                  <Sparkles size={9} class="animate-spin text-blue-500" />
                  <span>Thinking…</span>
                </div>
                <div class="whitespace-pre-wrap">
                  {streamText()}
                  <span class="inline-block w-1.5 h-3 bg-blue-500 ml-0.5 animate-pulse align-middle rounded-xs" />
                </div>
              </div>
            </Show>
          </div>
        </Show>

        {/* Input Bar */}
        <div
          class={
            chatExpanded()
              ? "p-2.5 bg-white border-t border-neutral-200/80 flex flex-col gap-2"
              : "flex flex-col gap-1.5 bg-neutral-50/80 border border-neutral-200/80 rounded-xl p-2 shadow-xs"
          }
        >
          <div class="flex items-center gap-1.5 bg-white border border-neutral-200/90 rounded-xl px-2.5 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
            <input
              type="text"
              disabled={!configured() || running()}
              value={inputPrompt()}
              onInput={(e) => setInputPrompt(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                configured()
                  ? "Ask Pen AI to edit canvas, style, or layout..."
                  : "Agent not connected..."
              }
              class="flex-1 bg-transparent text-xs text-neutral-800 placeholder:text-neutral-400 focus:outline-none disabled:text-neutral-400 disabled:cursor-not-allowed"
            />
            <Show when={running()}>
              <button
                onClick={() => {
                  abort?.abort();
                  reviewAbort?.abort();
                }}
                class="w-6 h-6 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition"
                title="Stop generation"
              >
                <Square size={11} />
              </button>
            </Show>
            <Show when={!running()}>
              <button
                onClick={() => void send()}
                disabled={!configured() || !inputPrompt().trim()}
                class="w-6 h-6 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed shadow-2xs"
                title="Send (Enter)"
              >
                <ArrowUp size={12} stroke-width={2.5} />
              </button>
            </Show>
          </div>

          <div class="flex items-center justify-between text-[11px] text-neutral-400 px-1 gap-2 pt-0.5">
            <div class="flex items-center gap-1.5 min-w-0 flex-1">
              <Show when={configured()} fallback={<span class="text-[11px] text-amber-600 font-medium">Set a provider key in .env</span>}>
                <ModelSelector
                  providers={providers()}
                  configured={configured()}
                  choice={choice()}
                  onChoiceChange={setChoice}
                  effort={effort()}
                  onEffortChange={setEffort}
                  disabled={running()}
                />
              </Show>
            </div>
            <span class="shrink-0 text-[10.5px] text-neutral-400 font-medium">
              {running() ? "Running…" : "Enter ↵"}
            </span>
          </div>
        </div>
      </div>

    </Show>
  );
};
