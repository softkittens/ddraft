import { Component, Show, createMemo } from "solid-js";
import {
  Sparkles,
  Minus,
  Maximize2,
  X,
  Radio
} from "lucide-solid";
import {
  chatVisible,
  setChatVisible,
  chatExpanded,
  setChatExpanded,
  selectedIds,
  nodeMap,
  doc
} from "./store";

const PLACEHOLDER =
  "Agent Machine (Unit H) is not connected. Provider loop and canvas tools will be wired in Unit H.";

export const ChatPanel: Component = () => {
  const activeContextName = createMemo(() => {
    const ids = Array.from(selectedIds());
    const node = ids.length > 0 ? nodeMap().get(ids[0]) : null;
    if (!node) {
      const firstChild = doc().children[0];
      return firstChild?.name || firstChild?.id || "Full Canvas";
    }
    return node.name || node.id;
  });

  return (
    <Show when={chatVisible()}>
      <div
        class={`absolute bottom-4 left-4 z-30 flex flex-col transition-all duration-200 select-none shadow-2xl rounded-2xl bg-[#e6e8eb]/95 backdrop-blur-md border border-neutral-300/80 p-2 ${
          chatExpanded() ? "w-[440px] h-[380px]" : "w-[400px]"
        }`}
      >
        <div class="h-7 px-2 flex items-center justify-between text-xs text-neutral-600 mb-1">
          <div class="flex items-center gap-1.5 truncate">
            <Sparkles size={13} class="text-blue-500 shrink-0" />
            <span class="font-semibold text-neutral-800">Pen AI</span>
            <span class="text-neutral-400">·</span>
            <span class="text-neutral-500 font-medium truncate max-w-[200px]">
              {activeContextName()}
            </span>
          </div>

          <div class="flex items-center gap-1">
            <button
              onClick={() => setChatExpanded(!chatExpanded())}
              class="p-1 text-neutral-500 hover:text-neutral-800 rounded hover:bg-neutral-300/60 transition"
              title={chatExpanded() ? "Minimize" : "Expand"}
            >
              <Show when={chatExpanded()} fallback={<Maximize2 size={12} />}>
                <Minus size={12} />
              </Show>
            </button>
            <button
              onClick={() => setChatVisible(false)}
              class="p-1 text-neutral-500 hover:text-neutral-800 rounded hover:bg-neutral-300/60 transition"
              title="Close panel"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        <Show when={chatExpanded()}>
          <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2.5 mb-2">
            <div class="bg-neutral-200/80 text-neutral-600 rounded-xl p-3 border border-neutral-300/50 flex items-start gap-2 text-xs">
              <Radio size={14} class="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <div class="font-semibold text-neutral-700 mb-0.5">Status: Not Connected</div>
                <div class="text-neutral-600 leading-relaxed">{PLACEHOLDER}</div>
              </div>
            </div>
          </div>
        </Show>

        <div class="relative bg-white/95 border border-neutral-200 rounded-xl p-1.5 flex flex-col gap-1.5 shadow-xs">
          <div class="flex items-center px-1">
            <input
              type="text"
              disabled
              placeholder="Agent not connected..."
              class="flex-1 bg-transparent text-xs text-neutral-400 placeholder:text-neutral-400 focus:outline-none cursor-not-allowed"
            />
          </div>

          <div class="flex items-center justify-between text-[11px] text-neutral-400 px-1 border-t border-neutral-100 pt-1">
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>Unit H pending</span>
            </div>
            <span>No provider configured</span>
          </div>
        </div>
      </div>
    </Show>
  );
};
