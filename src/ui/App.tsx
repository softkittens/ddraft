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
  zoomToFit,
  zoomIn,
  zoomOut,
  setToolMode,
  selectedIds,
  deleteSelectedNodes,
  clipboard,
  copySelection,
  cutSelection,
  pasteClipboard,
  duplicateSelection
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

    // Clipboard before the zoom shortcuts: they share the Cmd modifier, and a
    // key that falls through to the tool-mode branch below would switch tools.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "c" && selectedIds().size > 0) {
        e.preventDefault();
        copySelection();
        return;
      }
      if (key === "x" && selectedIds().size > 0) {
        e.preventDefault();
        cutSelection();
        return;
      }
      if (key === "v") {
        // Only swallow the keystroke when there is something to paste, so a
        // browser paste of an image onto the canvas still reaches the page.
        if (clipboard()) {
          e.preventDefault();
          pasteClipboard();
          return;
        }
      }
      if (key === "d" && selectedIds().size > 0) {
        e.preventDefault();
        duplicateSelection();
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
    if (((e.metaKey || e.ctrlKey) && e.key === "1") || (e.shiftKey && e.key === "1")) {
      e.preventDefault();
      zoomToFit({ animate: true });
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

