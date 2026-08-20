import { Component, Show, onMount, onCleanup } from "solid-js";
import { Toolbar } from "./Toolbar";
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
  setToolMode
} from "./store";

export const App: Component = () => {
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

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
    <div class="flex flex-col w-screen h-screen overflow-hidden bg-neutral-100">
      <Toolbar />
      <div class="flex flex-1 overflow-hidden relative">
        <Show when={layersVisible()}>
          <LayersPanel />
        </Show>

        <div class="flex-1 h-full relative overflow-hidden flex">
          <CanvasView />
          <ChatPanel />
        </div>

        <Show when={inspectorVisible()}>
          <InspectorPanel />
        </Show>

        <PerfHUD />
      </div>
    </div>
  );
};

