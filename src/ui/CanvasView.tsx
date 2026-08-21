import { createSignal, createEffect, onMount, onCleanup, Show, type Component } from "solid-js";
import {
  doc,
  camera,
  selectedIds,
  hoveredId,
  toolMode,
  setSelectedIds,
  setHoveredId,
  setCamera,
  setToolMode,
  updateDoc,
  layoutTree,
  nodeMap,
  selectNode
} from "./store";
import { screenToWorld, panCamera, zoomAtScreenPoint, type Point } from "../interaction/camera";
import { hitTestScene, hitTestSceneWorld, nearestFrameHit, worldPointToFrameLocal } from "../interaction/hittest";
import { setupCanvas, paintNode, setImageInvalidator } from "../render/paint";
import { paintSelectionOverlay } from "../interaction/selection";
import { handleDragMove, commitDragDrop, pastDragThreshold, type DragSession } from "../interaction/drag";
import { duplicateNode, getNextNodeId, insertChild } from "../model/edit";
import { cloneDocument } from "../model/tree";
import { flattenLayoutTree } from "../layout/layout";
import { trackLayoutTransitionsFromSnapshot, snapshotPositions, pruneFinishedAnimations, getAnimatedPositions, hasActiveAnimations } from "../interaction/animate";
import { telemetry } from "../telemetry/logger";
import type { Document, PenNode } from "../model/types";

function insertNodeAtWorld(node: PenNode, world: Point, skipFrameId?: string): Document {
  const hit = hitTestSceneWorld(layoutTree(), world, nodeMap());
  const frameHit = hit ? nearestFrameHit(hit) : null;
  if (frameHit && frameHit.node.id !== skipFrameId) {
    const local = worldPointToFrameLocal(world, frameHit);
    node.x = Math.round(local.x);
    node.y = Math.round(local.y);
    return insertChild(doc(), frameHit.node.id, node);
  }
  const next = cloneDocument(doc());
  next.children.push(node);
  return next;
}

