import type { Document, PenNode } from "../../model/types";
import { setProperty } from "../../model/edit";
import { childrenOf, findNode } from "../../model/tree";
import { normalisePadding } from "../../layout/padding";
import { resolveInstances } from "../../model/instance";
import { layoutResolvedDocument, flattenLayoutTree } from "../../layout/layout";
import type { LayoutNode } from "../../layout/types";
import { getLucideIconPath } from "../../model/icons";
import { viewportFor, MAX_SCREEN_HEIGHT } from "../../design/scaffold";
import { hasAuthoredContent } from "../../design/helpers";
import { ALLOWED_PROPERTIES } from "../../model/vocabulary";
import type { FetchFn, Tool } from "../provider";
import type { ChromeArchetype } from "../../design/chrome";

export interface ToolContext {
  /** The whole document. Writes land here, because a page is a view, not a store. */
  get doc(): Document;
  setDoc(next: Document): void;
  get initialDoc(): Document;
  /**
   * The document narrowed to the page being worked on.
   *
   * Every digest the agent reads comes from this. A run that can see four
   * pages of screens spends its context on three it was not asked about, and
   * reliably starts editing them.
   */
  get pageDoc(): Document;
  /** The page new top-level screens join. Undefined when the document has no pages. */
  readonly pageId: string | undefined;
  /**
   * An error to return when the id names something outside the page, or
   * undefined when the tool may proceed. Always undefined when no page is
   * active, so a single-page document behaves exactly as it did before.
   */
  offPage(id: string | undefined): string | undefined;
  image: { providerId?: string; apiKey?: string; fetch?: FetchFn };
  recordWrite(id: string, property: string, value: unknown): string;
  /**
   * Product type this run resolved. create_screen reads it so a site never
   * grows rails and a tool always does — the model is not asked to remember.
   */
  readonly archetype: ChromeArchetype;
}

export interface DocumentToolDefinition {
  name: string;
  description: string;
  parameters: Tool["parameters"];
  execute: (ctx: ToolContext, args: any) => Promise<string> | string;
}

/*
 * Re-exported from the model. What the renderer honours is a fact about the
 * document, not about the agent, and the editor's write path reads the same
 * set.
 */
export { ALLOWED_PROPERTIES };

export const GEOMETRY_PROPERTIES = new Set([
  "width", "height", "gap", "padding", "layout", "fontSize", "lineHeight",
  "letterSpacing", "textGrowth", "alignItems", "justifyContent", "strokeWidth"
]);

export const WHOLE_DOC_ALIASES = new Set(["root", "document", "canvas"]);

export function resolveIconGeometry<T>(node: T): T {
  const item = node as any;
  if (!item || typeof item !== "object") return node;
  if (item.type === "icon" && typeof item.icon === "string" && !item.geometry) {
    const geom = getLucideIconPath(item.icon);
    if (geom) item.geometry = geom;
  }
  if (Array.isArray(item.children)) {
    for (const child of item.children) resolveIconGeometry(child);
  }
  return node;
}

/** A CSS percentage written where the engine only understands numbers. */
const PERCENT_SIZE = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/;

/**
 * Turn `width: "82%"` into the pixels it meant.
 *
 * The engine has no percentage. parseSizing falls through to its last line,
 * `{ mode: "fixed", value: 0 }`, so a node sized this way renders as a
 * zero-pixel box and nothing anywhere says so — not the tool result, not the
 * audit, not the critic. All twelve percentage sizes in the logs are the fill
 * of a progress track, and all twelve shipped a bar that draws nothing beside
 * a label reading "82%".
 *
 * The model was not wrong about what it wanted, only about how to say it, and
 * the parent's resolved box is right here. Refusing the write would cost a
 * round trip to learn a number this tool already knows, so it resolves the
 * value and reports the arithmetic instead.
 */
