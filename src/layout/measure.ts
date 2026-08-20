import type { PenNode, FrameNode, TextNode, GroupNode } from "../model/types";
import { parseSizing } from "../model/parse";
import { normalisePadding } from "./padding";
import { measureTextNode } from "./text";

export interface MeasuredNode {
  node: PenNode;
  measuredWidth: number;
  measuredHeight: number;
  isCircularMain?: boolean;
  isCircularCross?: boolean;
  children: MeasuredNode[];
}

/**
 * Measure Stage (Bottom-Up: Child -> Parent)
 * Calculates the intrinsic size of each node.
 */
export function measureNode(node: PenNode): MeasuredNode {
  const children = ((node as FrameNode | GroupNode).children || []).map(measureNode);

  if (node.type === "text") {
    const metrics = measureTextNode(node as TextNode);
    return { node, measuredWidth: metrics.width, measuredHeight: metrics.height, children };
  }

  if (node.type === "group") {
    const w = parseSizing(node.width);
    const h = parseSizing(node.height);
    const autoW = children.reduce((max, c) => Math.max(max, (c.node.x ?? 0) + c.measuredWidth), 0);
    const autoH = children.reduce((max, c) => Math.max(max, (c.node.y ?? 0) + c.measuredHeight), 0);
    return {
      node,
      measuredWidth: w.mode === "fixed" ? w.value : autoW,
      measuredHeight: h.mode === "fixed" ? h.value : autoH,
      children
    };
  }

  if (node.type !== "frame") {
    const w = parseSizing(node.width);
    const h = parseSizing(node.height);
    return {
      node,
      measuredWidth: w.mode === "fixed" ? w.value : (w.fallback ?? 0),
      measuredHeight: h.mode === "fixed" ? h.value : (h.fallback ?? 0),
      children
    };
  }

  const frame = node as FrameNode;
  const layoutMode = frame.layout || "horizontal";
  const pad = normalisePadding(frame.padding);
  const gap = frame.gap || 0;

  const wSizing = parseSizing(frame.width ?? (layoutMode === "none" ? undefined : "fit_content"));
  const hSizing = parseSizing(frame.height ?? (layoutMode === "none" ? undefined : "fit_content"));

  if (layoutMode === "none") {
    const autoW = children.reduce((max, c) => Math.max(max, (c.node.x ?? 0) + c.measuredWidth), 0);
    const autoH = children.reduce((max, c) => Math.max(max, (c.node.y ?? 0) + c.measuredHeight), 0);
    return {
      node,
      measuredWidth: wSizing.mode === "fixed" ? wSizing.value : autoW,
      measuredHeight: hSizing.mode === "fixed" ? hSizing.value : autoH,
      children
    };
  }

  const isHoriz = layoutMode === "horizontal";
  const flowChildren = children.filter((c) => c.node.layoutPosition !== "absolute");
  const flowCount = flowChildren.length;

  const mainSizing = isHoriz ? wSizing : hSizing;
  const crossSizing = isHoriz ? hSizing : wSizing;

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