export const CanvasView: Component = () => {
  let containerRef: HTMLDivElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let animFrameId: number | undefined;

  let isPanning = false;
  let startPan = { x: 0, y: 0 };
  let isSpace = false;

  let pendingPress: DragSession | null = null;
  let lastWorldMouse: Point | null = null;

  // Reactive signals for drag, shape drawing, and Alt modifier
  const [dragSession, setDragSession] = createSignal<DragSession | null>(null);
  const [isAltHeld, setIsAltHeld] = createSignal<boolean>(false);
  const [shapeStart, setShapeStart] = createSignal<Point | null>(null);
  const [shapeCurrent, setShapeCurrent] = createSignal<Point | null>(null);

  function render() {
    if (!canvasRef || !containerRef) return;
    const width = containerRef.clientWidth;
    const height = containerRef.clientHeight;
    if (width === 0 || height === 0) return;

    const stopPaint = telemetry.startSpan("render:paint");

    const ctx = setupCanvas(canvasRef, width, height);
    if (!ctx) return;

    const cam = camera();

    ctx.save();
    ctx.fillStyle = "#e8eaed";
    ctx.fillRect(0, 0, width, height);

    // Draw background grid dots (batched into a single path)
    const gridSize = 20 * cam.zoom;
    if (gridSize >= 8) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
      ctx.beginPath();
      const offsetX = ((cam.x % gridSize) + gridSize) % gridSize;
      const offsetY = ((cam.y % gridSize) + gridSize) % gridSize;
      for (let x = offsetX; x < width; x += gridSize) {
        for (let y = offsetY; y < height; y += gridSize) {
          ctx.rect(x - 0.5, y - 0.5, 1, 1);
        }
      }
      ctx.fill();
    }

    // World coordinate transform
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);

    const tree = layoutTree();
    const map = nodeMap();
    pruneFinishedAnimations();
    const animPositions = getAnimatedPositions();

    // Draw frame titles above root frames
    ctx.font = `${11 / cam.zoom}px -apple-system, sans-serif`;
    for (const root of tree) {
      if (root.type === "frame") {
        const rootDoc = map.get(root.id);
        const name = rootDoc?.name || root.id;
        const isSel = selectedIds().has(root.id);
        ctx.fillStyle = isSel ? "#0d99ff" : "rgba(0, 0, 0, 0.45)";
        ctx.fillText(name, root.box.x, root.box.y - 7);
      }
    }

    // Paint scene nodes (if Alt is held, keep original visible; otherwise skip original slot during drag)
    const currentDrag = dragSession();
    const alt = isAltHeld();
    const skipId = currentDrag && !alt ? currentDrag.nodeId : undefined;
    for (const root of tree) {
      paintNode(ctx, root, map, doc().variables, { skipNodeId: skipId, animatedPositions: animPositions });
    }

    // Paint drop target highlights & dashed insertion lines
    if (currentDrag?.targetContainerBox) {
      const tb = currentDrag.targetContainerBox;
      ctx.save();
      ctx.strokeStyle = "#0d99ff";
      ctx.lineWidth = 2 / cam.zoom;
      ctx.strokeRect(tb.x, tb.y, tb.width, tb.height);
      ctx.restore();
    }
    if (currentDrag?.dropIndicator) {
      const { x1, y1, x2, y2 } = currentDrag.dropIndicator;
      ctx.save();
      ctx.strokeStyle = "#0d99ff";
      ctx.lineWidth = 2 / cam.zoom;
      ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }

    // Paint selection and hover bounding box overlay
    for (const root of tree) {
      paintSelectionOverlay(ctx, root, selectedIds(), hoveredId(), cam.zoom);
    }

    // Paint 60fps fast-path floating elevated drag ghost
    if (currentDrag) {
      const draggedLayout = flattenLayoutTree(tree).get(currentDrag.nodeId);
      if (draggedLayout) {
        const dx = currentDrag.currentWorld.x - currentDrag.startWorld.x;
        const dy = currentDrag.currentWorld.y - currentDrag.startWorld.y;

        const ghostX = currentDrag.worldOffset.x + dx;
        const ghostY = currentDrag.worldOffset.y + dy;

        ctx.save();
        ctx.globalAlpha = 0.88;
        ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
        ctx.shadowBlur = 16 / cam.zoom;
        ctx.shadowOffsetY = 8 / cam.zoom;

        ctx.translate(ghostX - draggedLayout.box.x, ghostY - draggedLayout.box.y);
        paintNode(ctx, draggedLayout, map, doc().variables);

        ctx.strokeStyle = "#0d99ff";
        ctx.lineWidth = 1.5 / cam.zoom;
        ctx.strokeRect(draggedLayout.box.x, draggedLayout.box.y, draggedLayout.box.width, draggedLayout.box.height);

        ctx.restore();
      }
    }

    // Paint shape drawing preview
    const sStart = shapeStart();
    const sCurrent = shapeCurrent();
    if (sStart && sCurrent) {
      const x = Math.min(sStart.x, sCurrent.x);
      const y = Math.min(sStart.y, sCurrent.y);
      const w = Math.abs(sCurrent.x - sStart.x);
      const h = Math.abs(sCurrent.y - sStart.y);
      ctx.save();
      ctx.strokeStyle = "#0d99ff";
      ctx.lineWidth = 1 / cam.zoom;
      ctx.setLineDash([4 / cam.zoom, 4 / cam.zoom]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }

    ctx.restore();
    stopPaint();
    telemetry.recordFrame(map.size);

    if (hasActiveAnimations()) {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(render);
    }
  }

  function syncDragState(world: Point) {
    const current = dragSession();
    if (!current) return;
    const stopDrag = telemetry.startSpan("interaction:drag");

    const updated = { ...current };
    handleDragMove(doc(), updated, world, layoutTree(), nodeMap());
    stopDrag();
    setDragSession(updated);
  }

  const handleMouseDown = (e: MouseEvent) => {
    if (!canvasRef) return;
    if (e.button === 1 || (e.button === 0 && isSpace)) {
      isPanning = true;
      startPan = { x: e.clientX, y: e.clientY };
      return;
    }

    const rectBounds = canvasRef.getBoundingClientRect();
    const screenPt = { x: e.clientX - rectBounds.left, y: e.clientY - rectBounds.top };
    const world = screenToWorld(screenPt, camera());

    if (toolMode() !== "select") {
      setShapeStart(world);
      setShapeCurrent(world);
      return;
    }

    const stopHit = telemetry.startSpan("interaction:hittest");
    const hitResult = hitTestSceneWorld(layoutTree(), world, nodeMap());
    stopHit();

    if (hitResult) {
      const hit = hitResult.node;
      selectNode(hit.id, e.metaKey || e.ctrlKey);

      // Prepare potential drag session with correct world-space offset
      const targetDoc = nodeMap().get(hit.id);
      pendingPress = {
        nodeId: hit.id,
        startWorld: world,
        currentWorld: world,
        initialNodeX: targetDoc?.x ?? hit.box.x,
        initialNodeY: targetDoc?.y ?? hit.box.y,
        worldOffset: { x: hitResult.worldX, y: hitResult.worldY },
        dimensions: { width: hit.box.width, height: hit.box.height }
      };
    } else {
      setSelectedIds(new Set<string>());
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!canvasRef) return;

    if (isPanning) {
      const dx = e.clientX - startPan.x;
      const dy = e.clientY - startPan.y;
      startPan = { x: e.clientX, y: e.clientY };
      setCamera((c) => panCamera(c, dx, dy));
      return;
    }

    const rectBounds = canvasRef.getBoundingClientRect();
    const screenPt = { x: e.clientX - rectBounds.left, y: e.clientY - rectBounds.top };
    const world = screenToWorld(screenPt, camera());
    lastWorldMouse = world;

    if (shapeStart()) {
      setShapeCurrent(world);
      return;
    }

    // Check drag threshold
    if (pendingPress && !dragSession()) {
      if (pastDragThreshold(pendingPress.startWorld, world)) {
        setDragSession(pendingPress);
        pendingPress = null;
        if (canvasRef) canvasRef.style.cursor = isAltHeld() ? "copy" : "grabbing";
      }
    }

    const current = dragSession();
    if (current) {
      syncDragState(world);
    } else {
      const stopHit = telemetry.startSpan("interaction:hittest");
      const hit = hitTestScene(layoutTree(), world, nodeMap());
      stopHit();
      const newHover = hit ? hit.id : null;
      if (newHover !== hoveredId()) {
        setHoveredId(newHover);
      }
    }
  };

  const handleMouseUp = () => {
    isPanning = false;
    pendingPress = null;

    const sStart = shapeStart();
    const sCurrent = shapeCurrent();
    if (sStart && sCurrent) {
      const x = Math.min(sStart.x, sCurrent.x);
      const y = Math.min(sStart.y, sCurrent.y);
      const w = Math.max(20, Math.abs(sCurrent.x - sStart.x));
      const h = Math.max(20, Math.abs(sCurrent.y - sStart.y));
      const mode = toolMode();
      const prefix = mode === "frame" ? "frame" : mode === "text" ? "text" : "rect";
      const id = getNextNodeId(doc(), prefix);

      let newNode: PenNode;
      if (mode === "frame") {
        newNode = { type: "frame", id, x, y, width: w, height: h, fill: "#ffffff", stroke: "#e5e5e5", strokeWidth: 1, children: [] };
      } else if (mode === "text") {
        newNode = { type: "text", id, x, y, content: "New Text", fontSize: 14, fill: "#1e293b" };
      } else {
        newNode = { type: "rectangle", id, x, y, width: w, height: h, fill: "#0d99ff" };
      }

      updateDoc(insertNodeAtWorld(newNode, { x, y }));
      setSelectedIds(new Set([id]));

      setShapeStart(null);
      setShapeCurrent(null);
      setToolMode("select");
      return;
    }

    const current = dragSession();
    if (current) {
      // Snapshot old positions cheaply (no full tree clone)
      const oldPositions = snapshotPositions(layoutTree());

      if (isAltHeld()) {
        // High-Performance Alt-Duplicate Commit: Clone once on release!
        const dup = duplicateNode(doc(), current.nodeId);
        if (dup) {
          const effectiveSession: DragSession = { ...current, nodeId: dup.newId };
          commitDragDrop(dup.doc, effectiveSession);
          updateDoc(dup.doc);
          setSelectedIds(new Set([dup.newId]));
        }
      } else {
        const nextDoc = cloneDocument(doc());
        commitDragDrop(nextDoc, current);
        updateDoc(nextDoc);
      }

      trackLayoutTransitionsFromSnapshot(oldPositions, layoutTree(), 220);

      setDragSession(null);
      if (canvasRef) canvasRef.style.cursor = "default";
    }
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!canvasRef) return;
    const rectBounds = canvasRef.getBoundingClientRect();
    const screenPt = { x: e.clientX - rectBounds.left, y: e.clientY - rectBounds.top };

    if (e.ctrlKey || e.metaKey) {
      const delta = Math.max(-100, Math.min(100, e.deltaY));
      const zoomFactor = Math.exp(-delta * 0.008);
      setCamera((c) => zoomAtScreenPoint(c, screenPt, c.zoom * zoomFactor));
    } else {
      setCamera((c) => panCamera(c, -e.deltaX, -e.deltaY));
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") isSpace = true;
    if (e.key === "Alt") {
      setIsAltHeld(true);
      if (dragSession() && lastWorldMouse) {
        if (canvasRef) canvasRef.style.cursor = "copy";
        syncDragState(lastWorldMouse);
      }
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") isSpace = false;
    if (e.key === "Alt") {
      setIsAltHeld(false);
      if (dragSession() && lastWorldMouse) {
        if (canvasRef) canvasRef.style.cursor = "default";
        syncDragState(lastWorldMouse);
      }
    }
  };

  const handleBlur = () => {
    isSpace = false;
    setIsAltHeld(false);
    if (dragSession() && canvasRef) {
      canvasRef.style.cursor = "default";
    }
  };

  // Re-render whenever reactive state changes via a single coordinated animation frame
  createEffect(() => {
    doc();
    camera();
    selectedIds();
    hoveredId();
    dragSession();
    isAltHeld();
    shapeStart();
    shapeCurrent();

    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(render);
  });

  onMount(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    setImageInvalidator(() => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(render);
    });

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
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleBlur);
    if (resizeObserver) resizeObserver.disconnect();
    if (animFrameId) cancelAnimationFrame(animFrameId);
  });

  const [isDragOverCanvas, setIsDragOverCanvas] = createSignal(false);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    setIsDragOverCanvas(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOverCanvas(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOverCanvas(false);
    if (!canvasRef || !e.dataTransfer?.files?.length) return;

    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;

    const rectBounds = canvasRef.getBoundingClientRect();
    const screenPt = { x: e.clientX - rectBounds.left, y: e.clientY - rectBounds.top };
    const dropWorld = screenToWorld(screenPt, camera());

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (!dataUrl) return;

        const img = new Image();
        img.onload = () => {
          const maxDimension = 420;
          let w = img.naturalWidth || 360;
          let h = img.naturalHeight || 360;

          if (w > maxDimension || h > maxDimension) {
            if (w > h) {
              h = Math.round((h * maxDimension) / w);
              w = maxDimension;
            } else {
              w = Math.round((w * maxDimension) / h);
              h = maxDimension;
            }
          }

          const id = getNextNodeId(doc(), "img");
          const imageName = file.name.replace(/\.[^/.]+$/, "") || "Reference Image";

          const imageNode: PenNode = {
            id,
            type: "frame",
            name: `Image — ${imageName}`,
            x: Math.round(dropWorld.x),
            y: Math.round(dropWorld.y),
            width: w,
            height: h,
            cornerRadius: 16,
            clip: true,
            fill: { type: "image", url: dataUrl },
            children: []
          };

          updateDoc(insertNodeAtWorld(imageNode, dropWorld, id));
          setSelectedIds(new Set([id]));
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      class="flex-1 h-full min-w-0 relative overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        class="w-full h-full block"
      />
      <Show when={isDragOverCanvas()}>
        <div class="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-blue-500 pointer-events-none flex items-center justify-center z-50">
          <div class="bg-blue-600 text-white font-medium text-sm px-4 py-2 rounded-xl shadow-lg flex items-center gap-2">
            <span>Drop image to place reference on canvas</span>
          </div>
        </div>
      </Show>
      <Show when={doc().children.length === 0 && !isDragOverCanvas()}>
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
