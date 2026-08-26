import type { Document, PenNode } from "./types";
import { cloneDocument } from "./tree";

/**
 * Pages, without a page container.
 *
 * The .pen document root is closed: version, themes, imports, variables,
 * children. There is no page node and no root grouping, so a page here is not
 * a thing that holds screens — it is a label screens carry.
 *
 * The label goes in `metadata`, which the schema declares as an open bag on
 * every node, rather than as a bare `page` property, which the schema does not
 * declare at all. A bare property is a bet on how another parser treats a key
 * it does not recognise; the bag is documented to accept anything. Membership
 * is the fact that cannot be lost quietly — drop it and every screen still
 * renders while silently belonging nowhere — so it lives where the format
 * promises to keep it.
 *
 * Page order and display names live on the document instead. Losing those
 * costs an ordering that first appearance can rebuild, which is the kind of
 * loss you can see and repair.
 */

/** Where a top-level frame records the page it belongs to. */
export const PAGE_METADATA_KEY = "page";

/** Where page order and display names are recorded on the document. */
export const PAGES_METADATA_KEY = "pages";

/**
 * The page holding screens that carry no label.
 *
 * Every document written before pages existed resolves to this one page, and a
 * single page behaves exactly as a flat child list did. That is the whole
 * compatibility story: nothing migrates, nothing is stamped on load, and a
 * document only gains a second page once something writes a label.
 */
export const IMPLICIT_PAGE_ID = "__unassigned";

export interface Page {
  id: string;
  name: string;
  /** Top-level nodes on this page, in document order. */
  screens: PenNode[];
  /** True for the page that collects unlabelled screens. */
  implicit: boolean;
}

interface PagesRecord {
  order?: string[];
  names?: Record<string, string>;
}

