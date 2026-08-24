import { layoutResolvedDocument, findLayoutNode } from "../layout/layout";
import { indexDocument, findParent, walkNodes } from "../model/tree";
import { resolveInstances } from "../model/instance";
import { paintNode, preloadCachedImage } from "./paint";
import type { Document, Fill, ImageFill, PenNode } from "../model/types";

/**
 * Raster export of a selected frame, Figma-style: 1× / 2× / 3× the node's
 * layout box, PNG with a transparent backdrop, JPG composited on white.
 *
 * Separate from `capture.ts`, which downscales and always JPEGs for the
 * critic. A person saving a screen wants the pixels they designed, not a
 * thumbnail.
 */

export type ExportFormat = "png" | "jpg";
export type ExportScale = 1 | 2 | 3;
export type ExportFailure = "unavailable" | "no_target";

export const EXPORT_SCALES: readonly ExportScale[] = [1, 2, 3];

export type ExportResult =
  | {
      ok: true;
      dataUrl: string;
      filename: string;
      mime: "image/png" | "image/jpeg";
      width: number;
      height: number;
    }
  | { ok: false; reason: ExportFailure };

const JPEG_QUALITY = 0.92;
const IMAGE_WAIT_MS = 1500;
const FONT_WAIT_MS = 300;

function mimeFor(format: ExportFormat): "image/png" | "image/jpeg" {
  switch (format) {
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    default: {
      const _never: never = format;
      return _never;
    }
  }
}

function extensionFor(format: ExportFormat): "png" | "jpg" {
  switch (format) {
    case "png":
      return "png";
    case "jpg":
      return "jpg";
    default: {
      const _never: never = format;
      return _never;
    }
  }
}

function scaleSuffix(scale: ExportScale): string {
  switch (scale) {
    case 1:
      return "";
    case 2:
      return "@2x";
    case 3:
      return "@3x";
    default: {
      const _never: never = scale;
      return _never;
    }
  }
}

/**
 * The frame Share will write out.
 *
 * A selected frame is itself; a selected child walks to the nearest enclosing
 * frame, so exporting from inside a card still captures the card. Groups are
 * skipped — they have no frame of their own. A node with no enclosing frame
 * (a lone rectangle on the page) is exported as itself so the menu still
 * does something.
 */
export function resolveExportTarget(doc: Document, selectedIds: Iterable<string>): PenNode | null {
  const ids = [...selectedIds];
  if (ids.length === 0) return null;

  const map = indexDocument(doc);
  for (const id of ids) {
    const node = map.get(id);
    if (node?.type === "frame") return node;
  }

  const start = map.get(ids[0]);
  if (!start) return null;

  let parent = findParent(doc.children, start.id);
  while (parent) {
    if (parent.type === "frame") return parent;
    parent = findParent(doc.children, parent.id);
  }
  return start;
}

export function exportFilename(
  name: string | undefined,
  format: ExportFormat,
  scale: ExportScale = 1
): string {
  const trimmed = name?.trim() ?? "";
  const safe = (trimmed || "Frame")
    .replace(/[/\\]+/g, " - ")
    .replace(/[?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${safe || "Frame"}${scaleSuffix(scale)}.${extensionFor(format)}`;
}

function imageUrlOf(fill: Fill | Fill[] | undefined): string | undefined {
  const fills = Array.isArray(fill) ? fill : fill ? [fill] : [];
  for (const f of fills) {
    if (f && typeof f === "object" && f.type === "image") {
      const image = f as ImageFill;
      return image.url || image.data;
    }
  }
}

function imageUrls(doc: Document): string[] {
  const urls: string[] = [];
  walkNodes(doc.children, (n) => {
    const url = imageUrlOf(n.fill);
    if (url) urls.push(url);
  });
  return urls;
}

async function waitForPaintInputs(doc: Document): Promise<void> {
  const fonts = (globalThis.document as { fonts?: { ready?: Promise<unknown> } }).fonts;
  if (fonts?.ready) {
    try {
      await Promise.race([
        fonts.ready,
        new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS))
      ]);
    } catch {
      // paint with fallback metrics
    }
  }
  await Promise.all(imageUrls(doc).map((url) => preloadCachedImage(url, IMAGE_WAIT_MS)));
}

export async function exportSelectedFrame(
  doc: Document,
  selectedIds: Iterable<string>,
  format: ExportFormat,
  scale: ExportScale = 1
): Promise<ExportResult> {
  if (typeof globalThis.document === "undefined" || typeof globalThis.document.createElement !== "function") {
    return { ok: false, reason: "unavailable" };
  }

  const target = resolveExportTarget(doc, selectedIds);
  if (!target) return { ok: false, reason: "no_target" };

  await waitForPaintInputs(doc);

  const resolved = resolveInstances(doc);
  const tree = layoutResolvedDocument(resolved);
  const layoutNode = findLayoutNode(tree, target.id);
  if (!layoutNode || layoutNode.box.width <= 0 || layoutNode.box.height <= 0) {
    return { ok: false, reason: "no_target" };
  }

  const width = Math.max(1, Math.round(layoutNode.box.width * scale));
  const height = Math.max(1, Math.round(layoutNode.box.height * scale));
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "unavailable" };

  if (format === "jpg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }

  ctx.scale(scale, scale);
  const exportRoot = { ...layoutNode, box: { ...layoutNode.box, x: 0, y: 0 } };
  paintNode(ctx, exportRoot, indexDocument(resolved), resolved.variables, { animate: false });

  const mime = mimeFor(format);
  try {
    const dataUrl = format === "jpg" ? canvas.toDataURL(mime, JPEG_QUALITY) : canvas.toDataURL(mime);
    return {
      ok: true,
      dataUrl,
      filename: exportFilename(target.name, format, scale),
      mime,
      width,
      height
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
