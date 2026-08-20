import type { Document, PenNode } from "./model/types";
import type { LayoutNode } from "./layout/types";
import { parseDocument } from "./model/parse";
import { layoutDocument } from "./layout/layout";
import { setupCanvas, paintNode } from "./render/paint";
import { createCamera, zoomAtScreenPoint, panCamera, screenToWorld, type Point } from "./interaction/camera";
import { hitTestScene } from "./interaction/hittest";
import { createSelectionState, paintSelectionOverlay } from "./interaction/selection";
import { handleDragMove, commitDragDrop, paintDragGhost, pastDragThreshold, type DragSession } from "./interaction/drag";
import { trackLayoutTransitions, hasActiveAnimations, pruneFinishedAnimations, getAnimatedPositions } from "./interaction/animate";

import fixtureA from "../fixtures/A_control_r1.pen?raw";
import fixtureB from "../fixtures/B_contract_r1.pen?raw";
import fixtureC from "../fixtures/C_verify_r1.pen?raw";
import fixtureD from "../fixtures/D_hires_r1.pen?raw";
import fixtureD2 from "../fixtures/D_hires_r2.pen?raw";
import { resolveInstances } from "./model/instance";

const canvas = document.getElementById("viewport") as HTMLCanvasElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const openBtn = document.getElementById("openBtn") as HTMLButtonElement;
const fixtureSelect = document.getElementById("fixtureSelect") as HTMLSelectElement;

const fixtures: Record<string, string> = {
  A_control_r1: fixtureA,
  B_contract_r1: fixtureB,
  C_verify_r1: fixtureC,
  D_hires_r1: fixtureD,
  D_hires_r2: fixtureD2
};

let currentDoc: Document = parseDocument(fixtureA);
let camera = createCamera(40, 40, 1);
const selection = createSelectionState();
let dragSession: DragSession | null = null;
let pendingPress: DragSession | null = null;
let isPanning = false;
let startPan = { x: 0, y: 0 };
let isSpace = false;
let ctx: CanvasRenderingContext2D | null = null;
let nodeMap = new Map<string, PenNode>();
let layoutTree: LayoutNode[] = [];

window.addEventListener("error", (e) => {
  console.error(`[Engine Error] ${e.message} (${e.filename}:${e.lineno})`, e.error);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[Engine Unhandled Rejection]", e.reason);
});

function collectNodes(doc: Document): Map<string, PenNode> {
  const map = new Map<string, PenNode>();
  function walk(n: PenNode) {
    map.set(n.id, n);
    if ("children" in n && Array.isArray(n.children)) n.children.forEach(walk);
  }
  doc.children.forEach(walk);
  return map;
}

function invalidateLayout() {
  const resolved = resolveInstances(currentDoc);
  nodeMap = collectNodes(resolved);
  layoutTree = layoutDocument(currentDoc);
}

// Initialise layout and node map
invalidateLayout();

function loadDocument(text: string) {
  currentDoc = parseDocument(text);
  selection.selectedIds.clear();
  camera = createCamera(40, 40, 1);
  invalidateLayout();
}


function findNodeWorldOffset(roots: LayoutNode[], targetId: string, currentX = 0, currentY = 0): Point | null {
  for (const root of roots) {
    const wx = currentX + root.box.x;
    const wy = currentY + root.box.y;
    if (root.id === targetId) return { x: wx, y: wy };
    const res = findNodeWorldOffset(root.children, targetId, wx, wy);
    if (res) return res;
  }
  return null;
}

function findLayoutNode(roots: LayoutNode[], id: string): LayoutNode | null {
  for (const root of roots) {
    if (root.id === id) return root;
    const res = findLayoutNode(root.children, id);
    if (res) return res;
  }
  return null;
}

function resizeCanvas() {
  ctx = setupCanvas(canvas, window.innerWidth, window.innerHeight);
}

