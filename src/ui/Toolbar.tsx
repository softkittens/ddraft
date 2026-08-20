import { Component, For } from "solid-js";
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
  BotMessageSquare
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
  selectedFixture,
  loadFixture
} from "./store";

import { FIXTURE_LABELS } from "./fixtures";

import { parseDocument } from "../model/parse";

export const Toolbar: Component = () => {
  let fileInputRef: HTMLInputElement | undefined;

  const handleFileChange = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseDocument(reader.result as string);
        updateDoc(parsed);
        resetZoom100();
      } catch (err) {
        console.error("Failed to load document:", err);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div class="h-10 bg-white border-b border-neutral-200 flex items-center justify-between px-3 z-30 select-none shadow-xs">
      {/* Left Tools */}
      <div class="flex items-center gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pen,.json"
          class="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef?.click()}
          title="Open Pen file"
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 rounded transition"
        >
          <FolderOpen size={14} />
          <span>Open</span>
        </button>

        <select
          value={selectedFixture()}
          onChange={(e) => loadFixture(e.currentTarget.value)}
          class="h-7 px-2 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200/80 border border-neutral-200 rounded-md outline-none cursor-pointer transition"
          title="Load curriculum fixture"
        >
          <For each={Object.entries(FIXTURE_LABELS)}>
            {([key, label]) => (
              <option value={key}>{label}</option>
            )}
          </For>
        </select>


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
          title="Toggle AI Agent Assistant"
          class={`p-1.5 rounded transition ${
            chatVisible()
              ? "bg-blue-100 text-blue-700"
              : "text-neutral-500 hover:bg-neutral-100"
          }`}
        >
          <BotMessageSquare size={15} />
        </button>
      </div>
    </div>
  );
};
