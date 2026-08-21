import { expect } from "bun:test";
import type { Document, FrameNode, PenNode, TextNode } from "../src/model/types";
import type { LayoutNode, Box } from "../src/layout/types";
import { flattenLayoutTree, layoutResolvedDocument, layoutDocument } from "../src/layout/layout";
import { indexDocument, cloneDocument } from "../src/model/tree";
import { parseDocument } from "../src/model/parse";
import { resolveInstances } from "../src/model/instance";
import { createCamera, screenToWorld, zoomAtScreenPoint, panCamera, type Camera } from "../src/interaction/camera";
import { hitTestScene } from "../src/interaction/hittest";
import { handleDragMove, commitDragDrop, pastDragThreshold, type DragSession } from "../src/interaction/drag";
import { duplicateNode } from "../src/model/edit";
import { createHistory, pushDocument, undo as undoDoc, redo as redoDoc, type HistoryState } from "../src/model/history";
import { paintNode } from "../src/render/paint";
import { paintSelectionOverlay } from "../src/interaction/selection";
import { inspectorFields } from "../src/ui/inspector";
import type { ToolMode } from "../src/ui/store";
import { createDocumentTools } from "../src/agent/tools";

export const makeDoc = (...children: PenNode[]): Document => ({
  version: "2.17",
  children
});

export const frame = (
  id: string,
  width?: number | string,
  height?: number | string,
  children: PenNode[] = [],
  props: Partial<FrameNode> = {}
): FrameNode => ({
  type: "frame",
  id,
  width,
  height,
  children,
  ...props
});

export const screen = (
  id: string,
  children: PenNode[] = [],
  props: Partial<FrameNode> = {}
): FrameNode => ({
  type: "frame",
  id,
  width: 390,
  height: 844,
  clip: true,
  layout: "vertical",
  metadata: { screenKind: "mobile" },
  children,
  ...props
});

export const rect = (
  id: string,
  width = 100,
  height = 100,
  props: Partial<PenNode> = {}
): PenNode => ({
  type: "rectangle",
  id,
  width,
  height,
  ...props
});

export const txt = (
  id: string,
  content = "Hello",
  fontSize = 14,
  props: Partial<TextNode> = {}
): TextNode => ({
  type: "text",
  id,
  content,
  fontSize,
  ...props
});

export function flattenBoxes(nodes: LayoutNode[]): Map<string, Box> {
  const map = new Map<string, Box>();
  for (const [id, n] of flattenLayoutTree(nodes)) map.set(id, n.box);
  return map;
}

export function assertBoxes(nodes: LayoutNode[], expected: Record<string, [number, number, number, number]>): void {
  const map = flattenBoxes(nodes);
  for (const [id, [x, y, w, h]] of Object.entries(expected)) {
    const box = map.get(id);
    expect(box).toBeDefined();
    if (box) {
      expect(Math.round(box.x)).toBe(x);
      expect(Math.round(box.y)).toBe(y);
      expect(Math.round(box.width)).toBe(w);
      expect(Math.round(box.height)).toBe(h);
    }
  }
}

export function expectLayout(doc: Document, expected: Record<string, [number, number, number, number]>): void {
  assertBoxes(layoutDocument(doc), expected);
}

export async function execTool(
  name: string,
  args: Record<string, any>,
  doc: Document
): Promise<{ result: string; doc: Document }> {
  const tools = createDocumentTools(cloneDocument(doc));
  const result = await tools.execute(name, args);
  return { result, doc: tools.doc };
}

export function createMockCanvas() {
  const calls: string[] = [];
  const state = {
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    shadowColor: "transparent",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: "none"
  };

  const ctx: any = new Proxy(state, {
    get: (target: any, prop: string) => {
      if (prop in target) return target[prop];
      return (...args: any[]) => {
        const argStr = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(",");
        calls.push(argStr ? `${prop}:${argStr}` : prop);
      };
    },
    set: (target: any, prop: string, value: any) => {
      target[prop] = value;
      calls.push(`${prop}=${value}`);
      return true;
    }
  });

  return { ctx, calls };
}

/**
 * End-to-End Headless Editor Driver
 * Simulates real user gestures, camera transforms, drag interactions, layout updates, and canvas rendering.
 */
export class EditorDriver {
  doc: Document;
  camera: Camera;
  selectedIds: Set<string>;
  hoveredId: string | null = null;
  history: HistoryState;
  toolMode: ToolMode = "select";

  private pendingPress: DragSession | null = null;
  private dragSession: DragSession | null = null;
  private preDragDoc: Document | null = null;
  private activeDuplicateId: string | null = null;

