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
  Bot
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
import { applyReviewMessage, type DesignReview } from "../agent/review";
import { digest } from "../digest/digest";
import { EXAMPLE_PROMPTS } from "./examplePrompts";

const SETUP =
  "No provider key found. Add OPENAI_API_KEY, OPENCODE_GO_API_KEY, or DASHSCOPE_API_KEY to your .env file and restart. Keys stay on your local agent server.";
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

export const ChatPanel: Component = () => {
  const [configured, setConfigured] = createSignal(false);
  const [providers, setProviders] = createSignal<PublicProvider[]>([]);
  const [choice, setChoice] = createSignal(choiceValue("opencode-go", "gpt-5.6-luna"));
  const [effort, setEffort] = createSignal<"low" | "medium" | "high">("high");
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [agentMessages, setAgentMessages] = createSignal<Message[]>([]);
  const [inputPrompt, setInputPrompt] = createSignal("");
  const [running, setRunning] = createSignal(false);
  const [streamText, setStreamText] = createSignal("");
  const [expandedTools, setExpandedTools] = createSignal<Set<number>>(new Set());
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
    return text.startsWith("[IMAGE_PREVIEW]");
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

  async function runAgentPass(text: string, context: Message[], visible: boolean) {
    const next: Message[] = [...context, { role: "user", content: text }];
    const visibleBase = messages();
    if (visible) setMessages([...visibleBase, { role: "user", content: text }]);
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
        if (visible) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: failure! }
          ]);
        }
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
          reasoningEffort: effort()
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
        if (visible) setMessages((prev) => [...prev, { role: "assistant", content: errMessage }]);
        return { finished, edited, messages: finalMessages, failure };
      }

      let assembled = "";
      for await (const data of parseSseData(res.body)) {
        const event = JSON.parse(data) as AgentEvent;
        switch (event.type) {
          case "delta":
            assembled += event.content;
            if (visible) setStreamText(assembled);
            break;
          case "tool":
            if (visible) setStreamText("");
            assembled = "";
            if (visible) {
              setMessages((prev) => [...prev, { role: "tool", content: event.result, tool_call_id: event.name }]);
            }
            if (!applyIncoming(event.doc)) {
              return { finished, edited, messages: finalMessages, failure };
            }
            break;
          case "done":
            if (visible) setStreamText("");
            finalMessages = event.messages.filter((m) => m.role !== "system");
            if (visible) setMessages([...visibleBase, ...finalMessages.slice(context.length)]);
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
            if (visible) setMessages((prev) => [...prev, { role: "assistant", content: event.message }]);
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
        if (visible) setMessages((prev) => [...prev, { role: "assistant", content: failure! }]);
      }
    } finally {
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
    try {
      for (let pass = 0; pass <= AUTO_REVIEW_REVISIONS; pass++) {
        const visible = pass === 0;
        const result = await runAgentPass(instruction, context, visible);
        context = result.messages;
        setAgentMessages(context);

        if (result.failure) {
          if (!visible) {
            setMessages((prev) => [...prev, {
              role: "assistant",
              content: `Background refinement stopped: ${result.failure}`
            }]);
          }
          break;
        }
        if (!result.finished || !result.edited || pass === AUTO_REVIEW_REVISIONS) break;

        const reviewed = await runReview();
        if (reviewed.error) {
          setMessages((prev) => [...prev, {
            role: "assistant",
            content: `Visual review could not run: ${reviewed.error}`
          }]);
          break;
        }
        const review = reviewed.review;
        if (!review || review.verdict !== "refine" || review.issues.length === 0) break;
        instruction = applyReviewMessage(lastBrief(), review);
      }
    } finally {
      abort = null;
      setRunning(false);
    }
  }

  async function runReview() {
    const selected = parseChoice(choice());
    reviewAbort?.abort();
    reviewAbort = new AbortController();
    const seq = ++reviewSeq;
    const signal = reviewAbort.signal;
    const captured = doc();
    const capture = await captureDocumentPng(captured);
    if (seq !== reviewSeq || doc() !== captured) return {};
    if (!capture.ok) return { error: "the canvas could not be captured" };
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
      if (seq !== reviewSeq) return {};
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: unknown } | null;
        return { error: typeof body?.error === "string" ? body.error : `request failed (${res.status})` };
      }
      const body = (await res.json()) as DesignReview;
      if (seq !== reviewSeq || doc() !== captured) return {};
      return { review: body };
    } catch (err) {
      if (signal.aborted) return {};
      return { error: err instanceof Error ? err.message : String(err) };
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

                  {/* Image generation and review stay in model context, not the transcript. */}
                  <Show when={msg.role === "tool" && toolLabel(messages(), i()) !== "generate_image"}>
                    {(() => {
                      const name = toolLabel(messages(), i());
                      const isMeasure = name === "measure";

                      return (
                        <div class="mr-auto max-w-[96%] border rounded-lg text-xs shadow-2xs overflow-hidden transition-all bg-slate-50/90 border-slate-200/80 text-slate-700">
                          <button
                            onClick={() => toggleTool(i())}
                            class="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-black/5 transition text-left cursor-pointer"
                          >
                            <div class="flex items-center gap-1.5 min-w-0">
                              <Wrench size={10} class="text-slate-400 shrink-0" />
                              <span class="font-mono font-medium text-[11px] truncate">{name}</span>
                              <span class="opacity-40">·</span>
                              <span class="text-[9px] font-sans font-medium">
                                {isMeasure ? "measured" : "executed"}
                              </span>
                            </div>
                            <div class="text-[10px] opacity-60 font-sans shrink-0 hover:opacity-100">
                              {expandedTools().has(i()) ? "hide ▴" : "view ▾"}
                            </div>
                          </button>

                          <Show when={expandedTools().has(i())}>
                            <div class="px-2.5 pb-2 pt-0.5 border-t border-black/5 bg-white/60">
                              <div class="mt-1 font-mono text-[10px] bg-white rounded p-1.5 border border-black/10 leading-tight whitespace-pre-wrap max-h-36 overflow-y-auto">
                                {renderMessageText(msg.content)}
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
