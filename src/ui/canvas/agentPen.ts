import { createSignal } from "solid-js";
import type { PenNode } from "../../model/types";
import type { LayoutNode, Box } from "../../layout/types";
import { findNodeWorldBox } from "../../interaction/hittest";

export interface ActiveEditTarget {
  nodeId: string;
  box: Box;
}

export const [activeEditTarget, setActiveEditTarget] = createSignal<ActiveEditTarget | null>(null);

let clearTimer: ReturnType<typeof setTimeout> | undefined;

function fingerprint(node: PenNode): string {
  const copy = { ...node } as Record<string, unknown>;
  delete copy.children;
  delete copy.descendants;
  return JSON.stringify(copy);
}

export function diffChangedNodeIds(
  oldMap: Map<string, PenNode>,
  newMap: Map<string, PenNode>
): string[] {
  const changed: string[] = [];
  for (const [id, node] of newMap) {
    const prev = oldMap.get(id);
    if (!prev || fingerprint(prev) !== fingerprint(node)) {
      changed.push(id);
    }
  }
  return changed;
}

export function noteAgentEdits(changedIds: string[], tree: LayoutNode[]): void {
  if (changedIds.length === 0) return;

  let targetNodeId: string | null = null;
  let targetBox: Box | null = null;

  for (let i = changedIds.length - 1; i >= 0; i--) {
    const id = changedIds[i];
    const box = findNodeWorldBox(tree, id);
    if (box && box.width > 4 && box.height > 4) {
      targetNodeId = id;
      targetBox = box;
      break;
    }
  }

  if (!targetNodeId || !targetBox) return;

  setActiveEditTarget({ nodeId: targetNodeId, box: targetBox });

  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    setActiveEditTarget(null);
  }, 2500);
}

export function clearAgentEditTargets(): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = undefined;
  }
  setActiveEditTarget(null);
}
