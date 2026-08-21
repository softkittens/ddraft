import { createEffect, onMount, onCleanup, Show, type Component } from "solid-js";
import {
  doc,
  camera,
  selectedIds,
  hoveredId,
  layoutTree,
  nodeMap
} from "./store";
import { setupCanvas, setImageInvalidator } from "../render/paint";
import { hasActiveAnimations } from "../interaction/animate";
import { telemetry } from "../telemetry/logger";
import { renderScene } from "./canvas/renderScene";
import { useKeyboardControls } from "./canvas/useKeyboardControls";
import { useCanvasPointer } from "./canvas/useCanvasPointer";
import { useFileDrop } from "./canvas/useFileDrop";

export const CanvasView: Component = () => {
  let containerRef: HTMLDivElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let animFrameId: number | undefined;

  const keyboard = useKeyboardControls({
    onAltChange: (held) => pointer.onAltModifierChange(held)
  });

  const pointer = useCanvasPointer({
    getCanvas: () => canvasRef,
    isSpace: () => keyboard.isSpace,
    isAltHeld: keyboard.isAltHeld
  });

  const fileDrop = useFileDrop(() => canvasRef);

  function render() {
    if (!canvasRef || !containerRef) return;
    const width = containerRef.clientWidth;
    const height = containerRef.clientHeight;
    if (width === 0 || height === 0) return;

    const stopPaint = telemetry.startSpan("render:paint");
    const ctx = setupCanvas(canvasRef, width, height);
    if (!ctx) return;

    renderScene(ctx, width, height, {
      camera: camera(),
      tree: layoutTree(),
      map: nodeMap(),
      variables: doc().variables,
      selectedIds: selectedIds(),
      hoveredId: hoveredId(),
      dragSession: pointer.dragSession(),
      isAltHeld: keyboard.isAltHeld(),
      shapeStart: pointer.shapeStart(),
      shapeCurrent: pointer.shapeCurrent()
    });

    stopPaint();
    telemetry.recordFrame(nodeMap().size);

    if (hasActiveAnimations()) {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(render);
    }
  }

  createEffect(() => {
    doc();
    camera();
    selectedIds();
    hoveredId();
    pointer.dragSession();
    keyboard.isAltHeld();
    pointer.shapeStart();
    pointer.shapeCurrent();

    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(render);
  });

  onMount(() => {
    setImageInvalidator(() => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(render);
    });

    if (canvasRef) {
      canvasRef.addEventListener("wheel", pointer.handleWheel, { passive: false });
    }

    if (containerRef) {
      resizeObserver = new ResizeObserver(() => {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        animFrameId = requestAnimationFrame(render);
      });
      resizeObserver.observe(containerRef);
    }
  });

  onCleanup(() => {
    setImageInvalidator(null);
    if (canvasRef) {
      canvasRef.removeEventListener("wheel", pointer.handleWheel);
    }
    if (resizeObserver) resizeObserver.disconnect();
    if (animFrameId) cancelAnimationFrame(animFrameId);
  });

  return (
    <div
      ref={containerRef}
      onDragOver={fileDrop.handleDragOver}
      onDragLeave={fileDrop.handleDragLeave}
      onDrop={fileDrop.handleDrop}
      class="flex-1 h-full min-w-0 relative overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        onMouseDown={pointer.handleMouseDown}
        class="w-full h-full block"
      />
      <Show when={fileDrop.isDragOverCanvas()}>
        <div class="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500 pointer-events-none flex items-center justify-center z-50">
          <div class="bg-blue-600 text-white font-medium text-sm px-4 py-2 rounded-xl shadow-lg flex items-center gap-2">
            <span>Drop image to place reference on canvas</span>
          </div>
        </div>
      </Show>
      <Show when={doc().children.length === 0 && !fileDrop.isDragOverCanvas()}>
        <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div class="text-center text-neutral-400 max-w-xs">
            <div class="text-sm font-medium text-neutral-600 mb-1">Empty canvas</div>
            <div class="text-xs leading-relaxed">Prompt the agent, or open a .pen file, to start a design.</div>
          </div>
        </div>
      </Show>
    </div>
  );
};
