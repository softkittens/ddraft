import type { Document, PenNode } from "../model/types";
import type { LayoutNode, Box } from "../layout/types";
import type { Point } from "./camera";

export const DRAG_THRESHOLD_PX = 3;

export function pastDragThreshold(start: Point, current: Point, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

export interface DragSession {
  nodeId: string;
  startWorld: Point;
  currentWorld: Point;
  initialNodeX: number;
  initialNodeY: number;
  worldOffset: Point;
  dimensions: { width: number; height: number };
  targetContainerId?: string;
  targetContainerBox?: Box;
  targetContainerWorldPos?: Point;
  insertIndex?: number;
  dropIndicator?: { x1: number; y1: number; x2: number; y2: number };
}

export function findNodeContext(
  doc: Document,
  nodeId: string
): { node: PenNode; parent: PenNode | null; index: number } | null {
  for (let i = 0; i < doc.children.length; i++) {
    const root = doc.children[i];
    if (root.id === nodeId) return { node: root, parent: null, index: i };
    const res = findInParent(root, nodeId);
    if (res) return res;
  }
  return null;
}

function findInParent(
  parent: PenNode,
  nodeId: string
): { node: PenNode; parent: PenNode; index: number } | null {
  if ("children" in parent && Array.isArray(parent.children)) {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      if (child.id === nodeId) return { node: child, parent, index: i };
      const res = findInParent(child, nodeId);
      if (res) return res;
    }
  }
  return null;
}

function findContainerAtPoint(
  roots: LayoutNode[],
  point: Point,
  excludeId: string,
  parentWorld: Point = { x: 0, y: 0 }
): { layoutNode: LayoutNode; worldPos: Point } | null {
  for (let i = roots.length - 1; i >= 0; i--) {
    const root = roots[i];
    if (root.id === excludeId) continue;
    const curWorld = { x: parentWorld.x + root.box.x, y: parentWorld.y + root.box.y };

    if (
      point.x >= curWorld.x &&
      point.x <= curWorld.x + root.box.width &&
      point.y >= curWorld.y &&
      point.y <= curWorld.y + root.box.height
    ) {
      if (root.type === "frame") {
        const deeper = findContainerAtPoint(root.children, point, excludeId, curWorld);
        return deeper || { layoutNode: root, worldPos: curWorld };
      }
    }
  }
  return null;
}

/**
 * Calculates the pending drop slot, target container highlight, and dashed insertion line.
 * Defers actual tree mutation to mouseup to prevent layout jitter.
 */
