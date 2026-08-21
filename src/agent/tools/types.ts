import type { Document, PenNode } from "../../model/types";
import { setProperty } from "../../model/edit";
import { childrenOf, findNode } from "../../model/tree";
import { resolveInstances } from "../../model/instance";
import { layoutResolvedDocument, flattenLayoutTree } from "../../layout/layout";
import type { LayoutNode } from "../../layout/types";
import { getLucideIconPath } from "../../model/icons";
import { MOBILE_HEIGHT, MOBILE_WIDTH } from "../../design/scaffold";
import type { FetchFn, Tool } from "../provider";

export interface ToolContext {
  get doc(): Document;
  setDoc(next: Document): void;
  image: { providerId?: string; apiKey?: string; fetch?: FetchFn };
  recordWrite(id: string, property: string, value: unknown): string;
}

export interface DocumentToolDefinition {
  name: string;
  description: string;
  parameters: Tool["parameters"];
  execute: (ctx: ToolContext, args: any) => Promise<string> | string;
}

export const ALLOWED_PROPERTIES = new Set([
  "width", "height", "x", "y", "gap", "padding", "fill", "stroke", "strokeWidth",
  "name", "content", "fontSize", "fontWeight", "fontFamily", "letterSpacing",
  "lineHeight", "textAlign", "textGrowth", "layout", "justifyContent", "alignItems",
  "opacity", "rotation", "cornerRadius", "clip", "enabled", "layoutPosition",
  "effect", "icon", "strokeWidth", "textGrowth", "reusable", "ref"
]);

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
    const self = findNode(doc.children, id);
    const parts = [`measured: ${self?.name ? `"${self.name}"` : id} is now ${box(node)}px`];
    const parentId = parentOfNode(doc, id);
    const parent = parentId ? flat.get(parentId) : undefined;
    if (parent && parentId) {
      const parentNode = findNode(doc.children, parentId);
      parts.push(`inside ${parentNode?.name ? `"${parentNode.name}"` : parentId} at ${box(parent)}px`);
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

export function splitInstanceId(doc: Document, id: string): { refId: string; descendantId: string } | undefined {
  const at = id.indexOf(":");
  if (at <= 0) return undefined;
  const refId = id.slice(0, at);
  const descendantId = id.slice(at + 1);
  const host = findNode(doc.children, refId);
  if (!host || host.type !== "ref" || !descendantId) return undefined;

  const component = (host as PenNode & { ref?: string }).ref
    ? findNode(doc.children, (host as PenNode & { ref?: string }).ref!)
    : null;
  if (!component) return undefined;
  let known = false;
  (function walk(node: PenNode) {
    if (node.id === descendantId) known = true;
    for (const child of childrenOf(node)) walk(child);
  })(component);
  if (!known) return undefined;

  return { refId, descendantId };
}

export function setInstanceProperty(
  doc: Document,
  target: { refId: string; descendantId: string },
  property: string,
  value: unknown
): Document {
  const host = findNode(doc.children, target.refId) as (PenNode & { descendants?: Record<string, any> }) | null;
  if (!host) return doc;
  const descendants = {
    ...(host.descendants ?? {}),
    [target.descendantId]: { ...(host.descendants?.[target.descendantId] ?? {}), [property]: value }
  };
  return setProperty(doc, target.refId, "descendants", descendants);
}

export function resizesMobileScreen(doc: Document, id: string, property: string): boolean {
  if (property !== "width" && property !== "height") return false;
  const root = doc.children.find((node) => node.id === id);
  return root?.type === "frame" && root.metadata?.screenKind === "mobile";
}

export function mobileSizeError(id: string): string {
  return `error: ${id} is a fixed ${MOBILE_WIDTH}x${MOBILE_HEIGHT} mobile screen. Keep the root size; shorten or remove content, or reduce inner gaps and padding so it fits.`;
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
