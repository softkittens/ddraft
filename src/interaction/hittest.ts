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
 * Resolves the hit target using Figma's top-down hierarchical selection model:
 * 1. Deep select (Cmd/Ctrl held): directly select the innermost leaf node.
 * 2. If nothing in the path is selected: select the top-level root frame (path[0]).
 * 3. If an ancestor is already selected: drill down 1 level deeper into its child.
 */
export function resolveFigmaClickTarget(
  path: LayoutNode[],
  currentSelection: Set<string>,
  deepSelect = false
): LayoutNode {
  if (path.length === 0) return path[0];
  if (deepSelect || path.length === 1) return path[path.length - 1];

  const selectedIndex = path.findIndex((node) => currentSelection.has(node.id));
  if (selectedIndex === -1) {
    return path[0];
  }

  return path[Math.min(path.length - 1, selectedIndex + 1)];
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

/**
 * Finds all nodes whose layout geometry intersects a world-space marquee bounding box.
 * If the marquee is drawn entirely inside a container, matches the container's direct children.
 * Otherwise, matches top-level root frames / objects.
 */
export function findNodesInMarquee(
  tree: LayoutNode[],
  marquee: Box,
  nodeMap?: Map<string, PenNode>
): string[] {
  if (marquee.width <= 0 || marquee.height <= 0) return [];
  const selected: string[] = [];

  for (const root of tree) {
    const data = nodeMap?.get(root.id);
    if (data?.enabled === false) continue;

    const rBox = root.box;
    const intersectsRoot =
      rBox.x < marquee.x + marquee.width &&
      rBox.x + rBox.width > marquee.x &&
      rBox.y < marquee.y + marquee.height &&
      rBox.y + rBox.height > marquee.y;

    if (!intersectsRoot) continue;

    const isContainedInsideRoot =
      root.children.length > 0 &&
      marquee.x >= rBox.x &&
      marquee.y >= rBox.y &&
      marquee.x + marquee.width <= rBox.x + rBox.width &&
      marquee.y + marquee.height <= rBox.y + rBox.height;

    if (isContainedInsideRoot) {
      const childrenHits = findChildrenInMarquee(root.children, marquee, rBox.x, rBox.y, nodeMap);
      if (childrenHits.length > 0) {
        selected.push(...childrenHits);
      } else {
        selected.push(root.id);
      }
    } else {
      selected.push(root.id);
    }
  }

  return selected;
}

function findChildrenInMarquee(
  children: LayoutNode[],
  marquee: Box,
  parentX: number,
  parentY: number,
  nodeMap?: Map<string, PenNode>
): string[] {
  const hits: string[] = [];
  for (const child of children) {
    const data = nodeMap?.get(child.id);
    if (data?.enabled === false) continue;

    const cx = parentX + child.box.x;
    const cy = parentY + child.box.y;
    const cw = child.box.width;
    const ch = child.box.height;

    const intersects =
      cx < marquee.x + marquee.width &&
      cx + cw > marquee.x &&
      cy < marquee.y + marquee.height &&
      cy + ch > marquee.y;

    if (intersects) {
      hits.push(child.id);
    }
  }
  return hits;
}

/**
 * Finds the absolute world-space bounding box of any node in the layout tree.
 */
export function findNodeWorldBox(
  tree: LayoutNode[],
  nodeId: string,
  worldOffset: Point = { x: 0, y: 0 }
): Box | null {
  for (const node of tree) {
    const wx = worldOffset.x + node.box.x;
    const wy = worldOffset.y + node.box.y;
    if (node.id === nodeId) {
      return { x: wx, y: wy, width: node.box.width, height: node.box.height };
    }
    if (node.children.length > 0) {
      const found = findNodeWorldBox(node.children, nodeId, { x: wx, y: wy });
      if (found) return found;
    }
  }
  return null;
}
