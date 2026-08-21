import { Component, Show } from "solid-js";
import { Sparkles, Minus, Maximize2, X, Layers } from "lucide-solid";
import { chatVisible, setChatVisible, chatExpanded, setChatExpanded } from "./store";
import { useChatSession } from "./chat/useChatSession";
import { TranscriptList } from "./chat/TranscriptList";
import { ChatInputBar } from "./chat/ChatInputBar";

export const ChatPanel: Component = () => {
  const session = useChatSession();

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
              <span class="truncate">{session.activeContextName()}</span>
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
          <TranscriptList
            entries={session.entries()}
            streamText={session.streamText()}
            pending={session.pending()}
            configured={session.configured()}
            providers={session.providers()}
            onSelectPrompt={session.setInputPrompt}
          />
        </Show>

        {/* Input Bar */}
        <ChatInputBar
          chatExpanded={chatExpanded()}
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
      </div>
    </Show>
  );
};
