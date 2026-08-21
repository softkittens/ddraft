import { layoutResolvedDocument } from "../layout/layout";
import { indexDocument, walkNodes } from "../model/tree";
import { resolveInstances } from "../model/instance";
import { paintNode, preloadCachedImage } from "./paint";
import type { Document as PenDocument, Fill, ImageFill } from "../model/types";
import type { LayoutNode, Box } from "../layout/types";

export type CaptureFailure = "unavailable" | "no_target";

export type CaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: CaptureFailure };

const SCALE = 1.5;
const IMAGE_WAIT_MS = 1500;
const FONT_WAIT_MS = 300;
const MAX_CAPTURE_AREA = 1920 * 1080;

function documentBox(tree: LayoutNode[]): Box | null {
  if (tree.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const root of tree) {
    minX = Math.min(minX, root.box.x);
    minY = Math.min(minY, root.box.y);
    maxX = Math.max(maxX, root.box.x + root.box.width);
    maxY = Math.max(maxY, root.box.y + root.box.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
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

function imageUrls(doc: PenDocument): string[] {
  const urls: string[] = [];
  walkNodes(doc.children, (n) => {
    const url = imageUrlOf(n.fill);
    if (url) urls.push(url);
  });
  return urls;
}

function captureScale(box: Box): number {
  const area = box.width * box.height * SCALE * SCALE;
  if (area <= MAX_CAPTURE_AREA) return SCALE;
  return SCALE * Math.sqrt(MAX_CAPTURE_AREA / area);
}

export async function captureDocumentPng(doc: PenDocument): Promise<CaptureResult> {
  if (typeof globalThis.document === "undefined" || typeof globalThis.document.createElement !== "function") {
    return { ok: false, reason: "unavailable" };
  }

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

  const resolved = resolveInstances(doc);
  const tree = layoutResolvedDocument(resolved);
  const box = documentBox(tree);
  if (!box) return { ok: false, reason: "no_target" };

  const scale = captureScale(box);
  const canvas = globalThis.document.createElement("canvas");
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "unavailable" };

  ctx.scale(scale, scale);
  ctx.translate(-box.x, -box.y);
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  const map = indexDocument(resolved);
  for (const root of tree) {
    paintNode(ctx, root, map, resolved.variables, { animate: false });
  }

  try {
    return { ok: true, dataUrl: canvas.toDataURL("image/png") };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