  constructor(initialDocOrText: Document | string) {
    this.doc = typeof initialDocOrText === "string" ? parseDocument(initialDocOrText) : initialDocOrText;
    this.camera = createCamera(0, 0, 1);
    this.selectedIds = new Set();
    this.history = createHistory(this.doc);
  }

  get layoutTree(): LayoutNode[] {
    return layoutResolvedDocument(resolveInstances(this.doc));
  }

  get nodeMap(): Map<string, PenNode> {
    return indexDocument(this.doc);
  }

  // Pointer Gestures (in Screen Pixel Coordinates)
  pointerDown(screenX: number, screenY: number, modifiers: { alt?: boolean; meta?: boolean } = {}) {
    const world = screenToWorld({ x: screenX, y: screenY }, this.camera);
    const hit = hitTestScene(this.layoutTree, world);

    if (hit) {
      if (modifiers.meta) {
        if (this.selectedIds.has(hit.id)) this.selectedIds.delete(hit.id);
        else this.selectedIds.add(hit.id);
      } else {
        this.selectedIds = new Set([hit.id]);
      }

      this.pendingPress = {
        nodeId: hit.id,
        startWorld: world,
        currentWorld: world,
        initialNodeX: hit.box.x,
        initialNodeY: hit.box.y,
        worldOffset: { x: hit.box.x, y: hit.box.y },
        dimensions: { width: hit.box.width, height: hit.box.height }
      };
    } else {
      this.selectedIds.clear();
      this.pendingPress = null;
    }
  }

  pointerMove(screenX: number, screenY: number, modifiers: { alt?: boolean } = {}) {
    const world = screenToWorld({ x: screenX, y: screenY }, this.camera);

    if (this.pendingPress && !this.dragSession && pastDragThreshold(this.pendingPress.startWorld, world)) {
      this.preDragDoc = cloneDocument(this.doc);
      this.dragSession = this.pendingPress;
      this.pendingPress = null;
    }

    if (this.dragSession && this.preDragDoc) {
      if (modifiers.alt && !this.activeDuplicateId) {
        const fresh = cloneDocument(this.preDragDoc);
        const dup = duplicateNode(fresh, this.dragSession.nodeId);
        if (dup) {
          this.doc = dup.doc;
          this.activeDuplicateId = dup.newId;
          this.selectedIds = new Set([dup.newId]);
        }
      } else if (!modifiers.alt && this.activeDuplicateId) {
        this.doc = cloneDocument(this.preDragDoc);
        this.activeDuplicateId = null;
        this.selectedIds = new Set([this.dragSession.nodeId]);
      }

      const active = this.activeDuplicateId
        ? { ...this.dragSession, nodeId: this.activeDuplicateId }
        : this.dragSession;

      handleDragMove(this.doc, active, world, this.layoutTree, this.nodeMap);
    } else {
      const hit = hitTestScene(this.layoutTree, world);
      this.hoveredId = hit ? hit.id : null;
    }
  }

  pointerUp() {
    this.pendingPress = null;
    if (this.dragSession) {
      const active = this.activeDuplicateId
        ? { ...this.dragSession, nodeId: this.activeDuplicateId }
        : this.dragSession;

      commitDragDrop(this.doc, active);
      this.history = pushDocument(this.history, this.doc);

      this.dragSession = null;
      this.preDragDoc = null;
      this.activeDuplicateId = null;
    }
  }

  // Camera Controls
  zoomAt(screenX: number, screenY: number, factor: number) {
    this.camera = zoomAtScreenPoint(this.camera, { x: screenX, y: screenY }, this.camera.zoom * factor);
  }

  pan(dx: number, dy: number) {
    this.camera = panCamera(this.camera, dx, dy);
  }

  undo() {
    const res = undoDoc(this.history);
    if (res) {
      this.history = res.history;
      this.doc = cloneDocument(res.doc);
      this.selectedIds.clear();
    }
  }

  redo() {
    const res = redoDoc(this.history);
    if (res) {
      this.history = res.history;
      this.doc = cloneDocument(res.doc);
      this.selectedIds.clear();
    }
  }

  getInspector() {
    return inspectorFields(this.doc, this.layoutTree, Array.from(this.selectedIds));
  }

  renderView(): { calls: string[] } {
    const { ctx, calls } = createMockCanvas();
    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.zoom, this.camera.zoom);

    for (const root of this.layoutTree) {
      paintNode(ctx, root, this.nodeMap, this.doc.variables);
      paintSelectionOverlay(ctx, root, this.selectedIds, this.hoveredId, this.camera.zoom);
    }
    ctx.restore();
    return { calls };
  }
}
