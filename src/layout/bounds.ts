import type { LayoutNode } from "./types";
import { flattenLayoutTree } from "./layout";

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
  field: "x" | "y" | "width" | "height" | "missing";
  expected: number;
  actual: number;
  diff: number;
}

export function parseBoundsFile(text: string): NodeBoundsTruth[] {
  const rows: NodeBoundsTruth[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [id, x, y, width, height] = trimmed.split("|");
    if (!id) continue;
    rows.push({
      id,
      x: Number(x),
      y: Number(y),
      width: Number(width),
      height: Number(height)
    });
  }
  return rows;
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
    if (!node) {
      diffs.push({ id: t.id, field: "missing", expected: 1, actual: 0, diff: 1 });
      continue;
    }

    const isGroup = node.type === "group";
    let groupMinX = 0;
    let groupMinY = 0;
    if (isGroup && node.children.length > 0) {
      groupMinX = node.children.reduce((min, c) => Math.min(min, c.box.x), Infinity);
      groupMinY = node.children.reduce((min, c) => Math.min(min, c.box.y), Infinity);
      if (groupMinX === Infinity) groupMinX = 0;
      if (groupMinY === Infinity) groupMinY = 0;
    }

    const fields: ("x" | "y" | "width" | "height")[] = ["x", "y", "width", "height"];
    for (const field of fields) {
      const expected = t[field];
      let actual = node.box[field];
      if (field === "x") actual += groupMinX;
      if (field === "y") actual += groupMinY;
      const diff = Math.abs(expected - actual);
      if (diff > tolerance) {
        diffs.push({ id: t.id, field, expected, actual, diff });
      }
    }
  }

  return diffs;
}
