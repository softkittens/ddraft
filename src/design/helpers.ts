import type { Box, LayoutNode } from "../layout/types";
import type { Document, PenNode } from "../model/types";
import { childrenOf, indexDocument } from "../model/tree";
import { resolveVariable } from "../model/variables";
import { flattenLayoutTree } from "../layout/layout";

export { childrenOf };

export type AuditRule =
  | "clipped"
  | "collision"
  | "text_too_small"
  | "low_contrast"
  | "tap_target"
  | "off_canvas"
  | "empty_container"
  | "collapsed_container"
  | "type_scale"
  | "spacing_scale"
  | "radius_scale"
  | "token_bypass"
  | "nested_screen"
  | "text_clipped"
  | "empty_text"
  | "duplicate_region"
  | "accent_overuse"
  | "missed_bleed"
  | "missing_display"
  | "empty_tail"
  | "shadow_quality"
  | "border_accent"
  | "tracking"
  | "prose_measure"
  | "stat_tile_row"
  | "cloned_content"
  | "icon_unresolved"
  | "single_elevation"
  | "scaffold_only"
  | "icon_alignment"
  | "eyebrow_kicker"
  | "heading_content_gap"
  | "invisible_node"
  | "undrawn_series"
  | "empty_column"
  | "undersized_subject"
  | "cropped_photography"
  | "oversized_section_height"
  | "misaligned_buttons"
  | "misaligned_inputs"
  | "uneven_card_heights"
  | "stray_character"
  | "overflow"
  | "missing_product_image"
  | "false_floor"
  | "inconsistent_card_actions"
  | "repeated_primary_action"
  | "supporting_image_wall"
  | "catalog_row";

export type AuditSeverity = "blocker" | "warning" | "info";

export interface AuditFinding {
  rule: AuditRule;
  severity: AuditSeverity;
  nodeId: string;
  message: string;
  fix: string;
}

export interface AuditContext {
  doc: Document;
  tree: LayoutNode[];
  nodes: Map<string, PenNode>;
  parents: Map<string, PenNode>;
  boxes: Map<string, LayoutNode>;
  absBoxes: Map<string, Box>;
}

export function computeAbsoluteBoxes(tree: LayoutNode[]): Map<string, Box> {
  const map = new Map<string, Box>();
  function walk(node: LayoutNode, parentX: number, parentY: number) {
    const absX = parentX + node.box.x;
    const absY = parentY + node.box.y;
    map.set(node.id, { x: absX, y: absY, width: node.box.width, height: node.box.height });
    for (const child of node.children) {
      walk(child, absX, absY);
    }
  }
  for (const root of tree) {
    walk(root, 0, 0);
  }
  return map;
}

export function computeParentMap(doc: Document): Map<string, PenNode> {
  const map = new Map<string, PenNode>();
  function walk(node: PenNode) {
    for (const child of childrenOf(node)) {
      map.set(child.id, node);
      walk(child);
    }
  }
  for (const root of doc.children) {
    walk(root);
  }
  return map;
}

export function createAuditContext(tree: LayoutNode[], doc: Document): AuditContext {
  return {
    doc,
    tree,
    nodes: indexDocument(doc),
    parents: computeParentMap(doc),
    boxes: flattenLayoutTree(tree),
    absBoxes: computeAbsoluteBoxes(tree)
  };
}

/* ------------------------------------------------------------------ *
 * Finding Factory Helpers
 * ------------------------------------------------------------------ */

export const blocker = (rule: AuditRule, nodeId: string, message: string, fix: string): AuditFinding => ({
  rule,
  severity: "blocker",
  nodeId,
  message,
  fix
});

export const warning = (rule: AuditRule, nodeId: string, message: string, fix: string): AuditFinding => ({
  rule,
  severity: "warning",
  nodeId,
  message,
  fix
});

export const info = (rule: AuditRule, nodeId: string, message: string, fix: string): AuditFinding => ({
  rule,
  severity: "info",
  nodeId,
  message,
  fix
});

/* ------------------------------------------------------------------ *
 * Geometry & Math Helpers
 * ------------------------------------------------------------------ */

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function boxContains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/* ------------------------------------------------------------------ *
 * Color, Luminance & Tokens Helpers
 * ------------------------------------------------------------------ */

