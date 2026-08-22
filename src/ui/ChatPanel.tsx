import { Component, Show, createSignal } from "solid-js";
import { Minus, Maximize2, X, Layers, RotateCcw, Trash2 } from "lucide-solid";
import { chatVisible, setChatVisible, chatExpanded, setChatExpanded } from "./store";
import { useChatSession } from "./chat/useChatSession";
import { TranscriptList } from "./chat/TranscriptList";
import { ChatInputBar } from "./chat/ChatInputBar";
import { CollapsedActivity } from "./chat/CollapsedActivity";

export const ChatPanel: Component = () => {
  const session = useChatSession();
  const [confirmingClearChat, setConfirmingClearChat] = createSignal(false);

  const canClearChat = () => session.entries().length > 0 || session.running();

  const confirmClearChat = () => {
    setConfirmingClearChat(false);
    session.clearChat();
  };

  return (
    <div
      class={`chat-shell chrome-surface absolute z-30 left-3 bottom-4 w-[min(380px,calc(100vw-6.5rem))] rounded-[28px] flex flex-col select-none origin-bottom-left ${
        chatVisible()
          ? "opacity-100 translate-y-0 scale-100"
          : "opacity-0 translate-y-1.5 scale-[0.98] pointer-events-none"
      } ${
        chatExpanded()
          ? "h-[calc(100vh-5.5rem)] overflow-hidden"
          : session.running()
            ? "h-[5.75rem] overflow-hidden"
            : "h-[8.5rem] overflow-visible"
      }`}
      aria-hidden={!chatVisible()}
      inert={!chatVisible() ? true : undefined}
    >
      <div class="h-9 px-2.5 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-1 text-[11px] text-neutral-500 font-medium truncate max-w-[180px] rounded-full px-2 py-0.5">
          <Layers size={11} class="text-neutral-400 shrink-0" />
          <span class="truncate">{session.activeContextName()}</span>
        </div>
        <div class="flex items-center gap-0.5">
          <button
            onClick={() => setConfirmingClearChat(true)}
            disabled={!canClearChat()}
            class="p-1.5 text-neutral-400 hover:text-red-600 rounded-full hover:bg-black/5 transition disabled:text-neutral-200 disabled:hover:bg-transparent disabled:hover:text-neutral-200 disabled:cursor-default"
            title="Clear chat transcript"
          >
            <RotateCcw size={12} />
          </button>
          <button
            onClick={() => setChatExpanded(!chatExpanded())}
            class="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-full hover:bg-black/5 transition"
            title={chatExpanded() ? "Collapse chat" : "Expand chat"}
          >
            <Show when={chatExpanded()} fallback={<Maximize2 size={12} />}>
              <Minus size={12} />
            </Show>
          </button>
          <button
            onClick={() => setChatVisible(false)}
            class="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-full hover:bg-black/5 transition"
            title="Close panel"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div
        class={`chat-shell-body grid min-h-0 ${chatExpanded() ? "flex-1" : "flex-none"}`}
        style={{ "grid-template-rows": chatExpanded() ? "minmax(0, 1fr)" : "0fr" }}
      >
        <div class="min-h-0 overflow-hidden">
          <div class="h-full min-h-0 flex flex-col">
            <TranscriptList
              entries={session.entries()}
              streamReasoning={session.streamReasoning()}
              streamText={session.streamText()}
              pending={session.pending()}
              configured={session.configured()}
              providers={session.providers()}
              expanded={chatExpanded()}
              onSelectPrompt={session.setInputPrompt}
            />
          </div>
        </div>
      </div>

      <Show
        when={chatExpanded() || !session.running()}
        fallback={
          <CollapsedActivity
            entries={session.entries()}
            pending={session.pending()}
            streamReasoning={session.streamReasoning()}
            streamText={session.streamText()}
            running={session.running()}
            onExpand={() => setChatExpanded(true)}
            onStop={session.stop}
          />
        }
      >
        <ChatInputBar
          inputPrompt={session.inputPrompt()}
          onInputChange={session.setInputPrompt}
          onSend={session.send}
          onStop={session.stop}
          running={session.running()}
          configured={session.configured()}
          providers={session.providers()}
          choice={session.choice()}
          onChoiceChange={session.setChoice}
          effort={session.effort()}
          onEffortChange={session.setEffort}
        />
      </Show>

      <Show when={confirmingClearChat()}>
        <div
          class="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100"
          onClick={() => setConfirmingClearChat(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-chat-title"
            class="w-[340px] bg-white rounded-xl shadow-2xl border border-neutral-200 p-5"
            onClick={(e) => e.stopPropagation()}
            ref={(el) => queueMicrotask(() => el.focus())}
            tabindex="-1"
            onKeyDown={(e) => {
              if (e.key === "Escape") setConfirmingClearChat(false);
              if (e.key === "Enter") confirmClearChat();
            }}
          >
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0 border border-red-100">
                <Trash2 size={15} />
              </div>
              <div class="min-w-0">
                <h2 id="clear-chat-title" class="text-sm font-semibold text-neutral-900">
                  Clear chat history
                </h2>
                <p class="text-xs text-neutral-500 mt-1 leading-relaxed">
                  This clears the conversation transcript and active run. The canvas and your design will remain unchanged.
                </p>
              </div>
            </div>
            <div class="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConfirmingClearChat(false)}
                class="px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 rounded-md transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmClearChat}
                class="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition shadow-xs"
              >
                Clear chat
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
