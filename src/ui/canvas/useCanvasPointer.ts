import { createSignal, onMount, onCleanup, type Accessor } from "solid-js";
import { screenToWorld, panCamera, applyWheelToCamera, type Point } from "../../interaction/camera";
import { hitTestSceneWorld, findNodeWorldBox, findNodesInMarquee, resolveFigmaClickTarget } from "../../interaction/hittest";
import { handleDragMove, commitDragDrop, pastDragThreshold, type DragSession, type AlignmentGuide } from "../../interaction/drag";
import { snapshotPositions, trackLayoutTransitionsFromSnapshot } from "../../interaction/animate";
import {
  applyResize,
  computeResizeSnap,
  cursorForHandle,
  handleAtScreenPoint,
  type ResizeHandle
} from "../../interaction/resize";
import { duplicateNode, getNextNodeId } from "../../model/edit";
import { splitInstanceId } from "../../model/instance";
import { cloneDocument } from "../../model/tree";
import { telemetry } from "../../telemetry/logger";
import type { PenNode } from "../../model/types";
import type { Box } from "../../layout/types";
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
  beginEdit,
  endEdit,
  layoutTree,
  nodeMap,
  selectNode,
  setEditingTextId,
  stopCameraAnimation
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
  let initialMarqueeSelection = new Set<string>();
  let canvasRect: DOMRect | null = null;

  function invalidateCanvasRect() {
    canvasRect = null;
  }

  function screenPointOf(e: { clientX: number; clientY: number; offsetX: number; offsetY: number }): Point {
    const canvas = opts.getCanvas();
    if (!canvas) return { x: e.offsetX, y: e.offsetY };
    if (!canvasRect) canvasRect = canvas.getBoundingClientRect();
    return { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top };
  }

  const [dragSession, setDragSession] = createSignal<DragSession | null>(null);
  const [shapeStart, setShapeStart] = createSignal<Point | null>(null);
  const [shapeCurrent, setShapeCurrent] = createSignal<Point | null>(null);
  const [marqueeStart, setMarqueeStart] = createSignal<Point | null>(null);
  const [marqueeCurrent, setMarqueeCurrent] = createSignal<Point | null>(null);

  /**
   * A resize in progress.
   *
   * `startBox` is the node's *measured* box, which is what makes dragging a
   * hugging or filling node work: the first write is its rendered size plus the
   * delta, so auto sizing becomes a number the moment it is dragged.
   */
  interface ResizeSession {
    nodeId: string;
    handle: ResizeHandle;
    startWorld: Point;
    startBox: Box;
    guides?: AlignmentGuide[];
  }
  const [resizeSession, setResizeSession] = createSignal<ResizeSession | null>(null);

  const worldBoxToScreen = (box: Box): Box => {
    const cam = camera();
    return {
      x: box.x * cam.zoom + cam.x,
      y: box.y * cam.zoom + cam.y,
      width: box.width * cam.zoom,
      height: box.height * cam.zoom
    };
  };

  /** The handle under a screen point, across everything selected. */
  const handleUnderPointer = (screenPt: Point): { nodeId: string; handle: ResizeHandle } | null => {
    for (const id of selectedIds()) {
      const world = findNodeWorldBox(layoutTree(), id);
      if (!world) continue;
      const found = handleAtScreenPoint(worldBoxToScreen(world), screenPt);
      if (found) return { nodeId: id, handle: found };
    }
    return null;
  };

  // Held while dragging, this suspends snapping the way ⌘ does in Figma — the
  // escape hatch for placing something one pixel off a guide on purpose.
  let snapDisabled = false;

  function syncDragState(world: Point) {
    const current = dragSession();
    if (!current) return;
    const stopDrag = telemetry.startSpan("interaction:drag");
    const updated = { ...current, snapDisabled };
    const oldPositions = snapshotPositions(layoutTree());
    const workingDoc = cloneDocument(doc());
    handleDragMove(workingDoc, updated, world, layoutTree(), nodeMap(), camera().zoom, opts.isSpace());
    if (updated.reordered) {
      updated.reordered = false;
      updateDoc(workingDoc);
      trackLayoutTransitionsFromSnapshot(oldPositions, layoutTree(), 200);
    }
    stopDrag();
    setDragSession(updated);
  }

  function updateHoverAt(world: Point, isDeepSelect: boolean) {
    const stopHit = telemetry.startSpan("interaction:hittest");
    const hitResult = hitTestSceneWorld(layoutTree(), world, nodeMap());
    const hit = hitResult
      ? resolveFigmaClickTarget(hitResult.path, selectedIds(), isDeepSelect)
      : null;
    stopHit();
    const newHover = hit ? hit.id : null;
    if (newHover !== hoveredId()) {
      setHoveredId(newHover);
    }
  }

  const handleMouseDown = (e: MouseEvent) => {
    const canvas = opts.getCanvas();
    if (!canvas) return;
    if (e.button === 1 || (e.button === 0 && opts.isSpace())) {
      stopCameraAnimation();
      isPanning = true;
      startPan = { x: e.clientX, y: e.clientY };
      invalidateCanvasRect();
      return;
    }

    const screenPt = screenPointOf(e);
    const world = screenToWorld(screenPt, camera());

    // Before hit testing: a handle sits on its node's edge, so whichever is
    // under the pointer there, the handle is the one that was aimed at.
    if (toolMode() === "select") {
      const grabbed = handleUnderPointer(screenPt);
      if (grabbed) {
        const startBox = findNodeWorldBox(layoutTree(), grabbed.nodeId);
        if (startBox) {
          // One undo step for the whole drag, however many frames it takes.
          beginEdit();
          setResizeSession({ ...grabbed, startWorld: world, startBox });
          canvas.style.cursor = cursorForHandle(grabbed.handle);
          return;
        }
      }
    }

    if (toolMode() !== "select") {
      setShapeStart(world);
      setShapeCurrent(world);
      return;
    }

    const stopHit = telemetry.startSpan("interaction:hittest");
    const hitResult = hitTestSceneWorld(layoutTree(), world, nodeMap());
    stopHit();

    const isShiftHeld = e.shiftKey;
    const isDeepSelect = e.metaKey || e.ctrlKey;

    if (hitResult) {
      // Figma selection: single click selects top-level frame; clicking inside selects child; Cmd+click deep selects
      const targetNode = resolveFigmaClickTarget(hitResult.path, selectedIds(), isDeepSelect);
      const instanceTarget = splitInstanceId(doc(), targetNode.id);
      const targetId = instanceTarget?.refId ?? targetNode.id;
      const targetDoc = nodeMap().get(targetId);
      const isTextNode = targetDoc?.type === "text" || targetNode.type === "text";

      if (isDeepSelect && isTextNode) {
        // Holding Cmd + clicking a text node enters inline text edit mode (Figma behavior)
        selectNode(targetId, false);
        setEditingTextId(targetId);
        return;
      }

      const targetHit = instanceTarget
        ? hitResult.path.find((node) => node.id === targetId) ?? targetNode
        : targetNode;
      const targetWorld = instanceTarget ? findNodeWorldBox(layoutTree(), targetId) : null;

      const alreadySelected = selectedIds().has(targetId);
      if (!alreadySelected || isShiftHeld) {
        selectNode(targetId, isShiftHeld);
      }

      pendingPress = {
        nodeId: targetId,
        startWorld: world,
        currentWorld: world,
        initialNodeX: targetDoc?.x ?? targetHit.box.x,
        initialNodeY: targetDoc?.y ?? targetHit.box.y,
        worldOffset: targetWorld
          ? { x: targetWorld.x, y: targetWorld.y }
          : { x: hitResult.worldX, y: hitResult.worldY },
        dimensions: { width: targetHit.box.width, height: targetHit.box.height }
      };
    } else {
      if (!isShiftHeld) {
        setSelectedIds(new Set<string>());
      }
      setMarqueeStart(world);
      setMarqueeCurrent(world);
      initialMarqueeSelection = new Set(selectedIds());
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

    const screenPt = screenPointOf(e);
    const world = screenToWorld(screenPt, camera());
    lastWorldMouse = world;
    snapDisabled = e.metaKey || e.ctrlKey;

    const resizing = resizeSession();
    if (resizing) {
      const snapResult = computeResizeSnap(
        layoutTree(),
        resizing.nodeId,
        resizing.handle,
        resizing.startBox,
        world.x - resizing.startWorld.x,
        world.y - resizing.startWorld.y,
        { fromCenter: e.altKey, aspect: e.shiftKey, min: 1, snapDisabled },
        camera().zoom
      );
      setResizeSession({ ...resizing, guides: snapResult.guides });
      // Written through the document rather than drawn as a preview, so an
      // auto-layout parent reflows and text rewraps while the edge is moving —
      // the drag ghost approach can only show the box that is being dragged.
      updateDoc(applyResize(doc(), resizing.nodeId, resizing.handle, snapResult.box, { fromCenter: e.altKey }));
      return;
    }

    if (shapeStart()) {
      setShapeCurrent(world);
      return;
    }

    const mStart = marqueeStart();
    if (mStart) {
      setMarqueeCurrent(world);
      const mBox = {
        x: Math.min(mStart.x, world.x),
        y: Math.min(mStart.y, world.y),
        width: Math.abs(world.x - mStart.x),
        height: Math.abs(world.y - mStart.y)
      };
      const hitIds = findNodesInMarquee(layoutTree(), mBox, nodeMap());
      const isMultiKey = e.metaKey || e.ctrlKey || e.shiftKey;
      if (isMultiKey) {
        setSelectedIds(new Set([...initialMarqueeSelection, ...hitIds]), { recordHistory: false });
      } else {
        setSelectedIds(new Set(hitIds), { recordHistory: false });
      }
      return;
    }

    if (pendingPress && !dragSession()) {
      if (pastDragThreshold(pendingPress.startWorld, world)) {
        beginEdit();
        setDragSession(pendingPress);
        pendingPress = null;
        canvas.style.cursor = opts.isAltHeld() ? "copy" : "grabbing";
      }
    }

    const current = dragSession();
    if (current) {
      syncDragState(world);
    } else {
      // The cursor is the only thing announcing the edge bands, which carry no
      // handle of their own.
      const overHandle = toolMode() === "select" ? handleUnderPointer(screenPt) : null;
      canvas.style.cursor = overHandle ? cursorForHandle(overHandle.handle) : "default";

      updateHoverAt(world, e.metaKey || e.ctrlKey);
    }
  };

  const handleMouseUp = () => {
    const canvas = opts.getCanvas();
    isPanning = false;
    pendingPress = null;

    if (resizeSession()) {
      // Every frame of the drag wrote to the document with the edit open, so
      // this is what turns all of them into one entry.
      endEdit();
      setResizeSession(null);
      if (canvas) canvas.style.cursor = "default";
      return;
    }

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

    const mStart = marqueeStart();
    if (mStart) {
      setMarqueeStart(null);
      setMarqueeCurrent(null);
      initialMarqueeSelection.clear();
      setSelectedIds((prev) => new Set(prev));
      return;
    }

    const current = dragSession();
    if (current) {
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
      endEdit();

      setDragSession(null);
      if (canvas) canvas.style.cursor = "default";
    }
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    stopCameraAnimation();
    const screenPt = screenPointOf(e);

    let dx = e.deltaX;
    let dy = e.deltaY;

    // Shift + Wheel -> horizontal pan (Figma convention)
    if (e.shiftKey && dx === 0) {
      dx = dy;
      dy = 0;
    }

    setCamera((c) => applyWheelToCamera(c, screenPt, dx, dy, e.ctrlKey, e.deltaMode));
  };

  const handleBlur = () => {
    if (resizeSession()) {
      endEdit();
      setResizeSession(null);
    }
    if (dragSession()) {
      endEdit();
      setDragSession(null);
    }
    isPanning = false;
    pendingPress = null;
    setMarqueeStart(null);
    setMarqueeCurrent(null);
    initialMarqueeSelection.clear();
  };

  const handleDoubleClick = (e: MouseEvent) => {
    const canvas = opts.getCanvas();
    if (!canvas) return;

    const world = screenToWorld(screenPointOf(e), camera());
    const hit = hitTestSceneWorld(layoutTree(), world, nodeMap());
    if (hit) {
      const textNode = hit.node.type === "text" ? hit.node : hit.path.slice().reverse().find((n) => n.type === "text");
      if (textNode) {
        setEditingTextId(textNode.id);
        setSelectedIds(new Set([textNode.id]));
        return;
      }

      // Double-click jumps straight into the clicked child element
      const instanceTarget = splitInstanceId(doc(), hit.node.id);
      const targetId = instanceTarget?.refId ?? hit.node.id;
      selectNode(targetId, false);
    }
  };

  const handleKeyModifier = (e: KeyboardEvent) => {
    if ((e.key === "Meta" || e.key === "Control") && lastWorldMouse && !dragSession()) {
      updateHoverAt(lastWorldMouse, e.type === "keydown");
    }
  };

  onMount(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("keydown", handleKeyModifier);
    window.addEventListener("keyup", handleKeyModifier);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("resize", invalidateCanvasRect);
  });

  onCleanup(() => {
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
    window.removeEventListener("dblclick", handleDoubleClick);
    window.removeEventListener("keydown", handleKeyModifier);
    window.removeEventListener("keyup", handleKeyModifier);
    window.removeEventListener("blur", handleBlur);
    window.removeEventListener("resize", invalidateCanvasRect);
  });

  return {
    dragSession,
    resizeSession,
    shapeStart,
    shapeCurrent,
    marqueeStart,
    marqueeCurrent,
    handleMouseDown,
    handleWheel,
    invalidateCanvasRect,
    onAltModifierChange: (held: boolean) => {
      const canvas = opts.getCanvas();
      if (dragSession() && lastWorldMouse) {
        if (canvas) canvas.style.cursor = held ? "copy" : "grabbing";
        syncDragState(lastWorldMouse);
      }
    }
  };
}
