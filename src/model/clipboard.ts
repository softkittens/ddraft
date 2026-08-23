import type { Document, PenNode } from "./types";
import { childrenOf, cloneDocument, findNode, indexDocument, isParentNode, maxNumericId } from "./tree";
import { setPageOf } from "./pages";

/**
 * Cut, copy and paste for canvas nodes.
 *
 * Moving a screen between pages is the reason this exists, so the id rule is
 * built around not breaking one: a pasted id is kept when the document does not
 * already have it, and regenerated when it does. That single rule gives the
 * three behaviours you want without a mode flag —
 *
 *   cut then paste     the original is gone, ids are free, the screen arrives
 *                      intact and every `ref` pointing into it still resolves
 *   copy then paste    the original is still there, so ids collide and the
 *                      copy gets fresh ones
 *   paste twice        the first paste took the ids, the second gets fresh ones
 *
 * A clipboard that always regenerated would silently detach component
 * instances every time a user moved a screen to another page.
 */

export interface ClipboardContents {
  /** Detached copies. The document they came from may have changed since. */
  nodes: PenNode[];
  /** True when the nodes were at the top level, which decides where they land. */
  fromRoot: boolean;
}

/** Lift nodes out of a document for the clipboard, dropping ids it cannot find. */
export function copyNodes(doc: Document, ids: Iterable<string>): ClipboardContents | null {
  const wanted = [...ids];
  if (wanted.length === 0) return null;

  const rootIds = new Set(doc.children.map((n) => n.id));
  const found: PenNode[] = [];
  for (const id of wanted) {
    const node = findNode(doc.children, id);
    // A composite instance id names an override, not a node. There is nothing
    // to lift out of the tree for it.
    if (node) found.push(structuredClone(node));
  }
  if (found.length === 0) return null;

  return { nodes: found, fromRoot: found.every((n) => rootIds.has(n.id)) };
}

interface PasteOptions {
  /** Page the pasted top-level nodes join. */
  pageId?: string;
  /** Frame to paste into. Ignored when it cannot hold children. */
  parentId?: string;
  /** Screens already on the destination page, used to place a pasted screen beside them. */
  siblings?: readonly PenNode[];
}

/**
 * Put clipboard nodes into a document.
 *
 * Returns the same document when there is nothing to paste, so callers can
 * compare by identity rather than guessing whether to push an undo entry.
 */
export function pasteNodes(
  doc: Document,
  clipboard: ClipboardContents,
  options: PasteOptions = {}
): { doc: Document; ids: string[] } {
  if (clipboard.nodes.length === 0) return { doc, ids: [] };

  const newDoc = cloneDocument(doc);
  const taken = new Set(indexDocument(newDoc).keys());
  let counter = maxNumericId(newDoc.children);

  const parent = options.parentId ? findNode(newDoc.children, options.parentId) : null;
  const intoParent = parent && isParentNode(parent) ? parent : null;

  const pasted: PenNode[] = [];
  const ids: string[] = [];

  for (const source of clipboard.nodes) {
    const node = structuredClone(source);
    const renamed = new Map<string, string>();

    // Two passes: every id is decided before any `ref` is rewritten, so a ref
    // pointing forwards at a later sibling still finds its new name.
    const claim = (n: PenNode): void => {
      if (taken.has(n.id)) {
        counter += 1;
        let fresh = `${n.type || "node"}_${counter}`;
        while (taken.has(fresh)) {
          counter += 1;
          fresh = `${n.type || "node"}_${counter}`;
        }
        renamed.set(n.id, fresh);
        n.id = fresh;
      }
      taken.add(n.id);
      for (const child of childrenOf(n)) claim(child);
    };
    claim(node);

    const rewrite = (n: PenNode): void => {
      const ref = (n as any).ref;
      if (typeof ref === "string" && renamed.has(ref)) (n as any).ref = renamed.get(ref);
      for (const child of childrenOf(n)) rewrite(child);
    };
    rewrite(node);

    pasted.push(node);
    ids.push(node.id);
  }

  if (intoParent) {
    intoParent.children = [...childrenOf(intoParent), ...pasted];
    return { doc: newDoc, ids };
  }

  // Top level: lay the nodes out beside what is already on the page rather than
  // on top of it. Pasting a screen onto an empty page keeps its own position.
  const siblings = options.siblings ?? [];
  let cursor = 0;
  for (const node of siblings) {
    const right = (node.x ?? 0) + (typeof node.width === "number" ? node.width : 1200);
    if (right > cursor) cursor = right;
  }
  const baseY = siblings[0]?.y ?? 0;

  let result = newDoc;
  for (const node of pasted) {
    if (siblings.length > 0) {
      node.x = cursor + 80;
      node.y = baseY;
      cursor = node.x + (typeof node.width === "number" ? node.width : 1200);
    }
    result.children.push(node);
  }
  for (const id of ids) result = setPageOf(result, id, options.pageId);

  return { doc: result, ids };
}
