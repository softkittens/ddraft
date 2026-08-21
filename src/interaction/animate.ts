import type { LayoutNode } from "../layout/types";

export interface AnimatedNode {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  startTime: number;
  duration: number;
}

export interface SpawnAnimation {
  id: string;
  startTime: number;
  duration: number;
}

const activeAnimations = new Map<string, AnimatedNode>();
const spawnAnimations = new Map<string, SpawnAnimation>();

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Tracks local coordinate transitions for layout nodes.
 * Children automatically move with their parent without double-transforming.
 */
export function trackLayoutTransitions(
  oldTree: LayoutNode[],
  newTree: LayoutNode[],
  duration = 320
): void {
  trackLayoutTransitionsFromSnapshot(snapshotPositions(oldTree), newTree, duration);
}

/**
 * Cheaply captures {id → {x,y}} from a layout tree — no deep clone needed.
 */
export function snapshotPositions(tree: LayoutNode[]): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  function collect(nodes: LayoutNode[]) {
    for (const n of nodes) {
      map.set(n.id, { x: n.box.x, y: n.box.y });
      collect(n.children);
    }
  }
  collect(tree);
  return map;
}

/**
 * Like trackLayoutTransitions but accepts a pre-captured position snapshot
 * instead of a full cloned tree, tracking position glides and spawn animations.
 */
export function trackLayoutTransitionsFromSnapshot(
  oldPositions: Map<string, { x: number; y: number }>,
  newTree: LayoutNode[],
  duration = 320
): void {
  const now = performance.now();
  function checkNew(nodes: LayoutNode[]) {
    for (const n of nodes) {
      const old = oldPositions.get(n.id);
      if (old) {
        if (Math.abs(old.x - n.box.x) > 1 || Math.abs(old.y - n.box.y) > 1) {
          activeAnimations.set(n.id, {
            id: n.id,
            from: old,
            to: { x: n.box.x, y: n.box.y },
            startTime: now,
            duration
          });
        }
      } else if (oldPositions.size > 0) {
        // Newly created element: spawn animation
        spawnAnimations.set(n.id, {
          id: n.id,
          startTime: now,
          duration: duration * 1.2
        });
      }
      checkNew(n.children);
    }
  }
  checkNew(newTree);
}

/**
 * Returns the animated local position (x, y) if animating, or null if stationary.
 */
export function getAnimatedPositions(now = performance.now()): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const [id, anim] of activeAnimations) {
    const progress = Math.min(1, (now - anim.startTime) / anim.duration);
    if (progress >= 1) continue;
    const eased = easeOutCubic(progress);
    out.set(id, {
      x: anim.from.x + (anim.to.x - anim.from.x) * eased,
      y: anim.from.y + (anim.to.y - anim.from.y) * eased
    });
  }
  return out;
}

/**
 * Returns spawn animation state (opacity, offsetY, scale, glow) for newly created nodes.
 */
export function getSpawnAnimation(id: string, now = performance.now()): {
  opacity: number;
  offsetY: number;
  scale: number;
  glow: number;
} | null {
  const anim = spawnAnimations.get(id);
  if (!anim) return null;
  const progress = Math.min(1, (now - anim.startTime) / anim.duration);
  if (progress >= 1) return null;
  const eased = easeOutCubic(progress);
  return {
    opacity: eased,
    offsetY: (1 - eased) * 12,
    scale: 0.94 + 0.06 * eased,
    glow: 1 - eased
  };
}

export function pruneFinishedAnimations(now = performance.now()): void {
  for (const [id, anim] of activeAnimations) {
    if ((now - anim.startTime) / anim.duration >= 1) {
      activeAnimations.delete(id);
    }
  }
  for (const [id, anim] of spawnAnimations) {
    if ((now - anim.startTime) / anim.duration >= 1) {
      spawnAnimations.delete(id);
    }
  }
}

export function getAnimatedPosition(nodeId: string): { x: number; y: number } | null {
  return getAnimatedPositions().get(nodeId) ?? null;
}

export function hasActiveAnimations(): boolean {
  return activeAnimations.size > 0 || spawnAnimations.size > 0;
}
