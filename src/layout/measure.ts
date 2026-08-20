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
export function measureNode(node: PenNode, variables?: Record<string, any>): MeasuredNode {
  const children = ((node as FrameNode | GroupNode).children || []).map((c) => measureNode(c, variables));

  if (node.type === "text") {
    const metrics = measureTextNode(node as TextNode, undefined, variables);
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

  // A frame with layout: "none" does NOT auto-size (defaults to 0x0 if unauthored)
  if (layoutMode === "none") {
    return {
      node,
      measuredWidth: sizingValue(wSizing, 0),
      measuredHeight: sizingValue(hSizing, 0),
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
    measuredMain = padStart + childTotal + gapTotal + padEnd;
  }

  let measuredCross = 0;
  if (crossSizing.mode === "fixed") {
    measuredCross = crossSizing.value;
  } else {
    const padStartCross = isHoriz ? pad.top : pad.left;
    const padEndCross = isHoriz ? pad.bottom : pad.right;
    const maxChildCross = flowChildren.reduce((max, c) => Math.max(max, isHoriz ? c.measuredHeight : c.measuredWidth), 0);
    measuredCross = padStartCross + maxChildCross + padEndCross;
  }

  return {
    node,
    measuredWidth: isHoriz ? measuredMain : measuredCross,
    measuredHeight: isHoriz ? measuredCross : measuredMain,
    isCircularMain,
    children
  };
}
