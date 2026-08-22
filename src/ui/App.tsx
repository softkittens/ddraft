import { Component, Show, onMount, onCleanup } from "solid-js";
import { Toolbar, ToolRail, ZoomControls } from "./Toolbar";
import { LayersPanel } from "./LayersPanel";
import { InspectorPanel } from "./InspectorPanel";
import { ChatPanel } from "./ChatPanel";
import { CanvasView } from "./CanvasView";
import { PerfHUD } from "./PerfHUD";

import {
  layersVisible,
  setLayersVisible,
  inspectorVisible,
  setInspectorVisible,
  handleUndo,
  handleRedo,
  resetZoom100,
  zoomIn,
  zoomOut,
  setToolMode,
  selectedIds,
  deleteSelectedNodes
} from "./store";

export const App: Component = () => {
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === "Backspace" || e.key === "Delete") {
      if (selectedIds().size > 0) {
        e.preventDefault();
        deleteSelectedNodes();
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "0") {
      e.preventDefault();
      resetZoom100();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoomIn();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      zoomOut();
      return;
    }
    if (e.altKey && e.key === "\\") {
      setInspectorVisible(!inspectorVisible());
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "Escape" || e.key.toLowerCase() === "v") {
      setToolMode("select");
    } else if (e.key.toLowerCase() === "f") {
      setToolMode("frame");
    } else if (e.key.toLowerCase() === "r") {
      setToolMode("rect");
    } else if (e.key.toLowerCase() === "t") {
      setToolMode("text");
    } else if (e.key === "\\" || e.key === "[") {
      setLayersVisible(!layersVisible());
    } else if (e.key === "]") {
      setInspectorVisible(!inspectorVisible());
    }
  };


  onMount(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleGlobalKeyDown);
  });

  return (
    <div class="relative w-screen h-screen overflow-hidden bg-neutral-100">
      <CanvasView />
      <Toolbar />
      <ChatPanel />
      <ToolRail />
      <ZoomControls />
      <Show when={layersVisible()}>
        <LayersPanel />
      </Show>
      <Show when={inspectorVisible()}>
        <InspectorPanel />
      </Show>
      <Show when={typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1"}>
        <PerfHUD />
      </Show>
    </div>
  );
};

