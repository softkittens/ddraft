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
    // Invert Pen's counter-clockwise rotation around (0, 0)
    const rad = (rotation * Math.PI) / 180;
    localX = dx * Math.cos(rad) - dy * Math.sin(rad);
    localY = dx * Math.sin(rad) + dy * Math.cos(rad);
  }

  if (localX >= 0 && localX <= box.width && localY >= 0 && localY <= box.height) {
    return { x: localX, y: localY };
  }
  return null;
}

/**
 * Finds the topmost node under a world-space point.
 * Walks in reverse painter order (front-to-back, leaf children first).
 *
 * Why:
 * Reverse painter order ensures top-layered objects receive clicks before their parents/underlying siblings.
 */
export function hitTestNode(node: LayoutNode, worldPoint: Point): LayoutNode | null {
  const localPoint = pointInNodeLocalSpace(worldPoint, node.box, node.rotation);
  if (!localPoint) return null;

  // Search children in reverse order (top-most layer first)
  for (let i = node.children.length - 1; i >= 0; i--) {
    const childHit = hitTestNode(node.children[i], localPoint);
    if (childHit) return childHit;
  }

  return node;
}

export function hitTestScene(roots: LayoutNode[], worldPoint: Point): LayoutNode | null {
  for (let i = roots.length - 1; i >= 0; i--) {
    const hit = hitTestNode(roots[i], worldPoint);
    if (hit) return hit;
  }
  return null;
}
