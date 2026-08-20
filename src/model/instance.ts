import type { Document, PenNode } from "./types";

export interface ResolveInstancesResult {
  doc: Document;
  cycles: string[][];
}

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
  reusables: Map<string, PenNode>,
  visitedRefs: Set<string>,
  cycles: string[][]
): PenNode {
  const targetId = (refNode as any).ref;
  if (!targetId) return refNode;

  const def = reusables.get(targetId);
  if (!def) return refNode;

  // Cycle check: if targetId is already being expanded in the current call chain
  if (visitedRefs.has(targetId)) {
    cycles.push([...visitedRefs, targetId]);
    return refNode;
  }

  const nextVisited = new Set(visitedRefs);
  nextVisited.add(targetId);

  // Deep clone definition
  const clone: PenNode = structuredClone(def);
  delete (clone as any).reusable;
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

  // Resolve nested children with cycle tracking
  if ("children" in clone && Array.isArray(clone.children)) {
    clone.children = clone.children.map((c) => resolveTree(c, reusables, nextVisited, cycles));
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

  if ("children" in cur && Array.isArray(cur.children)) {
    return {
      ...cur,
      children: cur.children.map((c) => resolveTree(c, reusables, visitedRefs, cycles))
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