export function handleDragMove(
  doc: Document,
  session: DragSession,
  currentWorld: Point,
  layoutTree?: LayoutNode[]
): void {
  session.currentWorld = currentWorld;
  session.targetContainerId = undefined;
  session.targetContainerBox = undefined;
  session.targetContainerWorldPos = undefined;
  session.dropIndicator = undefined;
  session.insertIndex = undefined;

  const ctx = findNodeContext(doc, session.nodeId);
  if (!ctx) return;
  const { node, parent } = ctx;

  const dx = currentWorld.x - session.startWorld.x;
  const dy = currentWorld.y - session.startWorld.y;

  const ghostCenterX = session.worldOffset.x + dx + session.dimensions.width / 2;
  const ghostCenterY = session.worldOffset.y + dy + session.dimensions.height / 2;

  if (layoutTree) {
    const targetCtx = findContainerAtPoint(layoutTree, { x: ghostCenterX, y: ghostCenterY }, session.nodeId);

    if (targetCtx && targetCtx.layoutNode.id !== session.nodeId) {
      const targetNode = findNodeContext(doc, targetCtx.layoutNode.id)?.node;

      if (targetNode && "children" in targetNode && Array.isArray(targetNode.children)) {
        session.targetContainerId = targetCtx.layoutNode.id;
        session.targetContainerWorldPos = targetCtx.worldPos;
        session.targetContainerBox = {
          x: targetCtx.worldPos.x,
          y: targetCtx.worldPos.y,
          width: targetCtx.layoutNode.box.width,
          height: targetCtx.layoutNode.box.height
        };

        const targetLayout = targetNode.type === "frame" ? targetNode.layout || "horizontal" : "none";

        // For layout: "none" freeform frames, no flex insertion index or line is computed
        if (targetLayout === "none") {
          return;
        }

        const isHoriz = targetLayout === "horizontal";
        const siblings = targetCtx.layoutNode.children.filter((c) => c.id !== session.nodeId);

        let insertIdx = siblings.length;
        for (let i = 0; i < siblings.length; i++) {
          const s = siblings[i];
          const mid = isHoriz
            ? targetCtx.worldPos.x + s.box.x + s.box.width / 2
            : targetCtx.worldPos.y + s.box.y + s.box.height / 2;

          const cursorCoord = isHoriz ? ghostCenterX : ghostCenterY;
          if (cursorCoord < mid) {
            insertIdx = i;
            break;
          }
        }
        session.insertIndex = insertIdx;

        // Draw dashed blue insertion line for flex containers
        if (siblings.length > 0) {
          const ref = siblings[Math.min(insertIdx, siblings.length - 1)];
          const linePos = isHoriz
            ? targetCtx.worldPos.x + (insertIdx >= siblings.length ? ref.box.x + ref.box.width + 4 : ref.box.x - 4)
            : targetCtx.worldPos.y + (insertIdx >= siblings.length ? ref.box.y + ref.box.height + 4 : ref.box.y - 4);

          session.dropIndicator = isHoriz
            ? { x1: linePos, y1: targetCtx.worldPos.y + 4, x2: linePos, y2: targetCtx.worldPos.y + targetCtx.layoutNode.box.height - 4 }
            : { x1: targetCtx.worldPos.x + 4, y1: linePos, x2: targetCtx.worldPos.x + targetCtx.layoutNode.box.width - 4, y2: linePos };
        }
        return;
      }
    }
  }

  const parentLayout = parent && parent.type === "frame" ? parent.layout : "none";
  if (!parent || parentLayout === "none" || node.layoutPosition === "absolute") {
    node.x = Math.round(session.initialNodeX + dx);
    node.y = Math.round(session.initialNodeY + dy);
  }
}

/**
 * Commits the drop operation on mouseup.
 */
export function commitDragDrop(doc: Document, session: DragSession): void {
  const ctx = findNodeContext(doc, session.nodeId);
  if (!ctx) return;
  const { node, parent, index } = ctx;

  const dx = session.currentWorld.x - session.startWorld.x;
  const dy = session.currentWorld.y - session.startWorld.y;

  if (session.targetContainerId) {
    const targetCtx = findNodeContext(doc, session.targetContainerId);
    if (targetCtx && "children" in targetCtx.node && Array.isArray(targetCtx.node.children)) {
      // Remove from old parent
      if (parent && "children" in parent && Array.isArray(parent.children)) {
        parent.children.splice(index, 1);
      } else {
        const rIdx = doc.children.findIndex((c) => c.id === node.id);
        if (rIdx !== -1) doc.children.splice(rIdx, 1);
      }

      const targetLayout = targetCtx.node.type === "frame" ? targetCtx.node.layout || "horizontal" : "none";

      if (targetLayout === "none") {

        // Freeform frame drop: convert drop world coordinates to frame local space
        const origin = session.targetContainerWorldPos || { x: targetCtx.node.x ?? 0, y: targetCtx.node.y ?? 0 };
        const dropWorldX = session.worldOffset.x + dx;
        const dropWorldY = session.worldOffset.y + dy;
        node.x = Math.round(dropWorldX - origin.x);
        node.y = Math.round(dropWorldY - origin.y);
        targetCtx.node.children.push(node);
      } else {
        // Flex frame drop: strip explicit coordinates and insert at computed index
        delete (node as any).x;
        delete (node as any).y;
        const insertAt = session.insertIndex !== undefined ? Math.min(session.insertIndex, targetCtx.node.children.length) : targetCtx.node.children.length;
        targetCtx.node.children.splice(insertAt, 0, node);
      }
      return;
    }
  }

  if (parent !== null) {
    // Dropped outside any container frame -> Reparent to root canvas
    if ("children" in parent && Array.isArray(parent.children)) {
      parent.children.splice(index, 1);
    }
    node.x = Math.round(session.worldOffset.x + dx);
    node.y = Math.round(session.worldOffset.y + dy);
    if (node.layoutPosition === "absolute") {
      delete (node as any).layoutPosition;
    }
    doc.children.push(node);
  }
}
