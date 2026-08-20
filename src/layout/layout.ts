import type { Document, PenNode, FrameNode, TextNode } from "../model/types";
import { parseSizing } from "../model/parse";
import type { LayoutNode, Box } from "./types";
import { normalisePadding } from "./padding";
import { measureNode, type MeasuredNode } from "./measure";
import { measureTextNode } from "./text";
import {
  computeMainAxisPositions,
  computeCrossAxisPosition,
  distributeFlowMainSizes
} from "./arrange";

/**
 * # Layout Pipeline
 *
 * Layout is a pure function:
 *   layoutDocument(Document) -> LayoutNode[]
 *
 * Two stages:
 * 1. Measure (Bottom-Up): Computes intrinsic sizes.
 * 2. Arrange (Top-Down): Places nodes and resolves fill_container sizing.
 */

import { resolveInstances } from "../model/instance";

export function layoutDocument(doc: Document): LayoutNode[] {
  const resolved = resolveInstances(doc);
  return resolved.children.map((child) => layoutRootNode(child, resolved.variables));
}


function layoutRootNode(node: PenNode, variables?: Record<string, any>): LayoutNode {
  const measured = measureNode(node, variables);
  const rootBox: Box = {
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: measured.measuredWidth,
    height: measured.measuredHeight
  };
  return arrangeNode(measured, rootBox, variables);
}

export function arrangeNode(measured: MeasuredNode, box: Box, variables?: Record<string, any>): LayoutNode {
  const { node, children } = measured;

  if (children.length === 0) {
    return { id: node.id, type: node.type, box, rotation: node.rotation, children: [] };
  }

  // Handle group and layout: "none" (children positioned by their own explicit x/y)
  const isFrame = node.type === "frame";
  const frame = isFrame ? (node as FrameNode) : null;
  const layoutMode = frame ? (frame.layout || "horizontal") : "none";

  if (layoutMode === "none") {
    const layoutChildren = children.map((child) => {
      const childBox: Box = {
        x: child.node.x ?? 0,
        y: child.node.y ?? 0,
        width: child.measuredWidth,
        height: child.measuredHeight
      };
      return arrangeNode(child, childBox, variables);
    });
    return { id: node.id, type: node.type, box, rotation: node.rotation, children: layoutChildren };
  }

  const isHoriz = layoutMode === "horizontal";
  const pad = normalisePadding(frame?.padding);
  const gap = frame?.gap || 0;

  const padStartMain = isHoriz ? pad.left : pad.top;
  const padEndMain = isHoriz ? pad.right : pad.bottom;
  const padStartCross = isHoriz ? pad.top : pad.left;
  const padEndCross = isHoriz ? pad.bottom : pad.right;

  const frameMain = isHoriz ? box.width : box.height;
  const frameCross = isHoriz ? box.height : box.width;
  const contentMain = frameMain - padStartMain - padEndMain;
  const contentCross = frameCross - padStartCross - padEndCross;

  // Flow children participate in flex distribution; absolute children leave the flow
  const flow = children.filter((c) => c.node.layoutPosition !== "absolute");
  const flowMainSizes = distributeFlowMainSizes(flow, contentMain, gap, isHoriz, !!measured.isCircularMain);
  const flowMainPositions = computeMainAxisPositions({
    frameMain,
    padStart: padStartMain,
    padEnd: padEndMain,
    gap,
    justifyContent: frame?.justifyContent,
    childMainSizes: flowMainSizes
  });

  let flowIdx = 0;
  const layoutChildren: LayoutNode[] = [];

  for (const child of children) {
    if (child.node.layoutPosition === "absolute") {
      const childBox: Box = {
        x: child.node.x ?? 0,
        y: child.node.y ?? 0,
        width: child.measuredWidth,
        height: child.measuredHeight
      };
      layoutChildren.push(arrangeNode(child, childBox, variables));
    } else {
      const mainSize = flowMainSizes[flowIdx] ?? 0;
      const mainPos = flowMainPositions[flowIdx] ?? 0;

      // Omitted cross-axis size is hug (fit_content), not fill. Pen does not stretch.
      const crossSizing = parseSizing(isHoriz ? child.node.height : child.node.width);
      const isCrossFill = crossSizing.mode === "fill_container";
      const crossSize = isCrossFill
        ? Math.max(0, contentCross)
        : (isHoriz ? child.measuredHeight : child.measuredWidth);

      let childW = isHoriz ? mainSize : crossSize;
      let childH = isHoriz ? crossSize : mainSize;

      if (child.node.type === "text" && (child.node as TextNode).textGrowth === "fixed-width") {
        const textMetrics = measureTextNode(child.node as TextNode, childW, variables);
        childH = textMetrics.height;
      }

      const crossPos = computeCrossAxisPosition({
        frameCross,
        padStartCross,
        padEndCross,
        alignItems: frame?.alignItems,
        childCrossSize: isHoriz ? childH : childW
      });

      const childBox: Box = {
        x: isHoriz ? mainPos : crossPos,
        y: isHoriz ? crossPos : mainPos,
        width: childW,
        height: childH
      };

      layoutChildren.push(arrangeNode(child, childBox, variables));
      flowIdx++;
    }
  }

  return { id: node.id, type: node.type, box, rotation: node.rotation, children: layoutChildren };
}