function pagesRecord(doc: Document): PagesRecord {
  const raw = doc.metadata?.[PAGES_METADATA_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const order = Array.isArray(record.order)
    ? record.order.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : undefined;
  const namesRaw = record.names;
  let names: Record<string, string> | undefined;
  if (namesRaw && typeof namesRaw === "object" && !Array.isArray(namesRaw)) {
    names = {};
    for (const [id, value] of Object.entries(namesRaw as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) names[id] = value.trim();
    }
  }
  return { order, names };
}

/** The page a node claims, or undefined when it claims none. */
export function pageIdOf(node: PenNode): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const value = (node as any).metadata?.[PAGE_METADATA_KEY];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Every page in the document, in display order.
 *
 * An unlabelled document yields one implicit page holding all of it. A partly
 * labelled one — the state a canvas passes through the moment a first page is
 * named — yields the implicit page first, then the named ones. No top-level
 * node is ever omitted: a screen with no label is not a screen with no home.
 *
 * A page declared in document metadata but holding nothing is still listed, so
 * the UI can offer an empty page to build into. Those are the only pages that
 * vanish if another tool discards document metadata, and an empty page has
 * nothing to lose.
 */
export function pagesOf(doc: Document): Page[] {
  const children = Array.isArray(doc.children) ? doc.children : [];
  const { order = [], names = {} } = pagesRecord(doc);

  const members = new Map<string, PenNode[]>();
  const unassigned: PenNode[] = [];
  for (const node of children) {
    const id = pageIdOf(node);
    if (!id) {
      unassigned.push(node);
      continue;
    }
    const bucket = members.get(id);
    if (bucket) bucket.push(node);
    else members.set(id, [node]);
  }

  // Declared order first, then any page a screen names that the document never
  // declared. A label written by hand outranks an index that forgot about it.
  const ids: string[] = [];
  for (const id of order) {
    if (id !== IMPLICIT_PAGE_ID && !ids.includes(id)) ids.push(id);
  }
  for (const id of members.keys()) {
    if (!ids.includes(id)) ids.push(id);
  }

  const pages: Page[] = [];
  if (unassigned.length > 0) {
    pages.push({
      id: IMPLICIT_PAGE_ID,
      name: names[IMPLICIT_PAGE_ID] ?? (ids.length > 0 ? "Unassigned" : "Page 1"),
      screens: unassigned,
      implicit: true
    });
  }
  for (const id of ids) {
    pages.push({
      id,
      name: names[id] ?? id,
      screens: members.get(id) ?? [],
      implicit: false
    });
  }
  return pages;
}

/**
 * The top-level nodes to work on.
 *
 * Called without a page this returns the whole child list, which is what every
 * caller did before pages existed. That is deliberate: a consumer can be moved
 * onto this function in one commit that changes no behaviour, and gain a page
 * argument in a later one that does.
 */
export function screensOfPage(doc: Document, pageId?: string): PenNode[] {
  const children = Array.isArray(doc.children) ? doc.children : [];
  if (!pageId) return children;
  if (pageId === IMPLICIT_PAGE_ID) return children.filter((node) => !pageIdOf(node));
  return children.filter((node) => pageIdOf(node) === pageId);
}

/**
 * The document as one page sees it.
 *
 * Only `children` narrows. Metadata, variables, themes and imports are the
 * document's, not a page's, and a view that dropped them would tell the agent
 * no style had been chosen and the direction contract did not exist.
 *
 * Node references are shared, not copied: this is a reading view. Writes go to
 * the real document, which is why the tools guard ids instead of editing this.
 */
export function pageScopedDocument(doc: Document, pageId?: string): Document {
  if (!pageId) return doc;
  const children = screensOfPage(doc, pageId);
  if (children.length === (Array.isArray(doc.children) ? doc.children.length : 0)) return doc;
  return { ...doc, children };
}

/** The page a node sits on, following it up to the top-level frame that owns it. */
export function pageOfNode(doc: Document, nodeId: string): string | undefined {
  const children = Array.isArray(doc.children) ? doc.children : [];
  for (const root of children) {
    if (root.id === nodeId || containsId(root, nodeId)) return pageIdOf(root);
  }
  return undefined;
}

function containsId(node: PenNode, id: string): boolean {
  const kids = (node as any).children;
  if (!Array.isArray(kids)) return false;
  for (const child of kids) {
    if (!child || typeof child !== "object") continue;
    if (child.id === id || containsId(child, id)) return true;
  }
  return false;
}

/**
 * Put a top-level node on a page, or take its label off with undefined.
 *
 * Only top-level nodes carry a page. A page is a partition of the canvas root,
 * and letting a nested frame claim a different page than the screen around it
 * would describe a canvas that cannot be drawn.
 */
export function setPageOf(doc: Document, nodeId: string, pageId: string | undefined): Document {
  const children = Array.isArray(doc.children) ? doc.children : [];
  const index = children.findIndex((node) => node.id === nodeId);
  if (index === -1) return doc;

  const raw = pageId?.trim();
  const next = raw && raw !== IMPLICIT_PAGE_ID ? raw : undefined;
  if (pageIdOf(children[index]) === next) return doc;

  const newDoc = cloneDocument(doc);
  const target = newDoc.children[index] as any;
  const metadata = { ...(target.metadata ?? {}) };
  if (next) metadata[PAGE_METADATA_KEY] = next;
  else delete metadata[PAGE_METADATA_KEY];

  if (Object.keys(metadata).length > 0) target.metadata = metadata;
  else delete target.metadata;
  return newDoc;
}

function writePagesRecord(doc: Document, patch: PagesRecord): Document {
  const newDoc = cloneDocument(doc);
  const current = pagesRecord(doc);
  const merged: PagesRecord = {
    order: patch.order ?? current.order,
    names: patch.names ?? current.names
  };
  const record: Record<string, unknown> = {};
  if (merged.order && merged.order.length > 0) record.order = merged.order;
  if (merged.names && Object.keys(merged.names).length > 0) record.names = merged.names;

  const metadata = { ...(newDoc.metadata ?? {}) };
  if (Object.keys(record).length > 0) metadata[PAGES_METADATA_KEY] = record;
  else delete metadata[PAGES_METADATA_KEY];

  if (Object.keys(metadata).length > 0) newDoc.metadata = metadata;
  else delete newDoc.metadata;
  return newDoc;
}

/** Declare a page so it can be listed and selected before it holds anything. */
export function declarePage(doc: Document, pageId: string, name?: string): Document {
  const id = pageId.trim();
  if (!id || id === IMPLICIT_PAGE_ID) return doc;
  const { order = [], names = {} } = pagesRecord(doc);
  if (order.includes(id) && (name === undefined || names[id] === name.trim())) return doc;

  const nextOrder = order.includes(id) ? order : [...order, id];
  const nextNames = { ...names };
  if (name?.trim()) nextNames[id] = name.trim();
  return writePagesRecord(doc, { order: nextOrder, names: nextNames });
}

/**
 * Give a page a display name distinct from its id.
 *
 * Naming a page also enters it into the order, at the end. Without that, a page
 * known only through the labels its screens carry never joins the order at all,
 * and the next page to be declared outright sorts ahead of pages that have been
 * on the canvas since the start.
 */
export function renamePage(doc: Document, pageId: string, name: string): Document {
  const id = pageId.trim();
  const label = name.trim();
  if (!id || !label) return doc;
  const { order = [], names = {} } = pagesRecord(doc);
  const ordered = id === IMPLICIT_PAGE_ID || order.includes(id) ? order : [...order, id];
  if (names[id] === label && ordered === order) return doc;
  return writePagesRecord(doc, { order: ordered, names: { ...names, [id]: label } });
}

/**
 * Set the display order.
 *
 * Ids the document does not use are kept rather than dropped — a page whose
 * only screen was just deleted still has a place to come back to, and a stale
 * entry costs an unused string.
 */
export function reorderPages(doc: Document, pageIds: string[]): Document {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const raw of pageIds) {
    const id = raw.trim();
    if (!id || id === IMPLICIT_PAGE_ID || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  const { order: current = [] } = pagesRecord(doc);
  for (const id of current) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  return writePagesRecord(doc, { order });
}

/** Forget a page, leaving its screens on the canvas without a label. */
export function removePage(doc: Document, pageId: string): Document {
  const id = pageId.trim();
  if (!id || id === IMPLICIT_PAGE_ID) return doc;

  let next = doc;
  for (const node of screensOfPage(doc, id)) {
    next = setPageOf(next, node.id, undefined);
  }
  const { order = [], names = {} } = pagesRecord(next);
  if (!order.includes(id) && !(id in names)) return next;

  const nextNames = { ...names };
  delete nextNames[id];
  return writePagesRecord(next, { order: order.filter((entry) => entry !== id), names: nextNames });
}

/** An id no page in this document is using. */
export function nextPageId(doc: Document): string {
  const taken = new Set<string>(pagesOf(doc).map((page) => page.id));
  const { order = [] } = pagesRecord(doc);
  for (const id of order) taken.add(id);
  let n = 1;
  while (taken.has(`page_${n}`)) n += 1;
  return `page_${n}`;
}