export const BACKGROUND_TYPES = new Set(["frame", "group", "rectangle", "ellipse", "polygon"]);
export const LITERAL_COLOR = /^#[0-9a-fA-F]{3,8}$/;
export const UNIVERSAL_LITERALS = /^#(fff(f{0,5})?|ffffff[0-9a-f]{2}|000(0{0,5})?|000000[0-9a-f]{2})$/i;
export const SCREEN_CHROME_NAME = /(status|top|tab|bottom|nav) ?bar|navigation/i;
export const INTERACTIVE_NAME = /(button|btn|tab|action|toggle|fab|chip|control|cta)/i;
export const ACCENT_TOKEN = /\$accent-(primary|secondary)\b/;
export const REGION_ROLES: { role: string; pattern: RegExp }[] = [
  { role: "status bar", pattern: /status ?bar/i },
  { role: "tab bar", pattern: /tab ?bar|bottom ?nav|navigation/i }
];

export function parseHexColor(colorStr: string | undefined): { r: number; g: number; b: number } | null {
  if (!colorStr) return null;
  const str = colorStr.trim();
  if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16)
      };
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16)
      };
    }
    return null;
  }
  const rgbMatch = str.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return {
      r: Math.min(255, parseInt(rgbMatch[1], 10)),
      g: Math.min(255, parseInt(rgbMatch[2], 10)),
      b: Math.min(255, parseInt(rgbMatch[3], 10))
    };
  }
  return null;
}

