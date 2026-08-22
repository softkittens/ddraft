import { Component, For, Show, createSignal } from "solid-js";
import { Sparkles, Wrench, ImagePlus, Eye, Loader, Bot, Radio } from "lucide-solid";
import type { Message } from "../../agent/provider";
import { EXAMPLE_PROMPTS } from "../examplePrompts";
import {
  type NoteEntry,
  type MessageEntry,
  type PendingStep,
  SETUP_NOTICE,
  renderMessageText
} from "./types";

export const NoticeBubble: Component<{ item: NoteEntry }> = (props) => {
  const isError = () => props.item.tone === "error";
  const isBudget = () => props.item.tone === "budget";

  return (
    <div
      class={`mr-auto max-w-[96%] rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs shadow-xs leading-relaxed ${
        isError()
          ? "bg-rose-50/90 border border-rose-200 text-rose-900"
          : isBudget()
          ? "bg-amber-50/90 border border-amber-200 text-amber-900"
          : "bg-white border border-neutral-200/80 text-neutral-800"
      }`}
    >
      <div
        class={`flex items-center gap-1 text-[10px] font-semibold mb-1 tracking-wider uppercase ${
          isError() ? "text-rose-600" : isBudget() ? "text-amber-600" : "text-neutral-400"
        }`}
      >
        <Sparkles
          size={9}
          class={isError() ? "text-rose-500" : isBudget() ? "text-amber-500" : "text-blue-500"}
        />
        <span>{isError() ? "Provider Notice" : isBudget() ? "Budget" : "Assistant"}</span>
      </div>
      <div class="whitespace-pre-wrap">{props.item.text}</div>
    </div>
  );
};

export const UserBubble: Component<{ message: Message }> = (props) => {
  return (
    <div class="ml-auto max-w-[88%] bg-neutral-900 text-white rounded-2xl rounded-tr-xs px-3.5 py-2.5 text-xs shadow-xs font-normal leading-relaxed whitespace-pre-wrap">
      {renderMessageText(props.message.content)}
    </div>
  );
};

export const AssistantBubble: Component<{ message: Message }> = (props) => {
  const text = () => renderMessageText(props.message.content);

  return (
    <div class="mr-auto max-w-[96%] rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs shadow-xs leading-relaxed bg-white border border-neutral-200/80 text-neutral-800">
      <div class="flex items-center gap-1 text-[10px] font-semibold mb-1 tracking-wider uppercase text-neutral-400">
        <Sparkles size={9} class="text-blue-500" />
        <span>Assistant</span>
      </div>
      <div class="whitespace-pre-wrap">{text()}</div>
    </div>
  );
};

export const ToolAccordion: Component<{
  item: MessageEntry;
  expanded: boolean;
  onToggle: () => void;
}> = (props) => {
  const name = () => props.item.tool ?? "tool";
  const isMeasure = () => name() === "measure";
  const isImage = () => name() === "generate_image";

  return (
    <div class="mr-auto max-w-[96%] border rounded-lg text-xs shadow-2xs overflow-hidden transition-all bg-slate-50/90 border-slate-200/80 text-slate-700">
      <button
        onClick={props.onToggle}
        class="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-black/5 transition text-left cursor-pointer"
      >
        <div class="flex items-center gap-1.5 min-w-0">
          <Show when={isImage()} fallback={<Wrench size={10} class="text-slate-400 shrink-0" />}>
            <ImagePlus size={10} class="text-violet-500 shrink-0" />
          </Show>
          <span class="font-mono font-medium text-[11px] truncate">{name()}</span>
          <span class="opacity-40">·</span>
          <span class="text-[9px] font-sans font-medium">
            {isMeasure() ? "measured" : isImage() ? "image placed" : "executed"}
          </span>
        </div>
        <div class="text-[10px] opacity-60 font-sans shrink-0 hover:opacity-100">
          {props.expanded ? "hide ▴" : "view ▾"}
        </div>
      </button>

      <Show when={props.expanded}>
        <div class="px-2.5 pb-2 pt-0.5 border-t border-black/5 bg-white/60">
          <div class="mt-1 font-mono text-[10px] bg-white rounded p-1.5 border border-black/10 leading-tight whitespace-pre-wrap max-h-36 overflow-y-auto">
            {renderMessageText(props.item.message.content)}
          </div>
        </div>
      </Show>
    </div>
  );
};

