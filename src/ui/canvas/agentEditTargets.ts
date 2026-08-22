import { createSignal } from "solid-js";
import type { PenNode } from "../../model/types";
import type { LayoutNode } from "../../layout/types";
import { findNodeWorldBox } from "../../interaction/hittest";

export interface AgentEditTarget {
  nodeId: string;
  bornAt: number;
}

export const [agentEditTarget, setAgentEditTarget] = createSignal<AgentEditTarget | null>(null);

let pruneTimer: ReturnType<typeof setTimeout> | undefined;

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
    if (!prev || fingerprint(prev) !== fingerprint(node)) changed.push(id);
  }
  return changed;
}

function pickPenNodeId(changedIds: string[], tree: LayoutNode[]): string | null {
  const changed = new Set(changedIds);
  const hasChangedDescendant = new Set<string>();

  function walk(nodes: LayoutNode[]): boolean {
    let any = false;
    for (const node of nodes) {
      const childHit = walk(node.children);
      if (childHit && changed.has(node.id)) hasChangedDescendant.add(node.id);
      if (changed.has(node.id) || childHit) any = true;
    }
    return any;
  }
  walk(tree);

  const leaves = changedIds.filter((id) => !hasChangedDescendant.has(id));
  const ranked = leaves
    .map((id) => {
      const box = findNodeWorldBox(tree, id);
      return { id, area: box ? box.width * box.height : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.area - b.area);

  const visible = ranked.filter((item) => item.area >= 400);
  const pool = visible.length > 0 ? visible : ranked;
  const current = agentEditTarget()?.nodeId;
  const next = pool.find((item) => item.id !== current) ?? pool[0];
  return next?.id ?? null;
}

export function noteAgentEdits(changedIds: string[], tree: LayoutNode[]): void {
  const nodeId = pickPenNodeId(changedIds, tree);
  if (!nodeId) return;
  setAgentEditTarget({ nodeId, bornAt: performance.now() });

  if (pruneTimer) clearTimeout(pruneTimer);
  pruneTimer = setTimeout(() => {
    const target = agentEditTarget();
    if (target && performance.now() - target.bornAt > 4200) setAgentEditTarget(null);
  }, 4300);
}

export function clearAgentEditTargets(): void {
  if (pruneTimer) {
    clearTimeout(pruneTimer);
    pruneTimer = undefined;
  }
  setAgentEditTarget(null);
}
