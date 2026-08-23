import type { Document, PenNode, RefNode } from "./types";
import { setProperty } from "./edit";
import { childrenOf, findNode, isParentNode } from "./tree";

export interface InstanceDescendantTarget {
  refId: string;
  descendantId: string;
}

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

/** Resolve a synthetic resolved-instance ID back to the source ref and component child. */
export function splitInstanceId(doc: Document, id: string): InstanceDescendantTarget | undefined {
  const at = id.indexOf(":");
  if (at <= 0) return undefined;
  const refId = id.slice(0, at);
  const descendantId = id.slice(at + 1);
  const host = findNode(doc.children, refId);
  if (!host || host.type !== "ref" || !descendantId) return undefined;

  const component = host.ref ? findNode(doc.children, host.ref) : null;
  if (!component) return undefined;

  let known = false;
  (function walk(node: PenNode) {
    if (node.id === descendantId) known = true;
    for (const child of childrenOf(node)) walk(child);
  })(component);

  return known ? { refId, descendantId } : undefined;
}

/** Store a property change as an override on a component instance descendant. */
export function setInstanceProperty(
  doc: Document,
  target: InstanceDescendantTarget,
  property: string,
  value: unknown
): Document {
  const host = findNode(doc.children, target.refId);
  if (!host || host.type !== "ref") return doc;
  const descendants = {
    ...(host.descendants ?? {}),
    [target.descendantId]: {
      ...(host.descendants?.[target.descendantId] ?? {}),
      [property]: value
    }
  };
  return setProperty(doc, target.refId, "descendants", descendants);
}
