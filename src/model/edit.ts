import type { Document, PenNode } from "./types";
import { childrenOf, cloneDocument, findNode, isParentNode, maxNumericId } from "./tree";

export { cloneDocument, findNode };

function isDescendant(parent: PenNode, targetId: string): boolean {
  if (parent.id === targetId) return true;
  return childrenOf(parent).some((child) => isDescendant(child, targetId));
}

function removeFromList(list: PenNode[], id: string): PenNode | null {
  const idx = list.findIndex((n) => n.id === id);
  if (idx !== -1) {
    const [removed] = list.splice(idx, 1);
    return removed ?? null;
  }
  for (const item of list) {
    const found = removeFromList(childrenOf(item), id);
    if (found) return found;
  }
  return null;
}

function propertyValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => propertyValuesEqual(value, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((name) =>
        Object.prototype.hasOwnProperty.call(rightRecord, name) &&
        propertyValuesEqual(leftRecord[name], rightRecord[name])
      );
  }
  return false;
}

export function setProperty(doc: Document, id: string, key: string, value: unknown): Document {
  const target = findNode(doc.children, id);
  if (!target) return doc;
  if (propertyValuesEqual((target as Record<string, unknown>)[key], value)) return doc;

  const newDoc = cloneDocument(doc);
  const cloned = findNode(newDoc.children, id);
  if (!cloned) return doc;

  if (value === undefined) {
    delete (cloned as Record<string, unknown>)[key];
  } else {
    (cloned as Record<string, unknown>)[key] = value;
  }
  return newDoc;
}

function ensureNodeIds(node: any, seed = "node"): void {
  if (!node || typeof node !== "object") return;
  if (!node.id || typeof node.id !== "string" || !node.id.trim()) {
    node.id = `${node.type || seed}_${Math.random().toString(36).slice(2, 8)}`;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      ensureNodeIds(child, seed);
    }
  }
}

export function insertChild(
  doc: Document,
  parentId: string | null | undefined,
  node: PenNode,
  at?: number
): Document {
  const newDoc = cloneDocument(doc);
  const clonedNode = structuredClone(node);
  ensureNodeIds(clonedNode);

  if (!parentId || parentId === "canvas" || parentId === "root" || parentId === "document") {
    const idx = at !== undefined ? Math.max(0, Math.min(at, newDoc.children.length)) : newDoc.children.length;
    newDoc.children.splice(idx, 0, clonedNode);
    return newDoc;
  }

  const parent = findNode(newDoc.children, parentId);
  if (!parent || !isParentNode(parent)) return doc;

  const children = parent.children ?? [];
  parent.children = children;
  const idx = at !== undefined ? Math.max(0, Math.min(at, children.length)) : children.length;
  children.splice(idx, 0, clonedNode);
  return newDoc;
}

export function removeNode(doc: Document, id: string): Document {
  if (!findNode(doc.children, id)) return doc;
  const newDoc = cloneDocument(doc);
  removeFromList(newDoc.children, id);
  return newDoc;
}

export function replaceNode(doc: Document, id: string, replacement: PenNode): Document {
  const newDoc = cloneDocument(doc);
  function doReplace(list: PenNode[]): boolean {
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      list[idx] = structuredClone(replacement);
      return true;
    }
    for (const item of list) {
      if (doReplace(childrenOf(item))) return true;
    }
    return false;
  }
  if (doReplace(newDoc.children)) return newDoc;
  return doc;
}

export function moveNode(doc: Document, id: string, newParentId?: string, at?: number): Document {
  if (id === newParentId) return doc;
  const target = findNode(doc.children, id);
  if (!target || (newParentId && isDescendant(target, newParentId))) return doc;

  const newDoc = cloneDocument(doc);
  const moved = removeFromList(newDoc.children, id);
  if (!moved) return doc;

  const isRootMove = !newParentId || newParentId === "canvas" || newParentId === "root" || newParentId === "document";
  if (isRootMove) {
    let maxX = 0;
    for (const root of newDoc.children) {
      const rightEdge = (root.x ?? 0) + (typeof root.width === "number" ? root.width : 1200);
      if (rightEdge > maxX) maxX = rightEdge;
    }
    if (moved.x === undefined || moved.x === 0) {
      moved.x = newDoc.children.length > 0 ? maxX + 80 : 0;
    }
    if (moved.y === undefined) moved.y = newDoc.children[0]?.y ?? 0;
    const idx = at !== undefined ? Math.max(0, Math.min(at, newDoc.children.length)) : newDoc.children.length;
    newDoc.children.splice(idx, 0, moved);
    return newDoc;
  }

  const parent = findNode(newDoc.children, newParentId);
  if (!parent || !isParentNode(parent)) return doc;

  const children = parent.children ?? [];
  parent.children = children;
  const idx = at !== undefined ? Math.max(0, Math.min(at, children.length)) : children.length;
  children.splice(idx, 0, moved);
  return newDoc;
}

export function getNextNodeId(doc: Document, prefix = "node"): string {
  return `${prefix}_${maxNumericId(doc.children) + 1}`;
}

export function duplicateNode(doc: Document, id: string): { doc: Document; newId: string } | null {
  let counter = maxNumericId(doc.children);
  const newDoc = cloneDocument(doc);

  function findAndDuplicate(list: PenNode[]): string | null {
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      const orig = list[idx];
      const cloneNode = structuredClone(orig);
      let newRootId = "";
      function regenerateIds(n: PenNode, isRoot: boolean) {
        counter++;
        n.id = `${n.type || "node"}_${counter}`;
        if (isRoot) newRootId = n.id;
        for (const child of childrenOf(n)) regenerateIds(child, false);
      }
      regenerateIds(cloneNode, true);
      if (list === newDoc.children) {
        let maxX = 0;
        for (const root of newDoc.children) {
          const rightEdge = (root.x ?? 0) + (typeof root.width === "number" ? root.width : 1200);
          if (rightEdge > maxX) maxX = rightEdge;
        }
        if (maxX > 0) cloneNode.x = maxX + 80;
        cloneNode.y = orig.y ?? 0;
      }
      list.splice(idx + 1, 0, cloneNode);
      return newRootId;
    }

    for (const item of list) {
      const found = findAndDuplicate(childrenOf(item));
      if (found) return found;
    }
    return null;
  }

  const newId = findAndDuplicate(newDoc.children);
  if (!newId) return null;
  return { doc: newDoc, newId };
}

export function reorderChild(doc: Document, parentId: string, from: number, to: number): Document {
  const parent = findNode(doc.children, parentId);
  if (!parent) return doc;

  const children = childrenOf(parent);
  if (from < 0 || from >= children.length || to < 0 || to >= children.length || from === to) {
    return doc;
  }

  const newDoc = cloneDocument(doc);
  const cloned = findNode(newDoc.children, parentId);
  if (!cloned) return doc;

  const list = childrenOf(cloned);
  const [moved] = list.splice(from, 1);
  if (!moved) return doc;
  list.splice(to, 0, moved);
  return newDoc;
}