function render() {
  if (!ctx) return;

  pruneFinishedAnimations();
  const animPositions = getAnimatedPositions();

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  for (const root of layoutTree) {
    paintNode(ctx, root, nodeMap, currentDoc.variables, dragSession?.nodeId, animPositions);
  }

  for (const root of layoutTree) {
    paintSelectionOverlay(ctx, root, selection.selectedIds, selection.hoveredId, camera.zoom);
  }

  if (dragSession) {
    const draggedLayout = findLayoutNode(layoutTree, dragSession.nodeId);
    if (draggedLayout) {
      paintDragGhost(ctx, draggedLayout, dragSession, nodeMap, currentDoc.variables, camera.zoom);
    }
  }

  ctx.restore();

  if (hasActiveAnimations()) {
    requestAnimationFrame(render);
  }
}

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const factor = Math.exp(-e.deltaY * 0.01);
    camera = zoomAtScreenPoint(camera, { x: e.clientX, y: e.clientY }, camera.zoom * factor);
  } else {
    camera = panCamera(camera, -e.deltaX, -e.deltaY);
  }
  render();
}, { passive: false });

window.addEventListener("keydown", (e) => { if (e.code === "Space") isSpace = true; });
window.addEventListener("keyup", (e) => { if (e.code === "Space") isSpace = false; });

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 1 || (e.button === 0 && isSpace)) {
    isPanning = true;
    startPan = { x: e.clientX, y: e.clientY };
    return;
  }

  const world = screenToWorld({ x: e.clientX, y: e.clientY }, camera);
  const hit = hitTestScene(layoutTree, world);

  if (hit) {
    if (e.shiftKey) {
      if (selection.selectedIds.has(hit.id)) selection.selectedIds.delete(hit.id);
      else selection.selectedIds.add(hit.id);
    } else {
      selection.selectedIds.clear();
      selection.selectedIds.add(hit.id);
    }
    const node = nodeMap.get(hit.id);
    const offset = findNodeWorldOffset(layoutTree, hit.id) || { x: node?.x ?? 0, y: node?.y ?? 0 };

    pendingPress = {
      nodeId: hit.id,
      startWorld: world,
      currentWorld: world,
      initialNodeX: node?.x ?? 0,
      initialNodeY: node?.y ?? 0,
      worldOffset: offset,
      dimensions: { width: hit.box.width, height: hit.box.height }
    };
  } else {
    selection.selectedIds.clear();
    pendingPress = null;
  }
  render();
});

window.addEventListener("mousemove", (e) => {
  if (isPanning) {
    camera = panCamera(camera, e.clientX - startPan.x, e.clientY - startPan.y);
    startPan = { x: e.clientX, y: e.clientY };
    render();
    return;
  }

  const world = screenToWorld({ x: e.clientX, y: e.clientY }, camera);

  if (pendingPress && !dragSession && pastDragThreshold(pendingPress.startWorld, world)) {
    dragSession = pendingPress;
    pendingPress = null;
  }

  if (dragSession) {
    handleDragMove(currentDoc, dragSession, world, layoutTree);
    invalidateLayout();
    render();
  } else {
    const hit = hitTestScene(layoutTree, world);
    const newHover = hit ? hit.id : null;
    if (newHover !== selection.hoveredId) {
      selection.hoveredId = newHover;
      render();
    }
  }
});

window.addEventListener("mouseup", () => {
  isPanning = false;
  pendingPress = null;
  if (dragSession) {
    const oldTree = layoutTree;
    commitDragDrop(currentDoc, dragSession);
    invalidateLayout();
    trackLayoutTransitions(oldTree, layoutTree, 220);
    dragSession = null;
  }
  render();
});

openBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadDocument(reader.result as string);
      render();
    } catch (err) {
      alert("Error parsing file: " + err);
    }
  };
  reader.readAsText(file);
});

fixtureSelect.addEventListener("change", () => {
  const val = fixtureSelect.value;
  if (val && fixtures[val]) {
    loadDocument(fixtures[val]);
    render();
  }
});

window.addEventListener("resize", () => {
  resizeCanvas();
  render();
});
document.fonts?.ready?.then(render);
resizeCanvas();
render();
