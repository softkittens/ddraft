import type { Document, PenNode } from "./types";

function collectReusables(doc: Document): Map<string, PenNode> {
  const map = new Map<string, PenNode>();
  function walk(node: PenNode) {
    if ((node as any).reusable) {
      map.set(node.id, node);
    }
    if ("children" in node && Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  }
  doc.children.forEach(walk);
  return map;
}

function instantiateRef(
  refNode: PenNode,
  reusables: Map<string, PenNode>
): PenNode {
  const targetId = (refNode as any).ref;
  const def = reusables.get(targetId);
  if (!def) return refNode;

  // Deep clone definition
  const clone: PenNode = JSON.parse(JSON.stringify(def));
  const descendants = (refNode as any).descendants || {};

  function applyDescendantsAndRemapIds(node: PenNode, isRoot: boolean) {
    const origId = node.id;
    if (!isRoot) {
      node.id = `${refNode.id}:${origId}`;
    }
    if (descendants[origId]) {
      Object.assign(node, descendants[origId]);
    }
    if ("children" in node && Array.isArray(node.children)) {
      node.children.forEach((c) => applyDescendantsAndRemapIds(c, false));
    }
  }

  applyDescendantsAndRemapIds(clone, true);

  // Instance properties override definition properties
  for (const [k, v] of Object.entries(refNode)) {
    if (k !== "type" && k !== "ref" && k !== "descendants" && v !== undefined) {
      (clone as any)[k] = v;
    }
  }
  clone.id = refNode.id;

  return clone;
}

function resolveTree(node: PenNode, reusables: Map<string, PenNode>): PenNode {
  const cur = node.type === "ref" ? instantiateRef(node, reusables) : node;
  if ("children" in cur && Array.isArray(cur.children)) {
    return {
      ...cur,
      children: cur.children.map((c) => resolveTree(c, reusables))
    };
  }
  return cur;
}

/**
 * Resolves component instances (ref nodes) against reusable definitions.
 * Pure function: does NOT mutate source document.
 */
export function resolveInstances(doc: Document): Document {
  const reusables = collectReusables(doc);
  return {
    ...doc,
    children: doc.children.map((c) => resolveTree(c, reusables))
  };
}
