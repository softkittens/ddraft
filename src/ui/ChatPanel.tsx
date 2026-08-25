import { Component, Show, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { Minus, Maximize2, X, Layers, RotateCcw, Trash2 } from "lucide-solid";
import { chatVisible, setChatVisible, chatExpanded, setChatExpanded, selectedIds, nodeMap } from "./store";
import { getComponentKind } from "../interaction/selection";
import { useChatSession } from "./chat/useChatSession";
import { TranscriptList } from "./chat/TranscriptList";
import { ChatInputBar } from "./chat/ChatInputBar";
import { CollapsedActivity } from "./chat/CollapsedActivity";

export const ChatPanel: Component = () => {
  const session = useChatSession();
  const [confirmingClearChat, setConfirmingClearChat] = createSignal(false);

  const selectionColor = () => {
    if (selectedIds().size === 0) return null;
    const firstId = Array.from(selectedIds())[0];
    const kind = getComponentKind(firstId, nodeMap());
    return kind === "component" || kind === "instance" ? "#7b61ff" : "#0d99ff";
  };

  const canClearChat = () => session.entries().length > 0 || session.running();

  const confirmClearChat = () => {
    setConfirmingClearChat(false);
    session.clearChat();
  };

  const isLocked = () => session.requiresAccessCode() && !session.authenticated();

  const panelHeight = () => {
    if (chatExpanded()) return "calc(100vh - 5.5rem)";
    if (isLocked()) return "14rem";
    if (session.running()) return "5.75rem";
    return "8.5rem";
  };

  return (
    <div
      class={`chat-shell chrome-surface absolute z-30 left-3 bottom-4 rounded-[28px] flex flex-col origin-bottom-left ${
        chatVisible()
          ? "opacity-100 translate-y-0 scale-100"
          : "opacity-0 translate-y-1.5 scale-[0.98] pointer-events-none"
      } ${chatExpanded() || isLocked() ? "overflow-hidden" : session.running() ? "overflow-hidden" : "overflow-visible"}`}
      style={{
        width: "min(380px, calc(100vw - 6.5rem))",
        height: panelHeight(),
        "max-height": "calc(100vh - 2rem)"
      }}
      aria-hidden={!chatVisible()}
      inert={!chatVisible() ? true : undefined}
    >
      <div class="h-9 px-2.5 flex items-center justify-between shrink-0 select-none">
        <div
          class="flex items-center gap-1 text-[11px] font-medium truncate max-w-[180px] rounded-full px-2 py-0.5 transition-colors"
          style={{ color: selectionColor() ?? "rgb(115, 115, 115)" }}
        >
          <Layers
            size={11}
            class="shrink-0 transition-colors"
            style={{ color: selectionColor() ?? "rgb(163, 163, 163)" }}
          />
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

      <Show when={chatExpanded() || isLocked()}>
        <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pb-3">
          <TranscriptList
            entries={session.entries()}
            streamReasoning={session.streamReasoning()}
            streamText={session.streamText()}
            pending={session.pending()}
            configured={session.configured()}
            requiresAccessCode={session.requiresAccessCode()}
            authenticated={session.authenticated()}
            onUnlock={session.unlockWithCode}
            providers={session.providers()}
            expanded={chatExpanded() || isLocked()}
            onSelectPrompt={(text) => void session.sendText(text)}
          />
        </div>
      </Show>

      <Show
        when={chatExpanded() || !session.running()}
        fallback={
          <CollapsedActivity
            entries={session.entries()}
            pending={session.pending()}
            streamReasoning={session.streamReasoning()}
            streamText={session.streamText()}
            running={session.running()}
            elapsedSeconds={session.elapsedSeconds()}
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
          elapsedSeconds={session.elapsedSeconds()}
          configured={session.configured()}
          requiresAccessCode={session.requiresAccessCode()}
          authenticated={session.authenticated()}
          providers={session.providers()}
          choice={session.choice()}
          onChoiceChange={session.setChoice}
          effort={session.effort()}
          onEffortChange={session.setEffort}
        />
      </Show>

      <Show when={confirmingClearChat()}>
        <Portal>
          <div
            class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setConfirmingClearChat(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="clear-chat-title"
              class="w-[360px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-neutral-200 p-5"
              onClick={(e) => e.stopPropagation()}
              ref={(el) => queueMicrotask(() => el.focus())}
              tabindex="-1"
              onKeyDown={(e) => {
                if (e.key === "Escape") setConfirmingClearChat(false);
                if (e.key === "Enter") confirmClearChat();
              }}
            >
              <div class="flex items-start gap-3.5">
                <div class="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                  <Trash2 size={16} />
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
                  type="button"
                  onClick={() => setConfirmingClearChat(false)}
                  class="px-3.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmClearChat}
                  class="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition shadow-xs cursor-pointer"
                >
                  Clear chat
                </button>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
};
