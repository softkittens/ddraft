import type { Document, PenNode } from "../model/types";
import { layoutDocument, flattenLayoutTree } from "../layout/layout";
import { indexDocument } from "../model/tree";

/**
 * Calculates the count of innocent spectator nodes shifted by an edit.
 */
export function computeBlastRadius(docBefore: Document, docAfter: Document, targetId: string): number {
  const beforeTree = flattenLayoutTree(layoutDocument(docBefore));
  const afterTree = flattenLayoutTree(layoutDocument(docAfter));

  let movedCount = 0;
  for (const [id, beforeNode] of beforeTree.entries()) {
    if (id === targetId) continue;
    const afterNode = afterTree.get(id);
    if (!afterNode) continue;

    const dx = Math.abs(beforeNode.box.x - afterNode.box.x);
    const dy = Math.abs(beforeNode.box.y - afterNode.box.y);
    const dw = Math.abs(beforeNode.box.width - afterNode.box.width);
    const dh = Math.abs(beforeNode.box.height - afterNode.box.height);

    if (dx > 0.01 || dy > 0.01 || dw > 0.01 || dh > 0.01) {
      movedCount++;
    }
  }

  return movedCount;
}

/**
 * Computes shallow representation of a node without its children array.
 */
function shallowNodeProps(node: PenNode): Record<string, any> {
  const shallow: Record<string, any> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== "children") {
      shallow[key] = value;
    }
  }
  return shallow;
}

/**
 * Computes Edit Locality: Inverse of the count of document nodes touched.
 * A semantic edit touches 1 node (locality = 1.0). A block rewrite touches all N nodes (locality = 1/N).
 */
export function computeEditLocality(docBefore: Document, docAfter: Document): number {
  const beforeMap = indexDocument(docBefore);
  const afterMap = indexDocument(docAfter);

  let modifiedCount = 0;
  for (const [id, nodeAfter] of afterMap.entries()) {
    const nodeBefore = beforeMap.get(id);
    if (!nodeBefore || JSON.stringify(shallowNodeProps(nodeBefore)) !== JSON.stringify(shallowNodeProps(nodeAfter))) {
      modifiedCount++;
    }
  }
  for (const id of beforeMap.keys()) {
    if (!afterMap.has(id)) modifiedCount++;
  }

  if (modifiedCount === 0) return 1.0;
  return Number((1 / modifiedCount).toFixed(3));
}
