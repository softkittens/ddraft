import type { Document, PenNode } from "../model/types";
import type { LayoutNode, Box } from "../layout/types";
import type { Point } from "./camera";
import { childrenOf, isParentNode } from "../model/tree";
import {
  hitTestSceneWorld,
  nearestFrameHit,
  worldPointToFrameLocal,
  frameLocalToWorld,
  type HitResult
} from "./hittest";

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
  targetHit?: HitResult;
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
  const kids = childrenOf(parent);
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (child.id === nodeId) return { node: child, parent, index: i };
    const res = findInParent(child, nodeId);
    if (res) return res;
  }
  return null;
}

function dropTargetFrame(
  roots: LayoutNode[],
  point: Point,
  excludeId: string,
  nodeMap?: Map<string, PenNode>
): HitResult | null {
  const hit = hitTestSceneWorld(roots, point, nodeMap);
  if (!hit) return null;
  const cut = hit.path.findIndex((n) => n.id === excludeId);
  const path = cut >= 0 ? hit.path.slice(0, cut) : hit.path;
  if (path.length === 0) return null;
  return nearestFrameHit({
    node: path[path.length - 1],
    worldX: hit.worldX,
    worldY: hit.worldY,
    path
  });
}

/**
 * Calculates the pending drop slot, target container highlight, and dashed insertion line.
 * Defers actual tree mutation to mouseup to prevent layout jitter.
 */
export function handleDragMove(
  doc: Document,
  session: DragSession,
  currentWorld: Point,
  layoutTree?: LayoutNode[],
  nodeMap?: Map<string, PenNode>
): void {
  session.currentWorld = currentWorld;
  session.targetContainerId = undefined;
  session.targetContainerBox = undefined;
  session.targetContainerWorldPos = undefined;
  session.targetHit = undefined;
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
    const frameHit = dropTargetFrame(layoutTree, { x: ghostCenterX, y: ghostCenterY }, session.nodeId, nodeMap);

    if (frameHit && frameHit.node.id !== session.nodeId) {
      const targetNode = findNodeContext(doc, frameHit.node.id)?.node;

      if (targetNode && isParentNode(targetNode)) {
        session.targetContainerId = frameHit.node.id;
        session.targetHit = frameHit;
        session.targetContainerWorldPos = { x: frameHit.worldX, y: frameHit.worldY };
        session.targetContainerBox = {
          x: frameHit.worldX,
          y: frameHit.worldY,
          width: frameHit.node.box.width,
          height: frameHit.node.box.height
        };

        const targetLayout = targetNode.type === "frame" ? targetNode.layout || "horizontal" : "none";

        if (targetLayout === "none") {
          return;
        }

        const isHoriz = targetLayout === "horizontal";
        const siblings = frameHit.node.children.filter((c) => c.id !== session.nodeId);
        const localGhost = worldPointToFrameLocal({ x: ghostCenterX, y: ghostCenterY }, frameHit);

        let insertIdx = siblings.length;
        for (let i = 0; i < siblings.length; i++) {
          const s = siblings[i];
          const mid = isHoriz ? s.box.x + s.box.width / 2 : s.box.y + s.box.height / 2;
          const cursorCoord = isHoriz ? localGhost.x : localGhost.y;
          if (cursorCoord < mid) {
            insertIdx = i;
            break;
          }
        }
        session.insertIndex = insertIdx;

        if (siblings.length > 0) {
          const ref = siblings[Math.min(insertIdx, siblings.length - 1)];
          const lineLocal = isHoriz
            ? (insertIdx >= siblings.length ? ref.box.x + ref.box.width + 4 : ref.box.x - 4)
            : (insertIdx >= siblings.length ? ref.box.y + ref.box.height + 4 : ref.box.y - 4);
          const a = isHoriz
            ? frameLocalToWorld({ x: lineLocal, y: 4 }, frameHit)
            : frameLocalToWorld({ x: 4, y: lineLocal }, frameHit);
          const b = isHoriz
            ? frameLocalToWorld({ x: lineLocal, y: frameHit.node.box.height - 4 }, frameHit)
            : frameLocalToWorld({ x: frameHit.node.box.width - 4, y: lineLocal }, frameHit);
          session.dropIndicator = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
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
    if (targetCtx && isParentNode(targetCtx.node)) {
      const targetChildren = targetCtx.node.children ?? [];
      targetCtx.node.children = targetChildren;
      if (parent && isParentNode(parent) && parent.children) {
        parent.children.splice(index, 1);
      } else {
        const rIdx = doc.children.findIndex((c) => c.id === node.id);
        if (rIdx !== -1) doc.children.splice(rIdx, 1);
      }

      const targetLayout = targetCtx.node.type === "frame" ? targetCtx.node.layout || "horizontal" : "none";

      if (targetLayout === "none") {
        const dropWorld = { x: session.worldOffset.x + dx, y: session.worldOffset.y + dy };
        if (session.targetHit) {
          const local = worldPointToFrameLocal(dropWorld, session.targetHit);
          node.x = Math.round(local.x);
          node.y = Math.round(local.y);
        } else {
          const origin = session.targetContainerWorldPos || { x: targetCtx.node.x ?? 0, y: targetCtx.node.y ?? 0 };
          node.x = Math.round(dropWorld.x - origin.x);
          node.y = Math.round(dropWorld.y - origin.y);
        }
        targetChildren.push(node);
      } else {
        delete node.x;
        delete node.y;
        const insertAt = session.insertIndex !== undefined ? Math.min(session.insertIndex, targetChildren.length) : targetChildren.length;
        targetChildren.splice(insertAt, 0, node);
      }
      return;
    }
  }

  if (parent !== null) {
    if (isParentNode(parent) && parent.children) {
      parent.children.splice(index, 1);
    }
    node.x = Math.round(session.worldOffset.x + dx);
    node.y = Math.round(session.worldOffset.y + dy);
    if (node.layoutPosition === "absolute") {
      delete node.layoutPosition;
    }
    doc.children.push(node);
  }
}
