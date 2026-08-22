import { createSignal } from "solid-js";
import type { PenNode } from "../../model/types";
import type { LayoutNode } from "../../layout/types";

export const [workingFrameIds, setWorkingFrameIds] = createSignal<string[]>([]);

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

function containsNode(node: LayoutNode, id: string): boolean {
  if (node.id === id) return true;
  return node.children.some((child) => containsNode(child, id));
}

export function findRootFrameId(tree: LayoutNode[], nodeId: string): string | null {
  for (const root of tree) {
    if (containsNode(root, nodeId)) return root.id;
  }
  return null;
}

export function noteAgentEdits(changedIds: string[], tree: LayoutNode[]): void {
  if (changedIds.length === 0) return;

  const roots: string[] = [];
  const seen = new Set<string>();
  for (const id of changedIds) {
    const rootId = findRootFrameId(tree, id);
    if (rootId && !seen.has(rootId)) {
      seen.add(rootId);
      roots.push(rootId);
    }
  }
  if (roots.length > 0) setWorkingFrameIds(roots);
}

export function clearAgentEditTargets(): void {
  setWorkingFrameIds([]);
}
