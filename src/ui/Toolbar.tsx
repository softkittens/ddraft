import { Component, Show, createSignal } from "solid-js";
import {
  MousePointer,
  Square,
  Type,
  Frame,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  FolderOpen,
  PanelLeft,
  PanelRight,
  BotMessageSquare,
  Trash2
} from "lucide-solid";
import {
  toolMode,
  setToolMode,
  camera,
  zoomIn,
  zoomOut,
  resetZoom100,
  handleUndo,
  handleRedo,
  layersVisible,
  setLayersVisible,
  inspectorVisible,
  setInspectorVisible,
  chatVisible,
  setChatVisible,
  updateDoc,
  resetCanvas,
  doc
} from "./store";

import { openDesignFile } from "../model/importZip";

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
    <div class="h-10 bg-white border-b border-neutral-200 flex items-center justify-between px-3 z-30 select-none shadow-xs">
      {/* Left Tools */}
      <div class="flex items-center gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pen,.json,.zip,application/zip,application/x-zip-compressed"
          class="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef?.click()}
          title="Open Pen (.pen, .json, .zip)"
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 rounded transition"
        >
          <FolderOpen size={14} />
          <span>Open</span>
        </button>

        <button
          onClick={() => setConfirmingClear(true)}
          disabled={!canClear()}
          title="Clear canvas"
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition text-neutral-700 hover:bg-red-50 hover:text-red-700 disabled:text-neutral-300 disabled:hover:bg-transparent disabled:hover:text-neutral-300 disabled:cursor-default"
        >
          <Trash2 size={14} />
          <span>Clear</span>
        </button>

        <div class="h-4 w-px bg-neutral-200 mx-1.5" />

        {/* Shape / Creation Tools */}
        <button
          onClick={() => setToolMode("select")}
          title="Select tool (V)"
          class={`p-1.5 rounded transition ${
            toolMode() === "select"
              ? "bg-[#0d99ff] text-white shadow-xs"
              : "text-neutral-700 hover:bg-neutral-100"
          }`}
        >
          <MousePointer size={15} />
        </button>
        <button
          onClick={() => setToolMode("frame")}
          title="Frame tool (F)"
          class={`p-1.5 rounded transition ${
            toolMode() === "frame"
              ? "bg-[#0d99ff] text-white shadow-xs"
              : "text-neutral-700 hover:bg-neutral-100"
          }`}
        >
          <Frame size={15} />
        </button>

        <button
          onClick={() => setToolMode("rect")}
          title="Rectangle tool (R)"
          class={`p-1.5 rounded transition ${
            toolMode() === "rect"
              ? "bg-[#0d99ff] text-white shadow-xs"
              : "text-neutral-700 hover:bg-neutral-100"
          }`}
        >
          <Square size={15} />
        </button>
        <button
          onClick={() => setToolMode("text")}
          title="Text tool (T)"
          class={`p-1.5 rounded transition ${
            toolMode() === "text"
              ? "bg-[#0d99ff] text-white shadow-xs"
              : "text-neutral-700 hover:bg-neutral-100"
          }`}
        >
          <Type size={15} />
        </button>
      </div>

      {/* Center History & Zoom */}
      <div class="flex items-center gap-1">
        <button
          onClick={handleUndo}
          title="Undo (Cmd+Z)"
          class="p-1.5 text-neutral-700 hover:bg-neutral-100 rounded transition"
        >
          <Undo2 size={15} />
        </button>
        <button
          onClick={handleRedo}
          title="Redo (Cmd+Shift+Z)"
          class="p-1.5 text-neutral-700 hover:bg-neutral-100 rounded transition"
        >
          <Redo2 size={15} />
        </button>

        <div class="h-4 w-px bg-neutral-200 mx-1.5" />

        <button
          onClick={zoomOut}
          title="Zoom out (-)"
          class="p-1.5 text-neutral-700 hover:bg-neutral-100 rounded transition"
        >
          <ZoomOut size={15} />
        </button>
        <button
          onClick={resetZoom100}
          title="Reset zoom to 100% (Cmd+0)"
          class="px-2 py-0.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 rounded min-w-[48px] text-center"
        >
          {Math.round(camera().zoom * 100)}%
        </button>
        <button
          onClick={zoomIn}
          title="Zoom in (+)"
          class="p-1.5 text-neutral-700 hover:bg-neutral-100 rounded transition"
        >
          <ZoomIn size={15} />
        </button>
      </div>

      {/* Right Sidebar Toggles */}
      <div class="flex items-center gap-1">
        <button
          onClick={() => setLayersVisible(!layersVisible())}
          title="Toggle Layers sidebar (\)"
          class={`p-1.5 rounded transition ${
            layersVisible()
              ? "bg-neutral-200 text-neutral-900"
              : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          <PanelLeft size={15} />
        </button>
        <button
          onClick={() => setInspectorVisible(!inspectorVisible())}
          title="Toggle Inspector sidebar (])"
          class={`p-1.5 rounded transition ${
            inspectorVisible()
              ? "bg-neutral-200 text-neutral-900"
              : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          <PanelRight size={15} />
        </button>
        <button
          onClick={() => setChatVisible(!chatVisible())}
          title="Toggle AI chat sidebar"
          class={`p-1.5 rounded transition ${
            chatVisible()
              ? "bg-blue-100 text-blue-700"
              : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          <BotMessageSquare size={15} />
        </button>
      </div>

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
            // The dialog opens on a click, so it is on screen before the key
            // handler is attached. Focusing it here makes Escape work without
            // the user having to click into it first.
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
    </div>
  );
};
