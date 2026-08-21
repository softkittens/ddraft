import { Component, Show } from "solid-js";
import { ArrowUp, Square } from "lucide-solid";
import type { PublicProvider } from "../../agent/credentials";
import { ModelSelector } from "../ModelSelector";

export interface ChatInputBarProps {
  chatExpanded: boolean;
  inputPrompt: string;
  onInputChange: (val: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  configured: boolean;
  providers: PublicProvider[];
  choice: string;
  onChoiceChange: (val: string) => void;
  effort: "low" | "medium" | "high";
  onEffortChange: (val: "low" | "medium" | "high") => void;
}

export const ChatInputBar: Component<ChatInputBarProps> = (props) => {
  return (
    <div
      class={
        props.chatExpanded
          ? "p-2.5 bg-white border-t border-neutral-200/80 flex flex-col gap-2"
          : "flex flex-col gap-1.5 bg-neutral-50/80 border border-neutral-200/80 rounded-xl p-2 shadow-xs"
      }
    >
      <div class="flex items-center gap-1.5 bg-white border border-neutral-200/90 rounded-xl px-2.5 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
        <input
          type="text"
          disabled={!props.configured || props.running}
          value={props.inputPrompt}
          onInput={(e) => props.onInputChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              props.onSend();
            }
          }}
          placeholder={
            props.configured
              ? "Ask Pen AI to edit canvas, style, or layout..."
              : "Agent not connected..."
          }
          class="flex-1 bg-transparent text-xs text-neutral-800 placeholder:text-neutral-400 focus:outline-none disabled:text-neutral-400 disabled:cursor-not-allowed"
        />
        <Show when={props.running}>
          <button
            onClick={props.onStop}
            class="w-6 h-6 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition"
            title="Stop generation"
          >
            <Square size={11} />
          </button>
        </Show>
        <Show when={!props.running}>
          <button
            onClick={props.onSend}
            disabled={!props.configured || !props.inputPrompt.trim()}
            class="w-6 h-6 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed shadow-2xs"
            title="Send (Enter)"
          >
            <ArrowUp size={12} stroke-width={2.5} />
          </button>
        </Show>
      </div>

      <div class="flex items-center justify-between text-[11px] text-neutral-400 px-1 gap-2 pt-0.5">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <Show
            when={props.configured}
            fallback={
              <span class="text-[11px] text-amber-600 font-medium">
                Set a provider key in .env
              </span>
            }
          >
            <ModelSelector
              providers={props.providers}
              configured={props.configured}
              choice={props.choice}
              onChoiceChange={props.onChoiceChange}
              effort={props.effort}
              onEffortChange={props.onEffortChange}
              disabled={props.running}
            />
          </Show>
        </div>
        <span class="shrink-0 text-[10.5px] text-neutral-400 font-medium">
          {props.running ? "Running…" : "Enter ↵"}
        </span>
      </div>
    </div>
  );
};
