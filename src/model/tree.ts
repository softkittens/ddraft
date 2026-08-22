import type { Document, FrameNode, GroupNode, PenNode } from "./types";

export function isParentNode(n: PenNode): n is FrameNode | GroupNode {
  return isNode(n) && (n.type === "frame" || n.type === "group");
}

/**
 * A node the traversal can reason about. Model output reaches this code, and a
 * children array holding a string or a null used to throw out of every walk,
 * taking the whole audit down with it.
 */
export function isNode(n: unknown): n is PenNode {
  return typeof n === "object" && n !== null;
}

export function childrenOf(n: PenNode): PenNode[] {
  if (!isNode(n) || !("children" in n) || !Array.isArray(n.children)) return [];
  const kids = n.children;
  // Hand back the live array whenever it is sound. Callers splice into this to
  // edit the document, and a filtered copy would swallow the edit.
  return kids.every(isNode) ? kids : kids.filter(isNode);
}

export function walkNodes(nodes: PenNode[], visit: (n: PenNode) => void): void {
  for (const n of nodes) {
    if (!isNode(n)) continue;
    visit(n);
    walkNodes(childrenOf(n), visit);
  }
}

export function indexDocument(doc: Document): Map<string, PenNode> {
  const map = new Map<string, PenNode>();
  walkNodes(doc.children, (n) => map.set(n.id, n));
  return map;
}

export function findNode(nodes: PenNode[], id: string): PenNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(childrenOf(node), id);
    if (found) return found;
  }
  return null;
}

export function findParent(nodes: PenNode[], targetId: string): PenNode | null {
  for (const node of nodes) {
    const kids = childrenOf(node);
    if (kids.some((k) => k.id === targetId)) return node;
    const found = findParent(kids, targetId);
    if (found) return found;
  }
  return null;
}

export function cloneDocument(doc: Document): Document {
  return structuredClone(doc);
}

export function maxNumericId(nodes: PenNode[]): number {
  let max = 0;
  walkNodes(nodes, (n) => {
    const match = n.id.match(/(\d+)$/);
    if (!match) return;
    const num = parseInt(match[1], 10);
    if (!Number.isNaN(num) && num > max) max = num;
  });
  return max;
}
