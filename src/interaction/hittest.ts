import type { LayoutNode, Box } from "../layout/types";
import type { PenNode, FrameNode } from "../model/types";
import type { Point } from "./camera";

/**
 * Convert a point in parent space into the node's local coordinates
 * (origin at the node's top-left, rotation inverted). Containment is separate.
 */
export function parentPointToLocal(point: Point, box: Box, rotation?: number): Point {
  const dx = point.x - box.x;
  const dy = point.y - box.y;
  if (!rotation) return { x: dx, y: dy };
  const rad = (rotation * Math.PI) / 180;
  return {
    x: dx * Math.cos(rad) + dy * Math.sin(rad),
    y: -dx * Math.sin(rad) + dy * Math.cos(rad)
  };
}

export function localPointInBox(local: Point, box: Box): boolean {
  return local.x >= 0 && local.x <= box.width && local.y >= 0 && local.y <= box.height;
}

function localOriginToWorld(
  localX: number,
  localY: number,
  parentWorldX: number,
  parentWorldY: number,
  parentRotation?: number
): Point {
  if (!parentRotation) return { x: parentWorldX + localX, y: parentWorldY + localY };
  const rad = (parentRotation * Math.PI) / 180;
  return {
    x: parentWorldX + localX * Math.cos(rad) - localY * Math.sin(rad),
    y: parentWorldY + localX * Math.sin(rad) + localY * Math.cos(rad)
  };
}

export interface HitResult {
  node: LayoutNode;
  worldX: number;
  worldY: number;
  path: LayoutNode[];
}

function childMayContainPoint(
  child: LayoutNode,
  pointInParent: Point,
  nodeMap: Map<string, PenNode> | undefined
): boolean {
  const local = parentPointToLocal(pointInParent, child.box, child.rotation);
  if (localPointInBox(local, child.box)) return true;
  if (child.children.length === 0) return false;
  return (nodeMap?.get(child.id) as FrameNode | undefined)?.clip !== true;
}

function hitTestNodeWorld(
  node: LayoutNode,
  pointInParent: Point,
  parentWorldX: number,
  parentWorldY: number,
  parentRotation: number | undefined,
  nodeMap: Map<string, PenNode> | undefined,
  ancestors: LayoutNode[]
): HitResult | null {
  const docNode = nodeMap?.get(node.id);
  if (docNode && docNode.enabled === false) {
    return null;
  }

  const origin = localOriginToWorld(node.box.x, node.box.y, parentWorldX, parentWorldY, parentRotation);
  const local = parentPointToLocal(pointInParent, node.box, node.rotation);
  const inside = localPointInBox(local, node.box);
  const isClipped = (docNode as FrameNode | undefined)?.clip === true;

  ancestors.push(node);
  try {
    if (!isClipped || inside) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (!inside && !childMayContainPoint(child, local, nodeMap)) continue;
        const childHit = hitTestNodeWorld(
          child,
          local,
          origin.x,
          origin.y,
          (parentRotation ?? 0) + (node.rotation ?? 0),
          nodeMap,
          ancestors
        );
        if (childHit) return childHit;
      }
    }

    if (inside) {
      return { node, worldX: origin.x, worldY: origin.y, path: ancestors.slice() };
    }
    return null;
  } finally {
    ancestors.pop();
  }
}

export function hitTestSceneWorld(
  roots: LayoutNode[],
  worldPoint: Point,
  nodeMap?: Map<string, PenNode>
): HitResult | null {
  for (let i = roots.length - 1; i >= 0; i--) {
    const root = roots[i];
    const hit = hitTestNodeWorld(root, worldPoint, 0, 0, undefined, nodeMap, []);
    if (hit) return hit;

    // Generous Figma-like hit area for root frame title header
    if (
      root.type === "frame" &&
      worldPoint.x >= root.box.x - 10 &&
      worldPoint.x <= root.box.x + Math.max(200, root.box.width + 10) &&
      worldPoint.y >= root.box.y - 32 &&
      worldPoint.y <= root.box.y + 2
    ) {
      return { node: root, worldX: root.box.x, worldY: root.box.y, path: [root] };
    }
  }
  return null;
}

/**
 * Finds the topmost node under a world-space point.
 * Walks in reverse painter order (front-to-back, leaf children first).
 */
export function hitTestScene(
  roots: LayoutNode[],
  worldPoint: Point,
  nodeMap?: Map<string, PenNode>
): LayoutNode | null {
  const result = hitTestSceneWorld(roots, worldPoint, nodeMap);
  return result ? result.node : null;
}

/** Walk the hit path from leaf to root and return the nearest frame with its world origin. */
export function nearestFrameHit(hit: HitResult): HitResult | null {
  for (let i = hit.path.length - 1; i >= 0; i--) {
    const node = hit.path[i];
    if (node.type === "frame") {
      const origin = frameWorldOrigin(hit, node.id) ?? { x: hit.worldX, y: hit.worldY };
      return { node, worldX: origin.x, worldY: origin.y, path: hit.path.slice(0, i + 1) };
    }
  }
  return null;
}

/** Convert a world point into the local coordinates of the frame on this hit. */
export function worldPointToFrameLocal(world: Point, frameHit: HitResult): Point {
  return parentPointToLocal(world, {
    x: frameHit.worldX,
    y: frameHit.worldY,
    width: frameHit.node.box.width,
    height: frameHit.node.box.height
  }, frameWorldRotation(frameHit));
}

export function frameLocalToWorld(local: Point, frameHit: HitResult): Point {
  return localOriginToWorld(local.x, local.y, frameHit.worldX, frameHit.worldY, frameWorldRotation(frameHit));
}

function frameWorldRotation(frameHit: HitResult): number {
  return frameHit.path.reduce((sum, node) => sum + (node.rotation ?? 0), 0);
}

/**
 * World origin of a node on the hit path. Recomputed from the path so insertion
 * can target an ancestor frame without a second scene walk.
 */
export function frameWorldOrigin(hit: HitResult, frameId: string): Point | null {
  let worldX = 0;
  let worldY = 0;
  let rotation = 0;
  for (const node of hit.path) {
    const origin = localOriginToWorld(node.box.x, node.box.y, worldX, worldY, rotation);
    worldX = origin.x;
    worldY = origin.y;
    rotation += node.rotation ?? 0;
    if (node.id === frameId) return { x: worldX, y: worldY };
  }
  return null;
}
