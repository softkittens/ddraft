import { Component, For, Show, createSignal } from "solid-js";
import { Wrench, ImagePlus, Eye, Loader, ChevronDown, Radio } from "lucide-solid";
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
      class={`rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${
        isError()
          ? "bg-rose-50 text-rose-900"
          : isBudget()
          ? "bg-amber-50 text-amber-900"
          : "bg-black/[0.03] text-neutral-700"
      }`}
    >
      <div class="whitespace-pre-wrap">{props.item.text}</div>
    </div>
  );
};

export const UserBubble: Component<{ message: Message; sticky?: boolean }> = (props) => {
  return (
    <div
      class={
        props.sticky
          ? "sticky top-0 z-10 rounded-2xl bg-neutral-100/95 backdrop-blur-md px-3.5 py-2.5 text-[13px] text-neutral-800 leading-relaxed whitespace-pre-wrap shadow-[0_4px_12px_-4px_rgba(0,0,0,0.08)] border border-black/[0.04]"
          : "rounded-2xl bg-neutral-100/90 px-3.5 py-2.5 text-[13px] text-neutral-800 leading-relaxed whitespace-pre-wrap border border-black/[0.03]"
      }
    >
      {renderMessageText(props.message.content)}
    </div>
  );
};

export const AssistantBubble: Component<{ message: Message }> = (props) => {
  return (
    <div class="px-1 py-1 text-[13px] leading-relaxed text-neutral-700 whitespace-pre-wrap">
      {renderMessageText(props.message.content)}
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
    <div class="rounded-xl bg-black/[0.03] text-[12px] overflow-hidden">
      <button
        onClick={props.onToggle}
        class="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-black/[0.04] transition text-left cursor-pointer"
      >
        <div class="flex items-center gap-1.5 min-w-0 text-neutral-500">
          <Show when={isImage()} fallback={<Wrench size={11} class="shrink-0" />}>
            <ImagePlus size={11} class="shrink-0" />
          </Show>
          <span class="font-medium text-[11px] truncate text-neutral-600">{name()}</span>
          <span class="text-[10px] text-neutral-400">
            {isMeasure() ? "measured" : isImage() ? "image placed" : "ran"}
          </span>
        </div>
        <ChevronDown
          size={11}
          class={`text-neutral-400 shrink-0 transition-transform ${props.expanded ? "rotate-180" : ""}`}
        />
      </button>

      <Show when={props.expanded}>
        <div class="px-2.5 pb-2">
          <div class="font-mono text-[10px] text-neutral-500 leading-tight whitespace-pre-wrap max-h-36 overflow-y-auto custom-scrollbar">
            {renderMessageText(props.item.message.content)}
          </div>
        </div>
      </Show>
    </div>
  );
};

