import type { Document, FrameNode, GroupNode, PenNode } from "./types";

export function isParentNode(n: PenNode): n is FrameNode | GroupNode {
  return n.type === "frame" || n.type === "group";
}

export function childrenOf(n: PenNode): PenNode[] {
  return "children" in n && Array.isArray(n.children) ? n.children : [];
}

export function walkNodes(nodes: PenNode[], visit: (n: PenNode) => void): void {
  for (const n of nodes) {
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
