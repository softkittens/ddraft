import type { Document, PenNode } from "../model/types";
import type { LayoutNode, Box } from "../layout/types";
import type { Point } from "./camera";
import { paintNode } from "../render/paint";

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
        const isHoriz = (targetNode.type === "frame" ? targetNode.layout || "horizontal" : "horizontal") === "horizontal";
        const siblings = targetCtx.layoutNode.children.filter((c) => c.id !== session.nodeId);

        session.targetContainerId = targetCtx.layoutNode.id;
        session.targetContainerBox = {
          x: targetCtx.worldPos.x,
          y: targetCtx.worldPos.y,
          width: targetCtx.layoutNode.box.width,
          height: targetCtx.layoutNode.box.height
        };

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

        // Draw dashed blue insertion line
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

  if (session.targetContainerId && session.insertIndex !== undefined) {
    const targetCtx = findNodeContext(doc, session.targetContainerId);
    if (targetCtx && "children" in targetCtx.node && Array.isArray(targetCtx.node.children)) {
      // Remove from old parent
      if (parent && "children" in parent && Array.isArray(parent.children)) {
        parent.children.splice(index, 1);
      } else {
        const rIdx = doc.children.findIndex((c) => c.id === node.id);
        if (rIdx !== -1) doc.children.splice(rIdx, 1);
      }
      // Insert into target container at computed index
      const insertAt = Math.min(session.insertIndex, targetCtx.node.children.length);
      targetCtx.node.children.splice(insertAt, 0, node);
    }
  }
}

/**
 * Paints the Pen-style dashed insertion line, target container frame highlight, and floating ghost.
 */
export function paintDragGhost(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  session: DragSession,
  nodeMap: Map<string, PenNode>,
  variables?: Record<string, any>,
  zoom = 1
): void {
  // 1. Highlight target container frame with a blue border
  if (session.targetContainerBox) {
    const b = session.targetContainerBox;
    ctx.save();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2 / zoom;
    ctx.strokeRect(b.x, b.y, b.width, b.height);
    ctx.restore();
  }

  // 2. Draw dashed blue insertion line
  if (session.dropIndicator) {
    const { x1, y1, x2, y2 } = session.dropIndicator;
    ctx.save();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  // 3. Draw floating elevated ghost
  const dx = session.currentWorld.x - session.startWorld.x;
  const dy = session.currentWorld.y - session.startWorld.y;

  const ghostX = session.worldOffset.x + dx;
  const ghostY = session.worldOffset.y + dy;

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 24 / zoom;
  ctx.shadowOffsetY = 12 / zoom;

  const ghostLayoutNode: LayoutNode = {
    ...layoutNode,
    box: { ...layoutNode.box, x: ghostX, y: ghostY }
  };

  paintNode(ctx, ghostLayoutNode, nodeMap, variables);

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2 / zoom;
  ctx.strokeRect(ghostX, ghostY, layoutNode.box.width, layoutNode.box.height);

  ctx.restore();
}
