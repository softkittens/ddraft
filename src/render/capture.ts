import { layoutResolvedDocument } from "../layout/layout";
import { indexDocument, walkNodes } from "../model/tree";
import { resolveInstances } from "../model/instance";
import { paintNode, preloadCachedImage } from "./paint";
import type { Document as PenDocument, Fill, ImageFill, PenNode } from "../model/types";
import type { LayoutNode, Box } from "../layout/types";

export type CaptureFailure = "unavailable" | "no_target";

export interface ScreenCapture {
  id: string;
  name: string;
  dataUrl: string;
  box: Box;
  kind?: "screen" | "section";
  parentId?: string;
}

export type CaptureResult =
  | { ok: true; dataUrl: string; screens: ScreenCapture[] }
  | { ok: false; reason: CaptureFailure };

const FULL_SCREEN_SCALE = 0.5;
const SECTION_SLICE_SCALE = 0.75;
const JPEG_QUALITY = 0.85;
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

function captureScale(box: Box, baseScale: number = FULL_SCREEN_SCALE): number {
  const area = box.width * box.height * baseScale * baseScale;
  if (area <= MAX_CAPTURE_AREA) return baseScale;
  return baseScale * Math.sqrt(MAX_CAPTURE_AREA / area);
}

function nodeWorldBox(root: LayoutNode, targetId: string): Box | null {
  function find(node: LayoutNode, curX: number, curY: number): Box | null {
    const nextX = curX + (node === root ? 0 : node.box.x);
    const nextY = curY + (node === root ? 0 : node.box.y);
    if (node.id === targetId) {
      return { x: nextX, y: nextY, width: node.box.width, height: node.box.height };
    }
    for (const child of node.children) {
      const res = find(child, nextX, nextY);
      if (res) return res;
    }
    return null;
  }
  return find(root, 0, 0);
}

function captureBoxSlice(
  root: LayoutNode,
  sliceBox: Box,
  map: Map<string, PenNode>,
  variables?: Record<string, any>,
  labelId?: string,
  labelName?: string,
  kind?: "screen" | "section",
  parentId?: string
): ScreenCapture | null {
  if (sliceBox.width <= 0 || sliceBox.height <= 0) return null;
  const baseScale = kind === "section" ? SECTION_SLICE_SCALE : FULL_SCREEN_SCALE;
  const scale = captureScale(sliceBox, baseScale);
  const canvas = globalThis.document.createElement("canvas");
  const width = Math.max(1, Math.round(sliceBox.width * scale));
  const height = Math.max(1, Math.round(sliceBox.height * scale));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Solid background base for clean JPEG compression
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.scale(scale, scale);
  ctx.translate(-sliceBox.x, -sliceBox.y);
  ctx.beginPath();
  ctx.rect(sliceBox.x, sliceBox.y, sliceBox.width, sliceBox.height);
  ctx.clip();
  paintNode(ctx, root, map, variables, { animate: false });

  try {
    return {
      id: labelId || root.id,
      name: labelName || root.id,
      dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      box: sliceBox,
      kind: kind || "screen",
      parentId
    };
  } catch {
    return null;
  }
}

function findSectionSlices(root: LayoutNode, isMobile: boolean): LayoutNode[] {
  const sections: LayoutNode[] = [];
  const minHeight = isMobile ? 260 : 160;
  const maxHeight = isMobile ? 844 : 1000;
  
  function walk(node: LayoutNode, depth: number) {
    if (depth > 0) {
      if (node.box.width >= root.box.width * 0.7 && node.box.height >= minHeight && node.box.height <= maxHeight) {
        sections.push(node);
        return;
      }
    }
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  }

  walk(root, 0);
  return sections;
}

function captureSingleRoot(
  root: LayoutNode,
  map: Map<string, PenNode>,
  variables?: Record<string, any>
): ScreenCapture[] {
  const box = root.box;
  if (box.width <= 0 || box.height <= 0) return [];
  const rootNode = map.get(root.id);
  const rootName = rootNode?.name || root.id;
  const isMobile = box.width <= 500 || (rootNode as any)?.metadata?.screenKind === "mobile";
  const viewportHeight = isMobile ? 844 : 900;

  const captures: ScreenCapture[] = [];
  const rootWorldBox = { x: 0, y: 0, width: box.width, height: box.height };
  const fullCap = captureBoxSlice(root, rootWorldBox, map, variables, root.id, rootName, "screen");
  if (fullCap) captures.push(fullCap);

  // If the screen is scrollable (exceeds the native device viewport), capture the 1:1 First Viewport (Fold) Slice
  if (box.height > viewportHeight + 40) {
    const foldWorldBox = { x: 0, y: 0, width: box.width, height: viewportHeight };
    const foldCap = captureBoxSlice(
      root,
      foldWorldBox,
      map,
      variables,
      `${root.id}_first_viewport`,
      `${rootName} — [First Viewport / Above-the-Fold View]`,
      "section",
      root.id
    );
    if (foldCap) captures.push(foldCap);
  }

  // If the screen is tall (> 1600 on mobile [~2 viewports], > 1400 on desktop), capture key structural landmark sections
  const threshold = isMobile ? 1600 : 1400;
  if (box.height > threshold) {
    const sections = findSectionSlices(root, isMobile);
    const substantive = sections.filter((s) => s.box.height >= (isMobile ? 260 : 160));
    let chosen: LayoutNode[] = [];
    if (substantive.length <= 4) {
      chosen = substantive;
    } else {
      // 1. Always include top section (Hero)
      chosen.push(substantive[0]);

      // 2. Look for explicit pricing/membership or product grid section
      const keySection = substantive.find((s) => {
        const name = map.get(s.id)?.name ?? "";
        return /price|pricing|rate|rates|membership|tier|plan|product|collection|slice|catalog/i.test(name);
      });

      // 3. Middle sections (Spaces, Inclusions, Features)
      const middle = substantive.filter((s) => s !== substantive[0] && s !== keySection);
      if (middle.length > 0) chosen.push(middle[0]);
      if (middle.length > 1) chosen.push(middle[Math.floor(middle.length / 2)]);

      if (keySection && !chosen.includes(keySection)) {
        chosen.push(keySection);
      } else if (substantive.length > chosen.length) {
        chosen.push(substantive[substantive.length - 1]);
      }
    }
    // Sort in document order and deduplicate
    const chosenSet = new Set(chosen);
    const ordered = substantive.filter((s) => chosenSet.has(s)).slice(0, 4);

    for (const sec of ordered) {
      const secNode = map.get(sec.id);
      const secName = secNode?.name ? `${rootName} — ${secNode.name}` : `${rootName} — Section #${sec.id}`;
      const secWorld = nodeWorldBox(root, sec.id) || { x: sec.box.x, y: sec.box.y, width: sec.box.width, height: sec.box.height };
      const secCap = captureBoxSlice(root, secWorld, map, variables, sec.id, secName, "section", root.id);
      if (secCap) captures.push(secCap);
    }
  }

  return captures;
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

  const map = indexDocument(resolved);
  const screens: ScreenCapture[] = [];
  for (const root of tree) {
    const screenCaps = captureSingleRoot(root, map, resolved.variables);
    screens.push(...screenCaps);
  }

  const scale = captureScale(box, FULL_SCREEN_SCALE);
  const canvas = globalThis.document.createElement("canvas");
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "unavailable" };

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  ctx.scale(scale, scale);
  ctx.translate(-box.x, -box.y);
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.width, box.height);
  ctx.clip();
  for (const root of tree) {
    paintNode(ctx, root, map, resolved.variables, { animate: false });
  }

  try {
    return { ok: true, dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY), screens };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
