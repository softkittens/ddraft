import type { Document, PenNode } from "./types";

function cloneDocument(doc: Document): Document {
  return structuredClone(doc);
}

function findNode(nodes: PenNode[], id: string): PenNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if ("children" in node && Array.isArray(node.children)) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function isDescendant(parent: PenNode, targetId: string): boolean {
  if (parent.id === targetId) return true;
  if ("children" in parent && Array.isArray(parent.children)) {
    for (const child of parent.children) {
      if (isDescendant(child, targetId)) return true;
    }
  }
  return false;
}

export function setProperty(doc: Document, id: string, key: string, value: any): Document {
  const newDoc = cloneDocument(doc);
  const target = findNode(newDoc.children, id);
  if (!target) return newDoc;

  if (value === undefined) {
    delete (target as any)[key];
  } else {
    (target as any)[key] = value;
  }
  return newDoc;
}

export function insertChild(doc: Document, parentId: string, node: PenNode, at?: number): Document {
  const parent = findNode(doc.children, parentId);
  if (!parent) return doc;

  // Only frames and groups can hold children
  if (parent.type !== "frame" && parent.type !== "group") {
    return doc;
  }

  const newDoc = cloneDocument(doc);
  const parentInClone = findNode(newDoc.children, parentId);
  if (!parentInClone || (parentInClone.type !== "frame" && parentInClone.type !== "group")) return doc;

  if (!("children" in parentInClone) || !Array.isArray(parentInClone.children)) {
    (parentInClone as any).children = [];
  }

  const children = (parentInClone as any).children as PenNode[];
  const idx = at !== undefined ? Math.max(0, Math.min(at, children.length)) : children.length;
  children.splice(idx, 0, structuredClone(node));
  return newDoc;
}

export function removeNode(doc: Document, id: string): Document {
  const newDoc = cloneDocument(doc);

  function removeFromList(list: PenNode[]): boolean {
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      list.splice(idx, 1);
      return true;
    }
    for (const item of list) {
      if ("children" in item && Array.isArray(item.children)) {
        if (removeFromList(item.children)) return true;
      }
    }
    return false;
  }

  removeFromList(newDoc.children);
  return newDoc;
}

export function moveNode(doc: Document, id: string, newParentId: string, at?: number): Document {
  if (id === newParentId) return doc;
  const target = findNode(doc.children, id);
  if (!target) return doc;

  // Refuse move if newParentId is a descendant of id
  if (isDescendant(target, newParentId)) return doc;

  const newDoc = cloneDocument(doc);
  const targetInClone = findNode(newDoc.children, id);
  if (!targetInClone) return doc;

  const withoutNode = removeNode(newDoc, id);
  return insertChild(withoutNode, newParentId, targetInClone, at);
}

/**
 * Returns the next monotonic ID seeded from the highest numeric ID in the document.
 */
export function getNextNodeId(doc: Document, prefix = "node"): string {
  let maxNum = 0;
  function scan(n: PenNode) {
    const match = n.id.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
    if ("children" in n && Array.isArray(n.children)) {
      n.children.forEach(scan);
    }
  }
  doc.children.forEach(scan);
  return `${prefix}_${maxNum + 1}`;
}

/**
 * Clones a node with fresh monotonic IDs and inserts it right next to the original node.
 */
export function duplicateNode(doc: Document, id: string): { doc: Document; newId: string } | null {
  let counter = 0;
  function findMaxNum(n: PenNode) {
    const match = n.id.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > counter) counter = num;
    }
    if ("children" in n && Array.isArray(n.children)) {
      n.children.forEach(findMaxNum);
    }
  }
  doc.children.forEach(findMaxNum);

  const newDoc = cloneDocument(doc);

  function findAndDuplicate(list: PenNode[]): string | null {
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      const orig = list[idx];
      const cloneNode: any = structuredClone(orig);
      let newRootId = "";
      function regenerateIds(n: any, isRoot: boolean) {
        counter++;
        n.id = `${n.type || "node"}_${counter}`;
        if (isRoot) newRootId = n.id;
        if (n.children && Array.isArray(n.children)) {
          for (const child of n.children) {
            regenerateIds(child, false);
          }
        }
      }
      regenerateIds(cloneNode, true);
      list.splice(idx + 1, 0, cloneNode);
      return newRootId;
    }

    for (const item of list) {
      if ("children" in item && Array.isArray(item.children)) {
        const found = findAndDuplicate(item.children);
        if (found) return found;
      }
    }
    return null;
  }

  const newId = findAndDuplicate(newDoc.children);
  if (!newId) return null;
  return { doc: newDoc, newId };
}

/**
 * Purely reorders a child inside a parent frame/group's children array.
 */
export function reorderChild(doc: Document, parentId: string, from: number, to: number): Document {
  const newDoc = cloneDocument(doc);
  const parent = findNode(newDoc.children, parentId);
  if (!parent || !("children" in parent) || !Array.isArray(parent.children)) {
    return newDoc;
  }

  const children = parent.children as PenNode[];
  if (from < 0 || from >= children.length || to < 0 || to >= children.length || from === to) {
    return newDoc;
  }

  const [moved] = children.splice(from, 1);
  children.splice(to, 0, moved);
  return newDoc;
}