export function resolvePercentSizes(doc: Document): { doc: Document; notes: string[] } {
  const pending: { id: string; axis: "width" | "height"; pct: number }[] = [];
  const collect = (nodes: readonly PenNode[]): void => {
    for (const node of nodes) {
      for (const axis of ["width", "height"] as const) {
        const raw = (node as any)[axis];
        const match = typeof raw === "string" ? raw.match(PERCENT_SIZE) : null;
        if (match) pending.push({ id: node.id, axis, pct: parseFloat(match[1]) });
      }
      collect(childrenOf(node));
    }
  };
  collect(doc.children);
  if (pending.length === 0) return { doc, notes: [] };

  const flat = flattenLayoutTree(layoutResolvedDocument(resolveInstances(doc)));
  const notes: string[] = [];
  let next = doc;

  for (const { id, axis, pct } of pending) {
    const parentId = parentOfNode(doc, id);
    const parentBox = parentId ? flat.get(parentId)?.box : undefined;
    const parentNode = parentId ? findNode(doc.children, parentId) : undefined;
    if (!parentBox) continue;
    const pad = normalisePadding((parentNode as any)?.padding);
    const inner =
      axis === "width"
        ? parentBox.width - pad.left - pad.right
        : parentBox.height - pad.top - pad.bottom;
    // A parent that is itself hugging this child has no size to take a share
    // of yet. Leaving the percentage in place keeps it visible to the audit
    // rather than silently resolving it to nothing.
    if (!(inner > 1)) continue;
    const px = Math.round((inner * pct) / 100);
    next = setProperty(next, id, axis, px);
    notes.push(`${id}.${axis}: ${pct}% of ${Math.round(inner)}px = ${px}px`);
  }

  if (notes.length === 0) return { doc, notes: [] };
  return {
    doc: next,
    notes: [
      `note: resolved ${notes.length} percentage size${notes.length === 1 ? "" : "s"} to pixels ` +
        "(the engine has no percentage — an unresolved one renders as a 0px box): " +
        notes.slice(0, 6).join(", ") +
        (notes.length > 6 ? ", ..." : "") +
        "."
    ]
  };
}

export function applyIconRename(doc: Document, id: string, property: string, value: unknown): Document {
  if (property !== "icon" || typeof value !== "string") return doc;
  return setProperty(doc, id, "geometry", getLucideIconPath(value) || undefined);
}

export function measuredNote(doc: Document, id: string): string {
  try {
    const flat = flattenLayoutTree(layoutResolvedDocument(resolveInstances(doc)));
    const node = flat.get(id);
    if (!node) return "";
    const box = (n: { box: { width: number; height: number } }) =>
      `${Math.round(n.box.width)}x${Math.round(n.box.height)}`;
    const label = (nid: string): string => {
      const data = findNode(doc.children, nid);
      return data?.name ? `"${data.name}"` : nid;
    };
    const parts = [`measured: ${label(id)} is now ${box(node)}px`];

    /*
     * The whole ancestor chain, not just the parent.
     *
     * 68 of the 76 `measure` calls that follow a property write in the logs
     * ask about an ancestor rather than the node just written — usually the
     * screen root. The model does not want to know how big the card is, it
     * wants to know what the card did to the screen. Answering only one level
     * up left that question open, and the only way to close it was a round
     * trip, which is the single most common way this loop spends its round
     * budget on nothing.
     */
    const chain: string[] = [];
    let cursor = parentOfNode(doc, id);
    for (let hops = 0; cursor && hops < 12; hops += 1) {
      const ancestor = flat.get(cursor);
      if (ancestor) chain.push(`${label(cursor)} ${box(ancestor)}px`);
      cursor = parentOfNode(doc, cursor);
    }
    if (chain.length > 0) {
      // Keep the two nearest and the screen: the middle of a deep chain is
      // scaffolding the model already knows about.
      const shown = chain.length <= 3 ? chain : [chain[0], chain[1], chain[chain.length - 1]];
      parts.push(`inside ${shown.join(" < ")}`);
    }
    return parts.join(", ") + ".";
  } catch {
    return "";
  }
}

export function parentOfNode(doc: Document, id: string): string | undefined {
  let found: string | undefined;
  function walk(node: PenNode) {
    for (const child of childrenOf(node)) {
      if (child.id === id) found = node.id;
      else walk(child);
    }
  }
  for (const root of doc.children) {
    if (root.id === id) return undefined;
    walk(root);
  }
  return found;
}

