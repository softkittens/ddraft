import type { LayoutNode } from "../layout/types";

export interface AnimatedNode {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  startTime: number;
  duration: number;
}

const activeAnimations = new Map<string, AnimatedNode>();

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
  duration = 200
): void {
  const oldMap = new Map<string, { x: number; y: number }>();
  function collect(nodes: LayoutNode[]) {
    for (const n of nodes) {
      oldMap.set(n.id, { x: n.box.x, y: n.box.y });
      collect(n.children);
    }
  }
  collect(oldTree);

  const now = performance.now();
  function checkNew(nodes: LayoutNode[]) {
    for (const n of nodes) {
      const old = oldMap.get(n.id);
      if (old && (Math.abs(old.x - n.box.x) > 1 || Math.abs(old.y - n.box.y) > 1)) {
        activeAnimations.set(n.id, {
          id: n.id,
          from: old,
          to: { x: n.box.x, y: n.box.y },
          startTime: now,
          duration
        });
      }
      checkNew(n.children);
    }
  }
  checkNew(newTree);
}

/**
 * Returns the animated local position (x, y) if animating, or null if stationary.
 * Does not mutate the animation table.
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

export function pruneFinishedAnimations(now = performance.now()): void {
  for (const [id, anim] of activeAnimations) {
    if ((now - anim.startTime) / anim.duration >= 1) {
      activeAnimations.delete(id);
    }
  }
}

export function getAnimatedPosition(nodeId: string): { x: number; y: number } | null {
  return getAnimatedPositions().get(nodeId) ?? null;
}

export function hasActiveAnimations(): boolean {
  return activeAnimations.size > 0;
}
