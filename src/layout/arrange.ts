import type { FrameNode } from "../model/types";
import { parseSizing } from "../model/parse";
import type { MeasuredNode } from "./measure";

export interface MainAxisOptions {
  frameMain: number;
  padStart: number;
  padEnd: number;
  gap: number;
  justifyContent?: FrameNode["justifyContent"];
  childMainSizes: number[];
}

export interface CrossAxisOptions {
  frameCross: number;
  padStartCross: number;
  padEndCross: number;
  alignItems?: FrameNode["alignItems"];
  childCrossSize: number;
}

/**
 * Calculates start positions along the main axis according to justifyContent.
 */
export function computeMainAxisPositions(options: MainAxisOptions): number[] {
  const { frameMain, padStart, padEnd, gap, justifyContent = "start", childMainSizes } = options;
  const count = childMainSizes.length;
  if (count === 0) return [];

  const contentMain = frameMain - padStart - padEnd;
  const childTotal = childMainSizes.reduce((sum, size) => sum + size, 0);
  const gapTotal = gap * (count - 1);
  const free = contentMain - childTotal - gapTotal;

  let cursor = padStart;
  let step = gap;

  switch (justifyContent) {
    case "start":
      cursor = padStart;
      step = gap;
      break;
    case "center":
      cursor = padStart + free / 2;
      step = gap;
      break;
    case "end":
      cursor = padStart + free;
      step = gap;
      break;
    case "space_between":
      cursor = padStart;
      step = count > 1 ? (contentMain - childTotal) / (count - 1) : 0;
      break;
    case "space_around": {
      const m = (contentMain - childTotal) / (2 * count);
      cursor = padStart + m;
      step = 2 * m;
      break;
    }
  }

  const positions: number[] = [];
  for (const size of childMainSizes) {
    positions.push(cursor);
    cursor += size + step;
  }
  return positions;
}

/**
 * Calculates child offset on the cross axis according to alignItems.
 */
export function computeCrossAxisPosition(options: CrossAxisOptions): number {
  const { frameCross, padStartCross, padEndCross, alignItems = "start", childCrossSize } = options;
  const contentCross = frameCross - padStartCross - padEndCross;

  switch (alignItems) {
    case "start":
      return padStartCross;
    case "center":
      return padStartCross + (contentCross - childCrossSize) / 2;
    case "end":
      return padStartCross + (contentCross - childCrossSize);
    default:
      return padStartCross;
  }
}


/**
 * Distributes available main space among fill_container flow children.
 */
export function distributeFlowMainSizes(
  flow: MeasuredNode[],
  contentMain: number,
  gap: number,
  isHoriz: boolean,
  isCircularMain: boolean
): number[] {
  if (isCircularMain) {
    return flow.map(() => 1);
  }

  const sizes = flow.map((c) => ({
    s: parseSizing(isHoriz ? c.node.width : c.node.height),
    measured: isHoriz ? c.measuredWidth : c.measuredHeight
  }));

  const fixedSum = sizes.reduce((sum, { s, measured }) => (s.mode !== "fill_container" ? sum + measured : sum), 0);
  const fillCount = sizes.filter(({ s }) => s.mode === "fill_container").length;

  const gapTotal = flow.length > 1 ? gap * (flow.length - 1) : 0;
  const free = contentMain - fixedSum - gapTotal;
  const fillUnit = fillCount > 0 ? Math.max(0, free / fillCount) : 0;

  return sizes.map(({ s, measured }) => (s.mode === "fill_container" ? fillUnit : measured));
}