export function getRelativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(
  fg: string | undefined,
  bg: string | undefined,
  variables?: Record<string, any>
): number | null {
  const fgHex = parseHexColor(resolveVariable(fg, variables));
  const bgHex = parseHexColor(resolveVariable(bg, variables));
  if (!fgHex || !bgHex) return null;
  const l1 = getRelativeLuminance(fgHex);
  const l2 = getRelativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function solidFillOf(node: PenNode | undefined): string | undefined {
  if (!node || !BACKGROUND_TYPES.has(node.type)) return undefined;
  const fill = (node as any).fill;
  if (typeof fill === "string") return fill;
  if (Array.isArray(fill)) {
    const solid = fill.find((f: any) => f?.type === "color" && typeof f.color === "string");
    return solid?.color;
  }
  if (fill && typeof fill === "object" && fill.type === "color" && typeof fill.color === "string") {
    return fill.color;
  }
  return undefined;
}

export function hasImageFill(node: PenNode | undefined): boolean {
  if (!node) return false;
  const fill = (node as any).fill;
  if (Array.isArray(fill)) return fill.some((f: any) => f?.type === "image");
  return !!fill && typeof fill === "object" && (fill as any).type === "image";
}

export function overUnmeasurableBackground(node: PenNode | undefined): boolean {
  if (!node) return false;
  const fill = (node as any).fill;
  if (Array.isArray(fill)) return fill.some((f: any) => f?.type === "image" || f?.type === "gradient");
  return !!fill && typeof fill === "object" && ((fill as any).type === "image" || (fill as any).type === "gradient");
}

export function extractHexColors(fillOrStroke: unknown): string[] {
  if (!fillOrStroke) return [];
  if (typeof fillOrStroke === "string") {
    return LITERAL_COLOR.test(fillOrStroke) ? [fillOrStroke] : [];
  }
  if (Array.isArray(fillOrStroke)) {
    return fillOrStroke.flatMap(extractHexColors);
  }
  if (typeof fillOrStroke === "object" && fillOrStroke !== null) {
    const obj = fillOrStroke as Record<string, any>;
    if (obj.type === "color" && typeof obj.color === "string" && LITERAL_COLOR.test(obj.color)) {
      return [obj.color];
    }
    if (obj.type === "gradient" && Array.isArray(obj.stops)) {
      const stops: string[] = [];
      for (const stop of obj.stops) {
        if (typeof stop?.color === "string" && LITERAL_COLOR.test(stop.color)) {
          stops.push(stop.color);
        }
      }
      return stops;
    }
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * Tree Traversal & Inspection Helpers
 * ------------------------------------------------------------------ */

export function walkEnabled(nodes: PenNode[], fn: (n: PenNode) => void): void {
  for (const n of nodes) {
    if (n.enabled === false) continue;
    fn(n);
    walkEnabled(childrenOf(n), fn);
  }
}

export function hasTextContent(node: PenNode): boolean {
  if (node.type === "text") return true;
  for (const c of childrenOf(node)) {
    if (hasTextContent(c)) return true;
  }
  return false;
}

const SCAFFOLD_SLOT_NAME =
  /^(inset content|bleed content|content|body|top ?bar|(left |right )?rail|aside|main|safe area)$/i;

/**
 * True once a screen holds something the model authored — copy, a photo, a
 * control — rather than the empty chrome create_screen stamped.
 *
 * 8ab1ecbc: Muse Spark built a finished Casa Pátio, opened a blank second
 * desktop, deleted the first, then failed to rebuild. The only way to tell
 * "this screen is the design" from "this screen is still an empty shell" is
 * this walk, the same one the scaffold_only audit uses.
 */
export function hasAuthoredContent(node: PenNode): boolean {
  if (node.enabled === false) return false;
  const tagged = (node as { metadata?: { scaffold?: string } }).metadata?.scaffold;
  if (tagged === "chrome" || SCREEN_CHROME_NAME.test(node.name ?? "")) return false;

  const isSlot = tagged === "slot" || SCAFFOLD_SLOT_NAME.test(node.name ?? "");
  if (!isSlot) {
    if (node.type === "text") {
      if (typeof (node as { content?: string }).content === "string" && (node as { content?: string }).content!.trim()) {
        return true;
      }
    } else if (node.type !== "frame" && node.type !== "group") {
      return true;
    } else if (hasImageFill(node)) {
      return true;
    }
  }

  for (const child of childrenOf(node)) {
    if (hasAuthoredContent(child)) return true;
  }
  return false;
}

export function countAuthoredElements(node: PenNode): number {
  if (node.enabled === false) return 0;
  const tagged = (node as { metadata?: { scaffold?: string } }).metadata?.scaffold;
  if (tagged === "chrome" || SCREEN_CHROME_NAME.test(node.name ?? "")) return 0;

  let count = 0;
  const isSlot = tagged === "slot" || SCAFFOLD_SLOT_NAME.test(node.name ?? "");
  if (!isSlot) {
    if (node.type === "text") {
      if (typeof (node as { content?: string }).content === "string" && (node as { content?: string }).content!.trim()) {
        count += 1;
      }
    } else if (node.type !== "frame" && node.type !== "group") {
      count += 1;
    } else if (hasImageFill(node)) {
      count += 1;
    }
  }

  for (const child of childrenOf(node)) {
    count += countAuthoredElements(child);
  }
  return count;
}

export function hasSubstantiveContent(node: PenNode, minThreshold = 3): boolean {
  return countAuthoredElements(node) >= minThreshold;
}

export function isDescendant(node: PenNode, ancestor: PenNode): boolean {
  for (const child of childrenOf(ancestor)) {
    if (child === node || isDescendant(node, child)) return true;
  }
  return false;
}

/**
 * A top-level frame that is a screen rather than a piece of one.
 *
 * The tag create_screen stamps comes first, and the name test is the fallback
 * for a hand-built frame. Reading names alone made every screen-level rule —
 * accent overuse, nested screens, duplicate regions, the finishing checks —
 * conditional on the model not renaming the status bar, because a screen was
 * only a screen if it still had a child with "bar" in its name. Rename that one
 * frame and the whole screen stopped being audited, which is the opposite of
 * what should happen when a model starts moving the chrome around.
 */
export function isScreen(node: PenNode): boolean {
  if (node.type !== "frame") return false;
  // Tagged part of a screen: chrome or a slot is never a screen itself, and
  // saying so first stops the tab bar counting as one because the tab inside
  // it is tagged too.
  const scaffold = (node as any).metadata?.scaffold;
  if (scaffold === "chrome" || scaffold === "slot") return false;
  if ((node as any).metadata?.screenKind) return true;
  if (SCREEN_CHROME_NAME.test(node.name ?? "")) return false;
  // A frame is a full device screen if it contains its own system Status Bar
  return childrenOf(node).some(
    (c) => (c as any).metadata?.scaffold === "status_bar" || /status ?bar/i.test(c.name ?? "")
  );
}

export function collectSubtreeIds(doc: Document, rootId: string): Set<string> | undefined {
  const ids = new Set<string>();
  let found = false;

  function collect(node: PenNode) {
    ids.add(node.id);
    for (const child of childrenOf(node)) collect(child);
  }
  function search(nodes: PenNode[]) {
    for (const node of nodes) {
      if (node.id === rootId) {
        found = true;
        collect(node);
        return;
      }
      search(childrenOf(node));
      if (found) return;
    }
  }

  search(doc.children);
  return found ? ids : undefined;
}
