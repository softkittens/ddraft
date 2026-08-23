import type { PenNode, TextNode } from "./types";
import { parseSizing } from "./parse";

/**
 * Fixed, hug, or fill — the three answers a design tool gives for a size, and
 * which of them a given node is actually allowed to give.
 *
 * The last part is the reason this module exists rather than three buttons
 * wired straight to `width`. Two of the three modes silently collapse a node to
 * zero in the wrong place, and the engine reports nothing when they do:
 *
 *   fit_content on a rectangle           0 wide — a leaf has no content to hug
 *   fill_container with no flow parent   0 wide — nothing is distributing space
 *
 * Both were measured against `layoutDocument`, not reasoned about, and both are
 * covered by tests that run the real layout pass. A control that offered every
 * mode everywhere would be handing people two ways to make their work vanish.
 */

export type SizeMode = "fixed" | "hug" | "fill";
export type SizeAxis = "width" | "height";

/** Node types with children to hug. Everything else measures zero under fit_content. */
const HUGS_CONTENT = new Set(["frame", "group", "text"]);

export interface SizeWrite {
  property: string;
  value: unknown;
}

/**
 * Whether this node can fill its parent.
 *
 * `distributeFlowMainSizes` shares out space among a frame's flow children, so
 * a node needs to be one: a `layout: "none"` parent places children by their own
 * coordinates and never distributes, an absolutely positioned child opts out of
 * the same pass, and a node at the document root has no parent to fill at all.
 * Each of those measured 0 wide.
 */
export function canFill(node: PenNode, parent: PenNode | null): boolean {
  if (!parent || parent.type !== "frame") return false;
  if ((parent as any).layout === "none") return false;
  return (node as any).layoutPosition !== "absolute";
}

/** Whether this node can hug: it needs content of its own to measure. */
export function canHug(node: PenNode, axis: SizeAxis): boolean {
  // Text height is derived from the wrapped lines and cannot be anything else,
  // so hug is the only honest answer for it. See sizeModes.
  if (node.type === "text" && axis === "height") return true;
  return HUGS_CONTENT.has(node.type);
}

/**
 * The modes worth offering for this node on this axis.
 *
 * Returning fewer than two means there is no choice to present — text height is
 * the case that matters, because `measureTextNode` never reads `node.height`.
 * It returns `lineHeight` for a single line and `lines.length * lineHeight`
 * when wrapping, so a height written on a text node is inert whatever it says.
 * A "Fixed" button there would move a number into the file and nothing on the
 * canvas.
 */
export function sizeModes(node: PenNode, parent: PenNode | null, axis: SizeAxis): SizeMode[] {
  if (node.type === "text" && axis === "height") return ["hug"];
  const modes: SizeMode[] = ["fixed"];
  if (canHug(node, axis)) modes.push("hug");
  if (canFill(node, parent)) modes.push("fill");
  return modes;
}

/**
 * The mode a node is in now.
 *
 * Text is read from `textGrowth` rather than from `width`, because a numeric
 * width on a text node does nothing on its own: `measureTextNode` returns the
 * natural width whenever growth is "auto", whatever `width` holds. A control
 * reading the number would show Fixed for a node the engine is hugging.
 * `fill_container` is checked first because it takes effect either way.
 */
export function readSizeMode(node: PenNode, axis: SizeAxis): SizeMode {
  const raw = (node as any)[axis] as number | string | undefined;
  const parsed = parseSizing(raw);

  if (node.type === "text") {
    if (axis === "height") return "hug";
    if (parsed.mode === "fill_container") return "fill";
    const growth = (node as TextNode).textGrowth;
    return growth === "fixed-width" || growth === "fixed-width-height" ? "fixed" : "hug";
  }

  if (parsed.mode === "fill_container") return "fill";
  return parsed.mode === "fixed" ? "fixed" : "hug";
}

/**
 * The writes that put a node into a mode.
 *
 * A list rather than one property because text needs two: the size keyword and
 * the growth that decides whether the engine looks at it. Setting a width on a
 * text node without setting `textGrowth` is the silent no-op this codebase has
 * hit repeatedly, so the pairing lives here where it can be tested rather than
 * in a click handler.
 *
 * `measured` is the node's current laid-out size, which is what Fixed should
 * freeze — switching to Fixed should not move anything.
 */
export function sizeWrites(
  node: PenNode,
  axis: SizeAxis,
  mode: SizeMode,
  measured: number
): SizeWrite[] {
  const value = Math.max(1, Math.round(measured));

  if (node.type === "text") {
    // Inert, and saying so is better than writing a number that does nothing.
    if (axis === "height") return [];
    const growth = (node as TextNode).textGrowth;
    switch (mode) {
      case "fixed":
        // fixed-width-height is kept when it is already there: height is inert
        // either way, and rewriting it would be a change with no effect.
        return [
          { property: "width", value },
          { property: "textGrowth", value: growth === "fixed-width-height" ? growth : "fixed-width" }
        ];
      case "hug":
        // "auto" rather than deleting the key: it parses to mode auto, and it
        // leaves no stale number to come back to life if growth changes later.
        return [
          { property: "width", value: "auto" },
          { property: "textGrowth", value: "auto" }
        ];
      case "fill":
        // Without fixed-width the box fills but the glyphs keep their natural
        // width and overflow it — measured at 160 wide with a 337-wide line.
        return [
          { property: "width", value: "fill_container" },
          { property: "textGrowth", value: "fixed-width" }
        ];
    }
  }

  switch (mode) {
    case "fixed":
      return [{ property: axis, value }];
    case "hug":
      return [{ property: axis, value: "fit_content" }];
    case "fill":
      return [{ property: axis, value: "fill_container" }];
  }
}

/** Human label for a mode. */
export const MODE_LABELS: Record<SizeMode, string> = {
  fixed: "Fixed",
  hug: "Hug",
  fill: "Fill"
};

/**
 * The minimum a `fit_content(n)` or `fill_container(n)` carries, if any.
 *
 * Worth showing rather than dropping: `scaffold.ts` writes `fit_content(844)`
 * for page heights, where the number is a viewport floor that would be
 * invisible otherwise.
 */
export function sizeFallback(node: PenNode, axis: SizeAxis): number | undefined {
  const parsed = parseSizing((node as any)[axis]);
  return parsed.mode === "fit_content" || parsed.mode === "fill_container"
    ? parsed.fallback
    : undefined;
}
