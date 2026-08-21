import type { LayoutNode, Box } from "../layout/types";
import type { Point } from "./camera";

/**
 * Inverts node transform (translation + counter-clockwise rotation)
 * to test if a point in parent-space lies inside the node's local box.
 */
export function pointInNodeLocalSpace(point: Point, box: Box, rotation?: number): Point | null {
  const dx = point.x - box.x;
  const dy = point.y - box.y;

  let localX = dx;
  let localY = dy;

  if (rotation) {
    // Invert rotation around (0, 0) in screen coordinates
    const rad = (rotation * Math.PI) / 180;
    localX = dx * Math.cos(rad) + dy * Math.sin(rad);
    localY = -dx * Math.sin(rad) + dy * Math.cos(rad);
  }


  if (localX >= 0 && localX <= box.width && localY >= 0 && localY <= box.height) {
    return { x: localX, y: localY };
  }
  return null;
}

/**
 * Finds the topmost node under a world-space point.
 * Walks in reverse painter order (front-to-back, leaf children first).
 */
export function hitTestScene(roots: LayoutNode[], worldPoint: Point): LayoutNode | null {
  const result = hitTestSceneWorld(roots, worldPoint);
  return result ? result.node : null;
}

export interface HitResult {
  node: LayoutNode;
  worldX: number;
  worldY: number;
}

function hitTestNodeWorld(
  node: LayoutNode,
  pointInParent: Point,
  parentWorldX: number,
  parentWorldY: number
): HitResult | null {
  const localPoint = pointInNodeLocalSpace(pointInParent, node.box, node.rotation);
  if (!localPoint) return null;

  const nodeWorldX = parentWorldX + node.box.x;
  const nodeWorldY = parentWorldY + node.box.y;

  // Search children in reverse order (top-most layer first)
  for (let i = node.children.length - 1; i >= 0; i--) {
    const childHit = hitTestNodeWorld(node.children[i], localPoint, nodeWorldX, nodeWorldY);
    if (childHit) return childHit;
  }

  return { node, worldX: nodeWorldX, worldY: nodeWorldY };
}

export function hitTestSceneWorld(roots: LayoutNode[], worldPoint: Point): HitResult | null {
  for (let i = roots.length - 1; i >= 0; i--) {
    const root = roots[i];
    const hit = hitTestNodeWorld(root, worldPoint, 0, 0);
    if (hit) return hit;

    // Generous Figma-like hit area for root frame title header
    if (
      root.type === "frame" &&
      worldPoint.x >= root.box.x - 10 &&
      worldPoint.x <= root.box.x + Math.max(200, root.box.width + 10) &&
      worldPoint.y >= root.box.y - 32 &&
      worldPoint.y <= root.box.y + 2
    ) {
      return { node: root, worldX: root.box.x, worldY: root.box.y };
    }
  }
  return null;
}
