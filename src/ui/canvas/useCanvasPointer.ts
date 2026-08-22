import { createSignal, onMount, onCleanup, type Accessor } from "solid-js";
import { screenToWorld, panCamera, zoomAtScreenPoint, type Point } from "../../interaction/camera";
import { hitTestScene, hitTestSceneWorld } from "../../interaction/hittest";
import { handleDragMove, commitDragDrop, pastDragThreshold, type DragSession } from "../../interaction/drag";
import { duplicateNode, getNextNodeId } from "../../model/edit";
import { cloneDocument } from "../../model/tree";
import { snapshotPositions, trackLayoutTransitionsFromSnapshot } from "../../interaction/animate";
import { telemetry } from "../../telemetry/logger";
import type { PenNode } from "../../model/types";
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
} from "../store";
import { insertNodeAtWorld } from "./types";

export function useCanvasPointer(opts: {
  getCanvas: () => HTMLCanvasElement | undefined;
  isSpace: () => boolean;
  isAltHeld: Accessor<boolean>;
}) {
  let isPanning = false;
  let startPan = { x: 0, y: 0 };
  let pendingPress: DragSession | null = null;
  let lastWorldMouse: Point | null = null;

  const [dragSession, setDragSession] = createSignal<DragSession | null>(null);
  const [shapeStart, setShapeStart] = createSignal<Point | null>(null);
  const [shapeCurrent, setShapeCurrent] = createSignal<Point | null>(null);

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
    const canvas = opts.getCanvas();
    if (!canvas) return;
    if (e.button === 1 || (e.button === 0 && opts.isSpace())) {
      isPanning = true;
      startPan = { x: e.clientX, y: e.clientY };
      return;
    }

    const rectBounds = canvas.getBoundingClientRect();
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
      const alreadySelected = selectedIds().has(hit.id);
      const isMultiKey = e.metaKey || e.ctrlKey;
      if (!alreadySelected || isMultiKey) {
        selectNode(hit.id, isMultiKey);
      }

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
    const canvas = opts.getCanvas();
    if (!canvas) return;

    if (isPanning) {
      const dx = e.clientX - startPan.x;
      const dy = e.clientY - startPan.y;
      startPan = { x: e.clientX, y: e.clientY };
      setCamera((c) => panCamera(c, dx, dy));
      return;
    }

    const rectBounds = canvas.getBoundingClientRect();
    const screenPt = { x: e.clientX - rectBounds.left, y: e.clientY - rectBounds.top };
    const world = screenToWorld(screenPt, camera());
    lastWorldMouse = world;

    if (shapeStart()) {
      setShapeCurrent(world);
      return;
    }

    if (pendingPress && !dragSession()) {
      if (pastDragThreshold(pendingPress.startWorld, world)) {
        setDragSession(pendingPress);
        pendingPress = null;
        canvas.style.cursor = opts.isAltHeld() ? "copy" : "grabbing";
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
    const canvas = opts.getCanvas();
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
        newNode = {
          type: "frame",
          id,
          x,
          y,
          width: w,
          height: h,
          fill: "#ffffff",
          stroke: "#e5e5e5",
          strokeWidth: 1,
          children: []
        };
      } else if (mode === "text") {
        const isDraggedSpan = w > 40;
        newNode = {
          type: "text",
          id,
          x,
          y,
          content: "New Text",
          fontSize: 14,
          fill: "#1e293b",
          ...(isDraggedSpan ? { width: w, textGrowth: "fixed-width" } : {})
        };
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
      const oldPositions = snapshotPositions(layoutTree());

      if (opts.isAltHeld()) {
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
      if (canvas) canvas.style.cursor = "default";
    }
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const screenPt = { x: e.offsetX, y: e.offsetY };

    if (e.ctrlKey || e.metaKey) {
      const delta = Math.max(-100, Math.min(100, e.deltaY));
      const zoomFactor = Math.exp(-delta * 0.008);
      setCamera((c) => zoomAtScreenPoint(c, screenPt, c.zoom * zoomFactor));
    } else {
      setCamera((c) => panCamera(c, -e.deltaX, -e.deltaY));
    }
  };

  const handleBlur = () => {
    isPanning = false;
    pendingPress = null;
  };

  onMount(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleBlur);
  });

  onCleanup(() => {
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("blur", handleBlur);
  });

  return {
    dragSession,
    shapeStart,
    shapeCurrent,
    handleMouseDown,
    handleWheel,
    onAltModifierChange: (held: boolean) => {
      const canvas = opts.getCanvas();
      if (dragSession() && lastWorldMouse) {
        if (canvas) canvas.style.cursor = held ? "copy" : "grabbing";
        syncDragState(lastWorldMouse);
      }
    }
  };
}
