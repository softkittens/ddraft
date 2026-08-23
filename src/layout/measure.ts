import type { PenNode, FrameNode, TextNode, GroupNode, ParsedSizing } from "../model/types";
import { parseSizing } from "../model/parse";
import { normalisePadding } from "./padding";
import { measureTextNode } from "./text";

export interface MeasuredNode {
  node: PenNode;
  measuredWidth: number;
  measuredHeight: number;
  isCircularMain?: boolean;
  children: MeasuredNode[];
}

function contentExtent(children: MeasuredNode[]): { w: number; h: number } {
  if (children.length === 0) return { w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of children) {
    const cx = c.node.x ?? 0;
    const cy = c.node.y ?? 0;
    minX = Math.min(minX, cx);
    minY = Math.min(minY, cy);
    maxX = Math.max(maxX, cx + c.measuredWidth);
    maxY = Math.max(maxY, cy + c.measuredHeight);
  }
  return {
    w: maxX === -Infinity ? 0 : maxX - minX,
    h: maxY === -Infinity ? 0 : maxY - minY
  };
}

function sizingValue(s: ParsedSizing, auto: number): number {
  switch (s.mode) {
    case "fixed":
      return s.value;
    case "auto":
      return auto;
    case "fit_content":
    case "fill_container":
      return s.fallback ?? auto;
    default: {
      const _: never = s;
      return _;
    }
  }
}

function flowSizing(s: ParsedSizing): ParsedSizing {
  return s.mode === "auto" ? { mode: "fit_content" } : s;
}

/**
 * Measure Stage (Bottom-Up: Child -> Parent)
 * Calculates the intrinsic size of each node.
 */
/**
 * Inner width a frame can offer its children, or undefined when it is not yet
 * knowable. A fixed frame knows immediately; one that fills its parent knows as
 * soon as the parent does; one that fits its content does not know at all,
 * because its width is what its children are about to decide.
 */
function innerWidthOf(node: PenNode, available: number | undefined): number | undefined {
  const sizing = parseSizing(node.width);
  const pad = normalisePadding((node as FrameNode).padding);
  let outer: number | undefined;
  if (sizing.mode === "fixed") outer = sizing.value;
  else if (sizing.mode === "fill_container" && available !== undefined) outer = available;
  if (outer === undefined) return undefined;
  return Math.max(0, outer - pad.left - pad.right);
}

/**
 * @param availableWidth Width the parent can give this node, when it knows it.
 *
 * Widths resolve downward and heights upward. Without the first half, a text
 * node set to fill its container measured as one long line during this pass —
 * there was no width to wrap against — and reported the height of a single
 * line. The parent sized itself to that, the arrange pass then wrapped the text
 * to three lines, and the last two fell outside a box that had already been
 * decided. That is the most common blocker the auditor reports.
 */
export function measureNode(
  node: PenNode,
  variables?: Record<string, any>,
  availableWidth?: number
): MeasuredNode {
  const inner = innerWidthOf(node, availableWidth);
  // Only a vertical frame hands its full inner width to every child. In a row
  // the children divide it and that split is not known until arrange, and in a
  // group they are placed absolutely and take nothing from the parent.
  const isVertical = node.type === "frame" && ((node as FrameNode).layout || "horizontal") === "vertical";
  const childWidth = isVertical ? inner : undefined;

  const children = ((node as FrameNode | GroupNode).children || []).map((c) =>
    measureNode(c, variables, childWidth)
  );

  if (node.type === "text") {
    const spans = parseSizing(node.width).mode === "fill_container";
    const metrics = measureTextNode(
      node as TextNode,
      spans && availableWidth !== undefined ? availableWidth : undefined,
      variables
    );
    return { node, measuredWidth: metrics.width, measuredHeight: metrics.height, children };
  }

  if (node.type === "group") {
    const extent = contentExtent(children);
    return {
      node,
      measuredWidth: sizingValue(parseSizing(node.width), extent.w),
      measuredHeight: sizingValue(parseSizing(node.height), extent.h),
      children
    };
  }

  if (node.type !== "frame") {
    return {
      node,
      measuredWidth: sizingValue(parseSizing(node.width), 0),
      measuredHeight: sizingValue(parseSizing(node.height), 0),
      children
    };
  }

  const frame = node as FrameNode;
  const layoutMode = frame.layout || "horizontal";
  const pad = normalisePadding(frame.padding);
  const gap = frame.gap || 0;

  const wSizing = parseSizing(frame.width);
  const hSizing = parseSizing(frame.height);

  /**
   * A frame with layout: "none" places its children by their own x/y, so there
   * is no flow to add up. An unauthored size stays 0 — nothing asked for one.
   *
   * `fit_content` did too, and that is what this now fixes. It is not an
   * omission: the author asked the frame to be as big as what it holds, which
   * for absolute children is their extent, exactly as a group resolves it.
   * Answering 0 collapsed the frame to nothing, and because checkOverflow skips
   * a parent measuring 0 it did so without a single finding — one run spent its
   * last eight rounds moving a hero image in and out of a box that could never
   * have shown it.
   */
  if (layoutMode === "none") {
    const extent = contentExtent(children);
    const hug = (s: ParsedSizing, span: number) =>
      s.mode === "fit_content" ? s.fallback ?? span : sizingValue(s, 0);
    return {
      node,
      measuredWidth: hug(wSizing, extent.w),
      measuredHeight: hug(hSizing, extent.h),
      children
    };
  }

  const isHoriz = layoutMode === "horizontal";
  const flowChildren = children.filter((c) => c.node.layoutPosition !== "absolute");
  const flowCount = flowChildren.length;

  const mainSizing = flowSizing(isHoriz ? wSizing : hSizing);
  const crossSizing = flowSizing(isHoriz ? hSizing : wSizing);

  const allMainFill = flowCount > 0 && flowChildren.every((c) => {
    const s = parseSizing(isHoriz ? c.node.width : c.node.height);
    return s.mode === "fill_container";
  });

  const isCircularMain = mainSizing.mode === "fit_content" && allMainFill;

  let measuredMain = 0;
  if (mainSizing.mode === "fixed") {
    measuredMain = mainSizing.value;
  } else if (!isCircularMain) {
    const padStart = isHoriz ? pad.left : pad.top;
    const padEnd = isHoriz ? pad.right : pad.bottom;
    const childTotal = flowChildren.reduce((sum, c) => sum + (isHoriz ? c.measuredWidth : c.measuredHeight), 0);
    const gapTotal = flowCount > 1 ? gap * (flowCount - 1) : 0;
    const contentMain = padStart + childTotal + gapTotal + padEnd;
    measuredMain = mainSizing.mode === "fit_content" && mainSizing.fallback !== undefined
      ? Math.max(mainSizing.fallback, contentMain)
      : contentMain;
  }

  let measuredCross = 0;
  if (crossSizing.mode === "fixed") {
    measuredCross = crossSizing.value;
  } else {
    const padStartCross = isHoriz ? pad.top : pad.left;
    const padEndCross = isHoriz ? pad.bottom : pad.right;
    const maxChildCross = flowChildren.reduce((max, c) => Math.max(max, isHoriz ? c.measuredHeight : c.measuredWidth), 0);
    const contentCross = padStartCross + maxChildCross + padEndCross;
    measuredCross = crossSizing.mode === "fit_content" && crossSizing.fallback !== undefined
      ? Math.max(crossSizing.fallback, contentCross)
      : contentCross;
  }

  return {
    node,
    measuredWidth: isHoriz ? measuredMain : measuredCross,
    measuredHeight: isHoriz ? measuredCross : measuredMain,
    isCircularMain,
    children
  };
}
