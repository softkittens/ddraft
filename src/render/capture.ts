import { layoutResolvedDocument } from "../layout/layout";
import { indexDocument } from "../model/tree";
import { resolveInstances } from "../model/instance";
import { paintNode } from "./paint";
import { waitForPaintInputs } from "./paintInputs";
import type { Document as PenDocument, PenNode } from "../model/types";
import { pageScopedDocument } from "../model/pages";
import type { LayoutNode, Box } from "../layout/types";

export type CaptureFailure = "unavailable" | "no_target";

export interface ScreenCapture {
  id: string;
  name: string;
  dataUrl: string;
  box: Box;
  kind?: "screen" | "section" | "viewport";
  parentId?: string;
}

export type CaptureResult =
  | { ok: true; dataUrl: string; screens: ScreenCapture[] }
  | { ok: false; reason: CaptureFailure };

const FULL_SCREEN_SCALE = 0.5;
const MOBILE_FULL_SCREEN_SCALE = 1;
const SECTION_SLICE_SCALE = 0.5;
const JPEG_QUALITY = 0.85;
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
  kind?: "screen" | "section" | "viewport",
  parentId?: string
): ScreenCapture | null {
  const isMob = sliceBox.width <= 500;
  const baseScale = isMob
    ? MOBILE_FULL_SCREEN_SCALE
    : kind === "section"
    ? SECTION_SLICE_SCALE
    : FULL_SCREEN_SCALE;
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
  const minHeight = isMobile ? 120 : 160;
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
  const isScrollable = box.height > viewportHeight + 40;
  if (isScrollable) {
    const foldWorldBox = { x: 0, y: 0, width: box.width, height: viewportHeight };
    const foldCap = captureBoxSlice(
      root,
      foldWorldBox,
      map,
      variables,
      `${root.id}_first_viewport`,
      `${rootName} — [First Viewport / Above-the-Fold View]`,
      "viewport",
      root.id
    );
    if (foldCap) captures.push(foldCap);

    const endWorldBox = {
      x: 0,
      y: Math.max(0, box.height - viewportHeight),
      width: box.width,
      height: Math.min(viewportHeight, box.height)
    };
    const endCap = captureBoxSlice(
      root,
      endWorldBox,
      map,
      variables,
      `${root.id}_end_viewport`,
      `${rootName} — [Final Viewport / End-of-Scroll View]`,
      "viewport",
      root.id
    );
    if (endCap) captures.push(endCap);
  }

  // Scrollable mobile screens need section evidence even when they are shorter
  // than two complete viewports; that is where product rows and promos live.
  const threshold = isMobile ? viewportHeight + 40 : 1400;
  if (box.height > threshold) {
    const sections = findSectionSlices(root, isMobile);
    const substantive = sections.filter((s) => s.box.height >= (isMobile ? 120 : 160));
    const ordered = substantive.slice(0, 12);

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

/**
 * Every image the critic is shown.
 *
 * Scoped to one page, because the critic's job is to judge the screens the run
 * was working on. An overview spanning the whole canvas puts three pages of
 * unrelated screens in the same frame and invites a verdict on all of them —
 * and worse, it disagrees with the audit, which is scoped to the page. Two
 * reviewers with different ideas of what "the design" is cannot be reconciled
 * by anything downstream.
 */
export async function captureDocumentPng(doc: PenDocument, pageId?: string): Promise<CaptureResult> {
  if (typeof globalThis.document === "undefined" || typeof globalThis.document.createElement !== "function") {
    return { ok: false, reason: "unavailable" };
  }
  doc = pageScopedDocument(doc, pageId);
  const resolved = resolveInstances(doc);

  await waitForPaintInputs(resolved);

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
