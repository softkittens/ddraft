import { Component, Show, createSignal } from "solid-js";
import {
  MousePointer,
  Square,
  Type,
  Frame,
  FolderOpen,
  Layers,
  BotMessageSquare,
  Trash2
} from "lucide-solid";
import {
  toolMode,
  setToolMode,
  camera,
  resetZoom100,
  layersVisible,
  setLayersVisible,
  chatVisible,
  setChatVisible,
  updateDoc,
  resetCanvas,
  doc
} from "./store";
import { ShareButton } from "./ShareButton";

import { openDesignFile } from "../model/importZip";

const iconBtn =
  "w-9 h-9 flex items-center justify-center rounded-full text-neutral-700 hover:bg-black/5 transition";

export const Toolbar: Component = () => {
  let fileInputRef: HTMLInputElement | undefined;
  const [confirmingClear, setConfirmingClear] = createSignal(false);

  const canClear = () => doc().children.length > 0;

  const confirmClear = async () => {
    setConfirmingClear(false);
    await resetCanvas();
  };

  const handleFileChange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const parsed = await openDesignFile(file);
      updateDoc(parsed);
      resetZoom100();
    } catch (err: any) {
      alert("Error parsing file: " + (err?.message || err));
    } finally {
      if (fileInputRef) fileInputRef.value = "";
    }
  };

  return (
    <>
      <div class="absolute top-3 left-3 z-40 flex items-center gap-2 select-none">
        <img src="/logo.png" alt="draft." class="h-10 w-auto select-none" />
      </div>

      <div class="absolute top-3 right-3 z-40 flex items-center gap-2 select-none">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pen,.json,.zip,application/zip,application/x-zip-compressed"
          class="hidden"
          onChange={handleFileChange}
        />
        <div class="chrome-surface h-10 rounded-full px-1.5 flex items-center gap-0.5">
          <button
            onClick={() => setConfirmingClear(true)}
            disabled={!canClear()}
            title="Clear canvas"
            class="flex items-center gap-1.5 px-3 h-8 text-[13px] font-medium rounded-full text-neutral-700 hover:bg-black/5 transition disabled:text-neutral-300 disabled:hover:bg-transparent disabled:cursor-default"
          >
            <Trash2 size={14} />
            Clear
          </button>
          <button
            onClick={() => fileInputRef?.click()}
            title="Open Pen (.pen, .json, .zip)"
            class="flex items-center gap-1.5 px-3 h-8 text-[13px] font-medium rounded-full text-neutral-700 hover:bg-black/5 transition"
          >
            <FolderOpen size={14} />
            Open
          </button>
        </div>
        <button
          onClick={() => setLayersVisible(!layersVisible())}
          title="Toggle layers (\\)"
          class={`w-9 h-9 flex items-center justify-center rounded-full transition ${
            layersVisible()
              ? "bg-neutral-900 text-white shadow-[0_10px_40px_rgba(15,15,15,0.08)]"
              : `chrome-surface ${iconBtn}`
          }`}
        >
          <Layers size={15} />
        </button>
      </div>

      <button
        onClick={() => setChatVisible(true)}
        title="Open chat"
        class={`chat-reopen absolute bottom-4 left-3 z-40 origin-bottom-left w-14 h-14 rounded-full bg-neutral-900 text-white flex items-center justify-center shadow-[0_10px_28px_rgba(15,15,15,0.28),0_2px_6px_rgba(15,15,15,0.16)] hover:bg-neutral-800 hover:shadow-[0_14px_32px_rgba(15,15,15,0.32)] hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${
          chatVisible() ? "opacity-0 scale-90 pointer-events-none" : "opacity-100 scale-100"
        }`}
        tabindex={chatVisible() ? -1 : 0}
        aria-hidden={chatVisible()}
      >
        <BotMessageSquare size={22} stroke-width={1.8} />
      </button>

      <Show when={confirmingClear()}>
        <div
          class="fixed inset-0 z-50 bg-neutral-900/25 backdrop-blur-[1px] flex items-center justify-center"
          onClick={() => setConfirmingClear(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-canvas-title"
            class="w-[340px] bg-white rounded-xl shadow-2xl border border-neutral-200 p-5"
            onClick={(e) => e.stopPropagation()}
            ref={(el) => queueMicrotask(() => el.focus())}
            tabindex="-1"
            onKeyDown={(e) => {
              if (e.key === "Escape") setConfirmingClear(false);
              if (e.key === "Enter") void confirmClear();
            }}
          >
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0 border border-red-100">
                <Trash2 size={15} />
              </div>
              <div class="min-w-0">
                <h2 id="clear-canvas-title" class="text-sm font-semibold text-neutral-900">
                  Clear canvas
                </h2>
                <p class="text-xs text-neutral-500 mt-1 leading-relaxed">
                  This deletes everything on the canvas, the saved copy, the chat history, and
                  the undo stack. It cannot be undone.
                </p>
              </div>
            </div>
            <div class="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setConfirmingClear(false)}
                class="px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 rounded-md transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmClear}
                class="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md transition shadow-xs"
              >
                Clear canvas
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
};

function railButtonClass(active: boolean): string {
  return `w-9 h-9 flex items-center justify-center rounded-full transition ${
    active ? "bg-neutral-900 text-white shadow-xs" : "text-neutral-700 hover:bg-black/5"
  }`;
}

export const ToolRail: Component = () => {
  return (
    <div class="chrome-surface absolute right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-0.5 rounded-full p-1.5 select-none">
      <button
        onClick={() => setToolMode("select")}
        title="Select tool (V)"
        class={railButtonClass(toolMode() === "select")}
      >
        <MousePointer size={16} />
      </button>
      <button
        onClick={() => setToolMode("frame")}
        title="Frame tool (F)"
        class={railButtonClass(toolMode() === "frame")}
      >
        <Frame size={16} />
      </button>
      <button
        onClick={() => setToolMode("rect")}
        title="Rectangle tool (R)"
        class={railButtonClass(toolMode() === "rect")}
      >
        <Square size={16} />
      </button>
      <button
        onClick={() => setToolMode("text")}
        title="Text tool (T)"
        class={railButtonClass(toolMode() === "text")}
      >
        <Type size={16} />
      </button>
    </div>
  );
};

export const ZoomControls: Component = () => {
  return (
    <div class="absolute bottom-4 right-3 z-30 flex items-center gap-2 select-none">
      <ShareButton />
      <button
        onClick={resetZoom100}
        title="Reset zoom to 100% (Cmd+0)"
        class="chrome-surface h-10 min-w-[56px] px-3 rounded-full text-xs font-semibold text-neutral-800 hover:bg-white/90 transition"
      >
        {Math.round(camera().zoom * 100)}%
      </button>
    </div>
  );
};
