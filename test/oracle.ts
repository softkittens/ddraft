import type { LayoutNode } from "../src/layout/types";

export interface NodeBoundsTruth {
  id: string;
  depth?: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoundsDiff {
  id: string;
  field: "x" | "y" | "width" | "height";
  expected: number;
  actual: number;
  diff: number;
}

/**
 * Flattens a LayoutNode hierarchy into a map keyed by node id.
 */
export function flattenLayoutTree(nodes: LayoutNode[]): Map<string, LayoutNode> {
  const map = new Map<string, LayoutNode>();
  function visit(node: LayoutNode) {
    map.set(node.id, node);
    for (const child of node.children) {
      visit(child);
    }
  }
  for (const root of nodes) visit(root);
  return map;
}

/**
 * Compares layout output against recorded ground truth bounds.
 * Accepts tolerance of 1.0 per Section B7.
 */
export function compareWithTruth(
  layoutNodes: LayoutNode[],
  truth: NodeBoundsTruth[],
  tolerance = 1.0
): BoundsDiff[] {
  const nodeMap = flattenLayoutTree(layoutNodes);
  const diffs: BoundsDiff[] = [];

  for (const t of truth) {
    const node = nodeMap.get(t.id);
    if (!node) continue;

    const fields: ("x" | "y" | "width" | "height")[] = ["x", "y", "width", "height"];
    for (const field of fields) {
      const expected = t[field];
      const actual = node.box[field];
      const diff = Math.abs(expected - actual);
      if (diff > tolerance) {
        diffs.push({ id: t.id, field, expected, actual, diff });
      }
    }
  }

  return diffs;
}
