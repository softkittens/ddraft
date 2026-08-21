import type { Document, PenNode, RefNode } from "./types";
import { childrenOf, isParentNode } from "./tree";

export interface ResolveInstancesResult {
  doc: Document;
  cycles: string[][];
}

function collectReusables(doc: Document): Map<string, PenNode> {
  const map = new Map<string, PenNode>();
  function walk(node: PenNode) {
    if (node.reusable) {
      map.set(node.id, node);
    }
    childrenOf(node).forEach(walk);
  }
  doc.children.forEach(walk);
  return map;
}

function instantiateRef(
  refNode: RefNode,
  reusables: Map<string, PenNode>,
  visitedRefs: Set<string>,
  cycles: string[][]
): PenNode {
  const targetId = refNode.ref;
  if (!targetId) return refNode;

  const def = reusables.get(targetId);
  if (!def) return refNode;

  if (visitedRefs.has(targetId)) {
    cycles.push([...visitedRefs, targetId]);
    return refNode;
  }

  const nextVisited = new Set(visitedRefs);
  nextVisited.add(targetId);

  const clone: PenNode = structuredClone(def);
  delete clone.reusable;
  const descendants = refNode.descendants || {};

  function applyDescendantsAndRemapIds(node: PenNode, isRoot: boolean) {
    const origId = node.id;
    if (!isRoot) {
      node.id = `${refNode.id}:${origId}`;
    }
    if (descendants[origId]) {
      Object.assign(node, descendants[origId]);
    }
    childrenOf(node).forEach((c) => applyDescendantsAndRemapIds(c, false));
  }

  applyDescendantsAndRemapIds(clone, true);

  for (const [k, v] of Object.entries(refNode)) {
    if (k !== "type" && k !== "ref" && k !== "descendants" && v !== undefined) {
      (clone as Record<string, unknown>)[k] = v;
    }
  }
  clone.id = refNode.id;

  if (isParentNode(clone)) {
    clone.children = childrenOf(clone).map((c) => resolveTree(c, reusables, nextVisited, cycles));
  }

  return clone;
}

function resolveTree(
  node: PenNode,
  reusables: Map<string, PenNode>,
  visitedRefs: Set<string>,
  cycles: string[][]
): PenNode {
  const cur = node.type === "ref"
    ? instantiateRef(node, reusables, visitedRefs, cycles)
    : node;

  if (cur !== node) {
    return cur;
  }

  if (isParentNode(cur)) {
    return {
      ...cur,
      children: childrenOf(cur).map((c) => resolveTree(c, reusables, visitedRefs, cycles))
    };
  }
  return cur;
}

/**
 * Resolves component instances (ref nodes) against reusable definitions.
 * Pure function: does NOT mutate source document.
 */
export function resolveInstancesWithDiagnostics(doc: Document): ResolveInstancesResult {
  const reusables = collectReusables(doc);
  const cycles: string[][] = [];
  const resolvedChildren = doc.children.map((c) => resolveTree(c, reusables, new Set<string>(), cycles));
  return {
    doc: {
      ...doc,
      children: resolvedChildren
    },
    cycles
  };
}

export function resolveInstances(doc: Document): Document {
  return resolveInstancesWithDiagnostics(doc).doc;
}