export const PendingStepBubble: Component<{ step: PendingStep }> = (props) => {
  return (
    <div class="mr-auto max-w-[96%] flex items-center gap-2 rounded-lg border border-blue-200/70 bg-blue-50/60 px-2.5 py-1.5 text-[11px] text-blue-900 shadow-2xs">
      <Show
        when={props.step.icon === "image"}
        fallback={
          <Show
            when={props.step.icon === "review"}
            fallback={<Wrench size={11} class="text-blue-400 shrink-0" />}
          >
            <Eye size={11} class="text-blue-500 shrink-0" />
          </Show>
        }
      >
        <ImagePlus size={11} class="text-violet-500 shrink-0" />
      </Show>
      <span class="font-medium shrink-0">{props.step.label}</span>
      <Show when={props.step.detail}>
        <span class="opacity-40 shrink-0">·</span>
        <span class="truncate opacity-70">{props.step.detail}</span>
      </Show>
      <Loader size={11} class="ml-auto shrink-0 animate-spin text-blue-400" />
    </div>
  );
};

export const ThinkingBubble: Component<{ text: string }> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="mr-auto max-w-[96%] border rounded-xl text-xs shadow-2xs overflow-hidden transition-all bg-sky-50/70 border-sky-200/80 text-neutral-800">
      <button
        type="button"
        onClick={() => setExpanded(!expanded())}
        class="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-sky-100/50 transition text-left cursor-pointer select-none"
      >
        <div class="flex items-center gap-2 min-w-0">
          <Sparkles size={11} class="animate-spin text-sky-500 shrink-0" />
          <span class="font-medium text-[11px] text-sky-900">Thinking…</span>
          <span class="text-[10px] text-sky-600/70 font-sans truncate">
            {props.text.length > 0 ? `${props.text.length} chars` : ""}
          </span>
        </div>
        <div class="text-[10px] text-sky-700 font-sans shrink-0 hover:underline">
          {expanded() ? "hide ▴" : "view thoughts ▾"}
        </div>
      </button>

      <Show when={expanded()}>
        <div class="px-3 pb-3 pt-1 border-t border-sky-100 bg-white/80">
          <div class="text-[11px] text-neutral-600 leading-relaxed font-sans whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">
            {props.text}
            <span class="inline-block w-1.5 h-3 bg-sky-500 ml-0.5 animate-pulse align-middle rounded-xs" />
          </div>
        </div>
      </Show>
    </div>
  );
};

export const LiveStreamBubble: Component<{ text: string }> = (props) => {
  return (
    <div class="mr-auto max-w-[96%] bg-white border border-neutral-200 text-neutral-800 rounded-2xl rounded-tl-xs px-3.5 py-2.5 text-xs shadow-xs leading-relaxed">
      <div class="flex items-center gap-1 text-[10px] font-semibold text-neutral-400 mb-1 tracking-wider uppercase">
        <Sparkles size={9} class="text-blue-500" />
        <span>Assistant</span>
      </div>
      <div class="whitespace-pre-wrap">
        {props.text}
        <span class="inline-block w-1.5 h-3 bg-blue-500 ml-0.5 animate-pulse align-middle rounded-xs" />
      </div>
    </div>
  );
};

export const DisconnectedNotice: Component = () => {
  return (
    <div class="bg-amber-50/80 text-neutral-700 rounded-xl p-3 border border-amber-200/60 flex items-start gap-2.5 text-xs shadow-2xs">
      <Radio size={14} class="text-amber-500 shrink-0 mt-0.5" />
      <div>
        <div class="font-semibold text-amber-900 mb-0.5">Agent Not Connected</div>
        <div class="text-neutral-600 leading-relaxed text-[11px]">{SETUP_NOTICE}</div>
      </div>
    </div>
  );
};

export const EmptyState: Component<{ onSelectPrompt: (text: string) => void }> = (props) => {
  return (
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
              onClick={() => props.onSelectPrompt(example.text)}
            >
              <div class="text-[11px] font-medium text-neutral-700">{example.title}</div>
              <div class="text-[10px] text-neutral-500 leading-relaxed mt-0.5">{example.text}</div>
            </button>
          )}
        </For>
      </div>
    </div>
  );
};
