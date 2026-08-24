import { Component, Show } from "solid-js";
import { ArrowUp, Square } from "lucide-solid";
import type { PublicProvider } from "../../agent/credentials";
import { ModelSelector } from "../ModelSelector";

export interface ChatInputBarProps {
  inputPrompt: string;
  onInputChange: (val: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  configured: boolean;
  requiresAccessCode?: boolean;
  authenticated?: boolean;
  providers: PublicProvider[];
  choice: string;
  onChoiceChange: (val: string) => void;
  effort: "low" | "medium" | "high";
  onEffortChange: (val: "low" | "medium" | "high") => void;
}

export const ChatInputBar: Component<ChatInputBarProps> = (props) => {
  const isLocked = () => props.requiresAccessCode && !props.authenticated;
  const isReady = () => props.configured && !isLocked();

  return (
    <div class="flex flex-col gap-1.5 px-3 pb-3 pt-1 shrink-0">
      <input
        type="text"
        disabled={!isReady() || props.running}
        value={props.inputPrompt}
        onInput={(e) => props.onInputChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            props.onSend();
          }
        }}
        placeholder={
          isLocked()
            ? "Enter access code above to unlock..."
            : props.configured
            ? "What would you like to change or create?"
            : "Agent not connected..."
        }
        class="w-full bg-transparent text-[13px] leading-snug text-neutral-800 placeholder:text-neutral-400 focus:outline-none disabled:text-neutral-400 disabled:cursor-not-allowed py-1.5 px-1"
      />

      <div class="flex items-center justify-between gap-2 px-1">
        <Show
          when={isReady()}
          fallback={
            <span class="text-[11px] text-amber-600 font-medium">
              {isLocked() ? "Access code required" : "Set a provider key in .env"}
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

        <Show when={props.running}>
          <button
            onClick={props.onStop}
            class="w-8 h-8 rounded-full bg-rose-200 hover:bg-rose-300 text-rose-800 flex items-center justify-center transition shrink-0"
            title="Stop generation"
          >
            <Square size={11} />
          </button>
        </Show>
        <Show when={!props.running}>
          <button
            onClick={props.onSend}
            disabled={!props.configured || !props.inputPrompt.trim()}
            class="w-8 h-8 rounded-full bg-neutral-900 hover:bg-neutral-800 text-white flex items-center justify-center transition disabled:opacity-25 disabled:cursor-not-allowed shrink-0"
            title="Send (Enter)"
          >
            <ArrowUp size={14} stroke-width={2.5} />
          </button>
        </Show>
      </div>
    </div>
  );
};