export function parentIdOf(doc: Document, id: string): string | undefined {
  function walk(nodes: PenNode[], parent?: PenNode): string | undefined {
    for (const n of nodes) {
      if (n.id === id) return parent?.id;
      const found = walk(childrenOf(n), n);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return walk(doc.children);
}

/**
 * Writes into stamped chrome (status bar, tab bar, header divider) are not a
 * design decision. The prompt used to say so; the digest still offered the ids.
 */
export function chromeWriteError(doc: Document, id: string | undefined): string | undefined {
  if (!id) return undefined;
  let current: string | undefined = id;
  while (current) {
    const node = findNode(doc.children, current);
    if (node && (node as { metadata?: { scaffold?: string } }).metadata?.scaffold === "chrome") {
      return `error: ${id} is screen chrome, not a content slot. Fill the slots create_screen returned.`;
    }
    current = parentIdOf(doc, current);
  }
  return undefined;
}

/**
 * Deleting Main, Top Bar, or chrome is how a revision wipes a finished page.
 * 9aa7670e deleted n3 (Main) after a 5/5 visual pass; the close-ups went cream.
 */
export function scaffoldDeleteError(doc: Document, id: string | undefined): string | undefined {
  if (!id) return undefined;
  const node = findNode(doc.children, id);
  if (!node) return undefined;
  const role = (node as { metadata?: { scaffold?: string } }).metadata?.scaffold;
  if (role === "slot") {
    const name = node.name ? ` ("${node.name}")` : "";
    return `error: ${id}${name} is a create_screen slot. Delete or edit its children, not the slot.`;
  }
  if (role === "chrome") {
    return `error: ${id} is screen chrome. Leave it in place.`;
  }
  return undefined;
}

/**
 * 8ab1ecbc: Muse Spark created a blank second desktop, then deleted the
 * finished first one. The only-root guard does not fire once a second screen
 * exists, which is exactly the wipe order. A screen that already holds a
 * design is not disposable.
 */
export function populatedScreenDeleteError(
  pageRoots: PenNode[],
  id: string,
  confirm?: boolean
): string | undefined {
  if (confirm) return undefined;
  const root = pageRoots.find((node) => node.id === id);
  if (!root || !hasAuthoredContent(root)) return undefined;
  const name = root.name ? ` "${root.name}"` : "";
  return `error: cannot delete ${id}${name} — it already has a design. To confirm deleting this populated screen, pass { confirm: true }. Otherwise, edit its slots or use replace_node to update sections in-place.`;
}

/**
 * A site landing page can have multiple distinct screens (e.g. Home, Pricing, Checkout),
 * but creating an identical duplicate desktop screen or rebuild when one already has content
 * is a rebuild in disguise — the step before the delete in 8ab1ecbc.
 */
export function replacementScreenError(
  pageRoots: PenNode[],
  kind: "mobile" | "desktop",
  archetype: ChromeArchetype | undefined,
  newName?: string
): string | undefined {
  if (archetype !== "site") return undefined;
  const normalizedNew = newName?.trim().toLowerCase();

  const duplicate = pageRoots.find((node) => {
    if ((node as { metadata?: { screenKind?: string } }).metadata?.screenKind !== kind) return false;
    if (!hasAuthoredContent(node)) return false;
    const existingName = (node.name ?? "").trim().toLowerCase();
    if (!normalizedNew) return true;
    return normalizedNew === existingName || existingName === kind;
  });

  if (!duplicate) return undefined;
  const other = kind === "desktop" ? "mobile" : "desktop";
  const name = duplicate.name ? ` "${duplicate.name}"` : "";
  return `error: a ${kind} screen named${name} already exists (${duplicate.id}). To build a companion screen (e.g. "Pricing", "Checkout", or ${other}), give it a distinct name. To edit the existing screen, modify its slots or use replace_node.`;
}

export function screenSizeError(
  doc: Document,
  id: string,
  property: string,
  value: unknown
): string | undefined {
  if (property !== "width" && property !== "height") return undefined;
  const root = doc.children.find((node) => node.id === id);
  if (root?.type !== "frame") return undefined;
  const kind = root.metadata?.screenKind;
  if (kind !== "mobile" && kind !== "desktop") return undefined;
  const { width, height } = viewportFor(kind);
  if (property === "width") {
    if (value === width) return undefined;
    return `error: ${id} is a ${kind} screen. Width stays ${width}px. Grow height if the page scrolls.`;
  }
  if (value === "fit_content" || (typeof value === "number" && Number.isFinite(value) && value >= height && value <= MAX_SCREEN_HEIGHT)) {
    return undefined;
  }
  if (typeof value === "number" && value > MAX_SCREEN_HEIGHT) {
    return `error: ${id} height ${value}px is above ${MAX_SCREEN_HEIGHT}px. Shorten the page or split it across screens.`;
  }
  return `error: ${id} is a ${kind} screen. Height is at least ${height}px (the first viewport) or 'fit_content'. Pass ${height} or taller for a scrolling page.`;
}

export function digestId(doc: Document, id: unknown): string | undefined {
  if (typeof id !== "string") return undefined;
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  if (findNode(doc.children, trimmed)) return trimmed;
  if (WHOLE_DOC_ALIASES.has(trimmed)) return undefined;
  return trimmed;
}

export function formatLayout(node: LayoutNode, doc: Document, depth: number): string {
  const data = findNode(doc.children, node.id);
  const indent = "  ".repeat(depth);
  const name = data?.name ? ` ${data.name}` : "";
  const text =
    data?.type === "text" && typeof (data as any).content === "string"
      ? ` "${(data as any).content.slice(0, 40)}"`
      : "";
  const b = node.box;
  const box = `${round(b.x)},${round(b.y)} ${round(b.width)}x${round(b.height)}`;
  const line = `${indent}${node.id}${name}${text} — ${box}`;
  const children = node.children.map((c) => formatLayout(c, doc, depth + 1));
  return [line, ...children].join("\n");
}

export function round(n: number): number {
  return Math.round(n * 10) / 10;
}
