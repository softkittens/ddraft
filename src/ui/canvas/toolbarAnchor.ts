import type { Box } from "../../layout/types";
import type { LayoutNode } from "../../layout/types";
import { findNodeWorldBox } from "../../interaction/hittest";

/**
 * Where the selection toolbar goes.
 *
 * Kept apart from the component because the interesting part is arithmetic —
 * a bar that flips under the selection near the top of the window and stops at
 * the edges — and arithmetic is worth testing without a DOM.
 */

export type Placement = "above" | "below";

export interface ToolbarPlacement {
  /** Centre of the bar, in screen pixels. The bar itself is translated -50%. */
  left: number;
  top: number;
  placement: Placement;
}

export interface PlaceToolbarOptions {
  /** The selection, in screen pixels. */
  box: Box;
  /** Measured, so a wide bar is not pushed off the edge. Zero before first paint. */
  toolbarWidth: number;
  toolbarHeight: number;
  viewport: { width: number; height: number };
  /** Chrome along the top and left edges the bar must not hide under. */
  topInset: number;
  leftInset: number;
  margin: number;
  /** Distance between the bar and the selection. */
  gap: number;
}

/** The union of the selected nodes' boxes, in world space. */
export function unionWorldBox(tree: LayoutNode[], ids: Iterable<string>): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of ids) {
    const box = findNodeWorldBox(tree, id);
    if (!box) continue;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function clamp(value: number, low: number, high: number): number {
  // Low wins when the window is narrower than the bar, so the bar stays
  // reachable rather than sliding off the left edge.
  return high < low ? low : Math.min(high, Math.max(low, value));
}

export function placeToolbar(options: PlaceToolbarOptions): ToolbarPlacement {
  const { box, toolbarWidth, toolbarHeight, viewport, topInset, leftInset, margin, gap } = options;
  const half = toolbarWidth / 2;

  const left = clamp(
    box.x + box.width / 2,
    leftInset + margin + half,
    viewport.width - margin - half
  );

  const above = box.y - gap - toolbarHeight;
  const below = box.y + box.height + gap;

  // Above by default, because a bar under the selection covers the thing below
  // it that the person is most likely comparing against.
  const placement: Placement = above >= topInset ? "above" : "below";
  const top = clamp(
    placement === "above" ? above : below,
    topInset,
    viewport.height - margin - toolbarHeight
  );

  return { left, top, placement };
}
