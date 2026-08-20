import { Component, For, Show, createMemo } from "solid-js";
import { X, SlidersHorizontal } from "lucide-solid";
import {
  resolvedDoc,
  layoutTree,
  selectedIds,
  setInspectorVisible
} from "./store";
import { inspectorFields } from "./inspector";

export const InspectorPanel: Component = () => {
  const fields = createMemo(() => {
    const ids = Array.from(selectedIds());
    return inspectorFields(resolvedDoc(), layoutTree(), ids);
  });


  const selectedCount = () => selectedIds().size;

  return (
    <div class="w-64 bg-white border-l border-neutral-200 flex flex-col h-full z-20 select-none shadow-xs">
      <div class="h-9 px-3 border-b border-neutral-200 flex items-center justify-between font-semibold text-xs text-neutral-800 tracking-wide uppercase">
        <div class="flex items-center gap-1.5">
          <SlidersHorizontal size={13} class="text-neutral-500" />
          <span>Inspector</span>
        </div>
        <button
          onClick={() => setInspectorVisible(false)}
          class="text-neutral-400 hover:text-neutral-700 p-1 rounded transition"
          title="Close inspector"
        >
          <X size={14} />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto custom-scrollbar p-3">
        <Show
          when={selectedCount() > 0}
          fallback={
            <div class="text-xs text-neutral-400 text-center mt-10">
              Select an element on canvas to inspect its layout properties
            </div>
          }
        >
          <div class="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
            {selectedCount() === 1 ? "Properties" : `Selected (${selectedCount()})`}
          </div>

          <div class="space-y-1.5">
            <For each={fields()}>
              {(field) => (
                <div class="flex items-center justify-between bg-neutral-50 border border-neutral-200 rounded px-2 py-1.5 text-xs">
                  <span class="text-neutral-500 font-medium">{field.label}</span>
                  <span class="text-neutral-800 font-mono font-semibold">
                    {field.computed !== undefined
                      ? `${field.declared} (${field.computed}px)`
                      : field.declared}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};
