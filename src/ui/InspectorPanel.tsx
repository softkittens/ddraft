import { Component, For, Show, createMemo } from "solid-js";
import { X, SlidersHorizontal, Trash2 } from "lucide-solid";
import {
  resolvedDoc,
  layoutTree,
  selectedIds,
  setInspectorVisible,
  deleteSelectedNodes
} from "./store";
import { inspectorFields } from "./inspector";

export const InspectorPanel: Component = () => {
  const fields = createMemo(() => {
    const ids = Array.from(selectedIds());
    return inspectorFields(resolvedDoc(), layoutTree(), ids);
  });

  const selectedCount = () => selectedIds().size;

  return (
    <div class="chrome-surface absolute top-14 right-16 z-30 w-64 max-h-[min(560px,calc(100%-5rem))] rounded-2xl flex flex-col select-none overflow-hidden">
      <div class="h-9 px-3 border-b border-neutral-200 flex items-center justify-between font-semibold text-xs text-neutral-800 tracking-wide uppercase">
        <div class="flex items-center gap-1.5">
          <SlidersHorizontal size={13} class="text-neutral-500" />
          <span>Inspector</span>
        </div>
        <button
          onClick={() => setInspectorVisible(false)}
          class="text-neutral-400 hover:text-neutral-700 p-1 rounded transition cursor-pointer"
          title="Close inspector"
        >
          <X size={14} />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto custom-scrollbar p-3 flex flex-col justify-between">
        <Show
          when={selectedCount() > 0}
          fallback={
            <div class="text-xs text-neutral-400 text-center mt-10">
              Select an element on canvas to inspect its layout properties
            </div>
          }
        >
          <div>
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
          </div>

          {/* Delete Action Button */}
          <div class="pt-4 mt-auto border-t border-neutral-100">
            <button
              onClick={() => deleteSelectedNodes()}
              class="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-medium border border-rose-200/80 transition cursor-pointer"
              title="Delete selected element (Backspace / Delete)"
            >
              <Trash2 size={12} />
              <span>{selectedCount() === 1 ? "Delete Element" : `Delete Elements (${selectedCount()})`}</span>
              <span class="text-[10px] text-rose-400 font-mono ml-auto">⌫</span>
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};
