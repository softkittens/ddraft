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
  Camera,
  ShieldCheck
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
import { DesignReviewCard } from "./DesignReviewCard";
import { captureDocumentPng } from "../render/capture";
import { applyReviewMessage, type DesignReview } from "../agent/review";
import { digest } from "../digest/digest";
import { EXAMPLE_PROMPTS } from "./examplePrompts";

const SETUP =
  "No provider key found. Add OPENAI_API_KEY, OPENCODE_GO_API_KEY, or DASHSCOPE_API_KEY to your .env file and restart. Keys stay on your local agent server.";

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

type ReviewUi =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "reviewing"; doc: Document }
  | { status: "ready"; review: DesignReview; doc: Document }
  | { status: "failed" };

export const ChatPanel: Component = () => {
  const [configured, setConfigured] = createSignal(false);
  const [providers, setProviders] = createSignal<PublicProvider[]>([]);
  const [choice, setChoice] = createSignal("");
  const [effort, setEffort] = createSignal<"low" | "medium" | "high">("medium");
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [inputPrompt, setInputPrompt] = createSignal("");
  const [running, setRunning] = createSignal(false);
  const [streamText, setStreamText] = createSignal("");
  const [expandedTools, setExpandedTools] = createSignal<Set<number>>(new Set());
  const [previewModalImg, setPreviewModalImg] = createSignal<string | null>(null);
  const [reviewUi, setReviewUi] = createSignal<ReviewUi>({ status: "idle" });
  const [lastBrief, setLastBrief] = createSignal("");

  function renderMessageText(content: MessageContent | unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((p) => (typeof p === "object" && p && "type" in p && p.type === "text" ? p.text : ""))
        .join(" ");
    }
    return String(content ?? "");
  }

  function isInternalMessage(content: MessageContent | unknown): boolean {
    const text = renderMessageText(content).trim();
    return text.startsWith("[Visual Screenshot Preview") || text.startsWith("[IMAGE_PREVIEW]");
  }

  function parseToolResult(content: string | unknown) {
    if (typeof content !== "string") return { text: String(content ?? ""), imageUrl: null };
    if (content.includes("[IMAGE_PREVIEW]: ")) {
      const parts = content.split("[IMAGE_PREVIEW]: ");
      return { text: parts[0].trim(), imageUrl: parts[1]?.trim() || null };
    }
    return { text: content, imageUrl: null };
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
    messages();
    streamText();
    scrollToBottom();
  });

  onMount(() => {
    void refreshStatus();
  });
  onCleanup(() => {
    abort?.abort();
    reviewAbort?.abort();
  });

  async function sendText(text: string, recordBrief: boolean) {
    if (!text || !configured() || running()) return;
    setChatExpanded(true);
    const next: Message[] = [...messages(), { role: "user", content: text }];
    setMessages(next);
    if (recordBrief) setLastBrief(text);
    setInputPrompt("");
    setStreamText("");
    setRunning(true);
    setReviewUi({ status: "idle" });
    reviewAbort?.abort();
    reviewSeq += 1;
    abort = new AbortController();
    const selected = parseChoice(choice());
    let expectedDoc = doc();
    let finished = false;

    const applyIncoming = (incoming: Document | undefined): boolean => {
      const decision = decideAgentDocument(doc(), expectedDoc, incoming);
      if (decision.action === "abort") {
        abort?.abort();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "The canvas changed, so the agent stopped before overwriting it." }
        ]);
        return false;
      }
      if (decision.action === "accept") {
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
          reasoningEffort: effort()
        }),
        signal: abort.signal
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
        setMessages((prev) => [...prev, { role: "assistant", content: errMessage }]);
        return;
      }

      let assembled = "";
      for await (const data of parseSseData(res.body)) {
        const event = JSON.parse(data) as AgentEvent;
        switch (event.type) {
          case "delta":
            assembled += event.content;
            setStreamText(assembled);
            break;
          case "tool":
            setStreamText("");
            assembled = "";
            setMessages((prev) => [...prev, { role: "tool", content: event.result, tool_call_id: event.name }]);
            if (!applyIncoming(event.doc)) return;
            break;
          case "done":
            setStreamText("");
            setMessages(event.messages.filter((m) => m.role !== "system"));
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
            setMessages((prev) => [...prev, { role: "assistant", content: event.message }]);
            break;
          default: {
            const _never: never = event;
            void _never;
          }
        }
      }
    } catch (err) {
      if (!isAbortError(err)) {
        setMessages((prev) => [...prev, {
          role: "assistant",
          content: err instanceof Error ? err.message : String(err)
        }]);
      }
    } finally {
      setRunning(false);
      abort = null;
    }

    if (finished && doc().children.length > 0) {
      await runReview();
    }
  }

  async function runReview() {
    const selected = parseChoice(choice());
    reviewAbort?.abort();
    reviewAbort = new AbortController();
    const seq = ++reviewSeq;
    const signal = reviewAbort.signal;
    setReviewUi({ status: "checking" });
    const captured = doc();
    const capture = await captureDocumentPng(captured);
    if (seq !== reviewSeq) return;
    if (doc() !== captured) {
      setReviewUi({ status: "idle" });
      return;
    }
    if (!capture.ok) {
      setReviewUi({ status: "failed" });
      return;
    }
    setReviewUi({ status: "reviewing", doc: captured });
    try {
      const res = await fetch("/agent/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: selected?.providerId,
          model: selected?.model,
          brief: lastBrief(),
          screenshot: capture.dataUrl,
          digest: digest(captured)
        }),
        signal
      });
      if (seq !== reviewSeq) return;
      if (!res.ok) {
        setReviewUi({ status: "failed" });
        return;
      }
      const body = (await res.json()) as DesignReview;
      if (seq !== reviewSeq) return;
      if (doc() !== captured) {
        setReviewUi({ status: "idle" });
        return;
      }
      setReviewUi({ status: "ready", review: body, doc: captured });
    } catch (err) {
      if (isAbortError(err)) return;
      if (seq !== reviewSeq) return;
      setReviewUi({ status: "failed" });
    }
  }

  async function send() {
    await sendText(inputPrompt().trim(), true);
  }

  async function applyReview() {
    const ui = reviewUi();
    if (ui.status !== "ready" || ui.review.verdict !== "refine" || doc() !== ui.doc) return;
    await sendText(applyReviewMessage(lastBrief(), ui.review), false);
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

            <Show when={configured() && messages().length === 0 && doc().children.length === 0}>
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

            <For each={messages()}>
              {(msg, i) => (
                <div class="flex flex-col">
                  {/* User Bubble (clean, no header label, sleek dark pill) */}
                  <Show when={msg.role === "user" && !isInternalMessage(msg.content)}>
                    <div class="ml-auto max-w-[88%] bg-neutral-900 text-white rounded-2xl rounded-tr-xs px-3.5 py-2.5 text-xs shadow-xs font-normal leading-relaxed whitespace-pre-wrap">
                      {renderMessageText(msg.content)}
                    </div>
                  </Show>

                  {/* Assistant / Error Bubble */}
                  <Show when={msg.role === "assistant" && renderMessageText(msg.content).trim().length > 0}>
                    {(() => {
                      const text = renderMessageText(msg.content);
                      const isErr = text.toLowerCase().includes("error") || text.includes("401") || text.includes("403");
                      return (
                        <div
                          class={`mr-auto max-w-[96%] rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs shadow-xs leading-relaxed ${
                            isErr
                              ? "bg-rose-50/90 border border-rose-200 text-rose-900"
                              : "bg-white border border-neutral-200/80 text-neutral-800"
                          }`}
                        >
                          <div
                            class={`flex items-center gap-1 text-[10px] font-semibold mb-1 tracking-wider uppercase ${
                              isErr ? "text-rose-600" : "text-neutral-400"
                            }`}
                          >
                            <Sparkles size={9} class={isErr ? "text-rose-500" : "text-blue-500"} />
                            <span>{isErr ? "Provider Notice" : "Assistant"}</span>
                          </div>
                          <div class="whitespace-pre-wrap">{text}</div>
                        </div>
                      );
                    })()}
                  </Show>

                  {/* Tool Execution Bubble (compact collapsible pill + visual screenshot card) */}
                  <Show when={msg.role === "tool"}>
                    {(() => {
                      const parsed = parseToolResult(msg.content);
                      const name = toolLabel(messages(), i());
                      const isVision = name === "generate_image" || parsed.imageUrl !== null;
                      const isAudit = name === "review_design";
                      const isMeasure = name === "measure";

                      return (
                        <div
                          class={`mr-auto max-w-[96%] border rounded-lg text-xs shadow-2xs overflow-hidden transition-all ${
                            isVision
                              ? "bg-blue-50/70 border-blue-200/90 text-blue-900"
                              : isAudit
                              ? "bg-indigo-50/70 border-indigo-200/90 text-indigo-900"
                              : "bg-slate-50/90 border-slate-200/80 text-slate-700"
                          }`}
                        >
                          <button
                            onClick={() => toggleTool(i())}
                            class="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-black/5 transition text-left cursor-pointer"
                          >
                            <div class="flex items-center gap-1.5 min-w-0">
                              <Show when={isVision}>
                                <Camera size={11} class="text-blue-600 shrink-0" />
                              </Show>
                              <Show when={isAudit}>
                                <ShieldCheck size={11} class="text-indigo-600 shrink-0" />
                              </Show>
                              <Show when={!isVision && !isAudit}>
                                <Wrench size={10} class="text-slate-400 shrink-0" />
                              </Show>
                              <span class="font-mono font-medium text-[11px] truncate">{name}</span>
                              <span class="opacity-40">·</span>
                              <span class="text-[9px] font-sans font-medium">
                                {isVision ? "image" : isAudit ? "audit" : isMeasure ? "measured" : "executed"}
                              </span>
                            </div>
                            <div class="text-[10px] opacity-60 font-sans shrink-0 hover:opacity-100">
                              {expandedTools().has(i()) ? "hide ▴" : "view ▾"}
                            </div>
                          </button>

                          {/* Image preview thumbnail (if present) */}
                          <Show when={parsed.imageUrl}>
                            <div class="px-2.5 pb-2 pt-0.5">
                              <div
                                class="relative group cursor-pointer overflow-hidden rounded-md border border-blue-200/90 bg-slate-900/5 shadow-2xs hover:shadow-xs transition"
                                onClick={() => setPreviewModalImg(parsed.imageUrl)}
                              >
                                <img
                                  src={parsed.imageUrl!}
                                  alt="Generated image"
                                  class="w-full max-h-36 object-contain rounded bg-white/60"
                                />
                                <div class="absolute inset-0 bg-blue-900/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                                  <span class="bg-black/75 text-white text-[10px] font-medium px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm">
                                    <Maximize2 size={10} /> Enlarge
                                  </span>
                                </div>
                              </div>
                            </div>
                          </Show>

                          <Show when={expandedTools().has(i())}>
                            <div class="px-2.5 pb-2 pt-0.5 border-t border-black/5 bg-white/60">
                              <div class="mt-1 font-mono text-[10px] bg-white rounded p-1.5 border border-black/10 leading-tight whitespace-pre-wrap max-h-36 overflow-y-auto">
                                {parsed.text}
                              </div>
                            </div>
                          </Show>
                        </div>
                      );
                    })()}
                  </Show>
                </div>
              )}
            </For>

            <Show when={reviewUi().status === "checking" || reviewUi().status === "reviewing"}>
              <div class="mr-auto text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1.5">
                {reviewUi().status === "checking" ? "Checking layout…" : "Reviewing design…"}
              </div>
            </Show>
            <Show when={reviewUi().status === "failed"}>
              <div class="mr-auto max-w-[96%] text-[11px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-2 space-y-1.5">
                <div>Visual review could not run. The design is unchanged.</div>
                <button
                  type="button"
                  class="rounded-md bg-neutral-800 text-white text-[11px] font-medium px-2.5 py-1"
                  onClick={() => void runReview()}
                >
                  Retry
                </button>
              </div>
            </Show>
            <Show when={(() => {
              const ui = reviewUi();
              return ui.status === "ready" && ui.doc === doc() ? ui.review : undefined;
            })()}>
              {(review) => <DesignReviewCard review={review()} onApply={applyReview} />}
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
                onClick={() => abort?.abort()}
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

      {/* Fullscreen Visual Preview Zoom Modal */}
      <Show when={previewModalImg()}>
        <div
          class="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-6 animate-in fade-in"
          onClick={() => setPreviewModalImg(null)}
        >
          <div
            class="relative max-w-5xl max-h-[90vh] bg-white rounded-2xl p-3 shadow-2xl flex flex-col gap-2 overflow-hidden border border-neutral-200 animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between px-2 pt-1 pb-2 border-b border-neutral-100">
              <div class="flex items-center gap-2">
                <Camera size={14} class="text-blue-600" />
                <span class="text-xs font-semibold text-neutral-800">Vision Screenshot Inspection</span>
              </div>
              <button
                onClick={() => setPreviewModalImg(null)}
                class="w-6 h-6 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900 flex items-center justify-center transition cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
            <div class="overflow-auto max-h-[80vh] flex items-center justify-center bg-slate-950/5 rounded-xl p-2">
              <img
                src={previewModalImg()!}
                alt="Enlarged Visual Preview"
                class="max-w-full max-h-[75vh] object-contain rounded-lg shadow-sm"
              />
            </div>
          </div>
        </div>
      </Show>
    </Show>
  );
};