export const ToolGroupAccordion: Component<{
  items: MessageEntry[];
  expanded: boolean;
  onToggle: () => void;
  expandedToolIndices: Set<number>;
  onToggleToolIndex: (idx: number) => void;
  startIndex: number;
}> = (props) => {
  const count = () => props.items.length;
  const toolSummary = () => {
    const names = props.items.map((it) => it.tool ?? "tool");
    const unique = Array.from(new Set(names));
    if (unique.length <= 3) return unique.join(", ");
    return `${unique.slice(0, 2).join(", ")} +${unique.length - 2} more`;
  };

  return (
    <div class="rounded-xl bg-black/[0.03] text-[12px] overflow-hidden border border-black/[0.03]">
      <button
        onClick={props.onToggle}
        class="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-black/[0.04] transition text-left cursor-pointer"
        title={props.expanded ? "Collapse tools" : "Expand tools"}
      >
        <div class="flex items-center gap-1.5 min-w-0 text-neutral-600">
          <Wrench size={11} class="shrink-0 text-neutral-400" />
          <span class="font-medium text-[11px] truncate text-neutral-700">
            {count()} {count() === 1 ? "tool call" : "tool calls"}
          </span>
          <span class="text-[10px] text-neutral-400 truncate">· {toolSummary()}</span>
        </div>
        <ChevronDown
          size={11}
          class={`text-neutral-400 shrink-0 transition-transform duration-150 ${
            props.expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <Show when={props.expanded}>
        <div class="px-2 pb-2 pt-1 flex flex-col gap-1.5 border-t border-black/[0.03]">
          <For each={props.items}>
            {(item, i) => {
              const globalIdx = () => props.startIndex + i();
              const isExpanded = () => props.expandedToolIndices.has(globalIdx());
              return (
                <ToolAccordion
                  item={item}
                  expanded={isExpanded()}
                  onToggle={() => props.onToggleToolIndex(globalIdx())}
                />
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

export const PendingStepBubble: Component<{ step: PendingStep }> = (props) => {
  return (
    <div class="flex items-center gap-2 rounded-full bg-black/[0.03] px-2.5 py-1.5 text-[11px] text-neutral-600">
      <Show
        when={props.step.icon === "image"}
        fallback={
          <Show
            when={props.step.icon === "review"}
            fallback={<Wrench size={11} class="text-neutral-400 shrink-0" />}
          >
            <Eye size={11} class="text-neutral-400 shrink-0" />
          </Show>
        }
      >
        <ImagePlus size={11} class="text-neutral-400 shrink-0" />
      </Show>
      <span class="font-medium shrink-0">{props.step.label}</span>
      <Show when={props.step.detail}>
        <span class="truncate text-neutral-400">{props.step.detail}</span>
      </Show>
      <Loader size={11} class="ml-auto shrink-0 animate-spin text-neutral-400" />
    </div>
  );
};

export const ThinkingBubble: Component<{ text: string }> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="rounded-xl bg-black/[0.03] text-[12px] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded())}
        class="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 hover:bg-black/[0.04] transition text-left cursor-pointer select-none"
      >
        <span class="font-medium text-[11px] text-neutral-500">Thinking…</span>
        <ChevronDown
          size={11}
          class={`text-neutral-400 shrink-0 transition-transform ${expanded() ? "rotate-180" : ""}`}
        />
      </button>

      <Show when={expanded()}>
        <div class="px-2.5 pb-2 text-[11px] text-neutral-500 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">
          {props.text}
        </div>
      </Show>
    </div>
  );
};

export const LiveStreamBubble: Component<{ text: string }> = (props) => {
  return (
    <div class="px-1 py-1 text-[13px] leading-relaxed text-neutral-700 whitespace-pre-wrap">
      {props.text}
      <span class="inline-block w-1.5 h-3 bg-neutral-400 ml-0.5 animate-pulse align-middle rounded-xs" />
    </div>
  );
};

export const DisconnectedNotice: Component = () => {
  return (
    <div class="rounded-2xl bg-amber-50 px-3 py-2.5 text-[12px] text-neutral-700">
      <div class="flex items-start gap-2">
        <Radio size={13} class="text-amber-500 shrink-0 mt-0.5" />
        <div>
          <div class="font-medium text-amber-900 mb-0.5">Agent not connected</div>
          <div class="text-neutral-600 leading-relaxed text-[11px]">{SETUP_NOTICE}</div>
        </div>
      </div>
    </div>
  );
};

export const EmptyState: Component<{ onSelectPrompt: (text: string) => void }> = (props) => {
  return (
    <div class="flex flex-col pt-1 pb-1">
      <div class="px-1 mb-3">
        <div class="text-[13px] font-medium text-neutral-800 leading-snug">
          Hey, I'm your design agent. Ask me to design something wonderful for you..
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <For each={EXAMPLE_PROMPTS}>
          {(prompt) => (
            <button
              type="button"
              class="w-full text-left rounded-2xl bg-black/[0.035] px-3 py-2 text-[12px] text-neutral-700 leading-snug hover:bg-black/[0.06] hover:text-neutral-900 transition cursor-pointer"
              onClick={() => props.onSelectPrompt(prompt)}
            >
              {prompt}
            </button>
          )}
        </For>
      </div>
    </div>
  );
};
