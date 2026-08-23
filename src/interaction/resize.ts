import type { Box } from "../layout/types";
import type { Document, TextNode } from "../model/types";
import { cloneDocument, findNode } from "../model/tree";
import type { Point } from "./camera";

/**
 * Dragging a selection's edges and corners.
 *
 * Four corner handles are painted; the edges are grabbable bands with no
 * handle drawn on them, which is what Figma does — the cursor is the
 * affordance there, and four more squares on every selection is a lot of
 * furniture for a gesture people already expect to work.
 */

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const CURSORS: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize"
};

export function cursorForHandle(handle: ResizeHandle): string {
  return CURSORS[handle];
}

/**
 * Which handle a point is on, in screen pixels.
 *
 * Screen rather than world so the target is the same size however far the
 * canvas is zoomed out — at 0.2x a world-space target would be a fifth of a
 * handle wide and effectively ungrabbable.
 */
export function handleAtScreenPoint(
  box: Box,
  point: Point,
  cornerReach = 6,
  edgeReach = 4
): ResizeHandle | null {
  const right = box.x + box.width;
  const bottom = box.y + box.height;

  const atLeft = Math.abs(point.x - box.x) <= cornerReach;
  const atRight = Math.abs(point.x - right) <= cornerReach;
  const atTop = Math.abs(point.y - box.y) <= cornerReach;
  const atBottom = Math.abs(point.y - bottom) <= cornerReach;

  // Corners first. They are the smaller target and they change both axes, so
  // losing one to the edge band that crosses it would be the worse mistake.
  if (atLeft && atTop) return "nw";
  if (atRight && atTop) return "ne";
  if (atRight && atBottom) return "se";
  if (atLeft && atBottom) return "sw";

  const spansX = point.x >= box.x - edgeReach && point.x <= right + edgeReach;
  const spansY = point.y >= box.y - edgeReach && point.y <= bottom + edgeReach;
  if (spansX && Math.abs(point.y - box.y) <= edgeReach) return "n";
  if (spansX && Math.abs(point.y - bottom) <= edgeReach) return "s";
  if (spansY && Math.abs(point.x - box.x) <= edgeReach) return "w";
  if (spansY && Math.abs(point.x - right) <= edgeReach) return "e";

  return null;
}

export interface ResizeOptions {
  /** Alt: the opposite edge moves too, so the centre stays put. */
  fromCenter?: boolean;
  /** Shift: keep the starting proportions. Corners only, as in Figma. */
  aspect?: boolean;
  min?: number;
}

/** The box a drag produces, in world units. The opposite edge is the anchor. */
export function resizeBox(
  start: Box,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  options: ResizeOptions = {}
): Box {
  const min = options.min ?? 1;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");

  let { x, y, width, height } = start;

  if (options.fromCenter) {
    if (west) {
      width = start.width - dx * 2;
      x = start.x + dx;
    }
    if (east) {
      width = start.width + dx * 2;
      x = start.x - dx;
    }
    if (north) {
      height = start.height - dy * 2;
      y = start.y + dy;
    }
    if (south) {
      height = start.height + dy * 2;
      y = start.y - dy;
    }
  } else {
    if (west) {
      x = start.x + dx;
      width = start.width - dx;
    }
    if (east) width = start.width + dx;
    if (north) {
      y = start.y + dy;
      height = start.height - dy;
    }
    if (south) height = start.height + dy;
  }

  const corner = (west || east) && (north || south);
  if (options.aspect && corner && start.width > 0 && start.height > 0) {
    // The axis that moved further decides, so the box follows the pointer
    // rather than lagging on whichever axis happened to be smaller.
    const scale = Math.max(Math.abs(width / start.width), Math.abs(height / start.height));
    width = start.width * scale;
    height = start.height * scale;
    if (options.fromCenter) {
      x = start.x + (start.width - width) / 2;
      y = start.y + (start.height - height) / 2;
    } else {
      if (west) x = start.x + start.width - width;
      if (north) y = start.y + start.height - height;
    }
  }

  // Clamped rather than flipped. A box dragged through itself is almost always
  // an overshoot, and a node that silently mirrors is hard to undo by eye.
  if (width < min) {
    if (options.fromCenter) x = start.x + start.width / 2 - min / 2;
    else if (west) x = start.x + start.width - min;
    width = min;
  }
  if (height < min) {
    if (options.fromCenter) y = start.y + start.height / 2 - min / 2;
    else if (north) y = start.y + start.height - min;
    height = min;
  }

  return { x, y, width, height };
}

/**
 * Write a resized box onto a node.
 *
 * Deliberately not routed through `applyProperty`. Every job that function does
 * is a no-op here — the four geometry keys are always allowed, always numbers,
 * and carried by every node type, and a resize target is never an instance
 * descendant because the canvas resolves those to the ref before selecting.
 * What is left is the cost: it clones the document per property, and a drag
 * writing four of them sixty times a second would clone two hundred and forty
 * times. This clones once.
 */
export function applyResize(
  doc: Document,
  nodeId: string,
  handle: ResizeHandle,
  box: Box,
  options: Pick<ResizeOptions, "fromCenter"> = {}
): Document {
  if (!findNode(doc.children, nodeId)) return doc;
  const next = cloneDocument(doc);
  const node = findNode(next.children, nodeId);
  if (!node) return doc;

  const changesWidth = handle.includes("w") || handle.includes("e");
  const changesHeight = handle.includes("n") || handle.includes("s");

  if (changesWidth) node.width = Math.round(box.width);
  if (changesHeight) node.height = Math.round(box.height);
  /*
   * Only the handles that move the origin write it. An `e` drag that also set
   * x would fight the west edge it is supposed to be pinned to.
   *
   * Resizing about the centre is the exception: there is no anchored edge, both
   * of them move, so every handle writes the origin on the axis it changes.
   */
  if (handle.includes("w") || (options.fromCenter && changesWidth)) node.x = Math.round(box.x);
  if (handle.includes("n") || (options.fromCenter && changesHeight)) node.y = Math.round(box.y);

  /*
   * Text hugs its content and ignores a width until it is told not to:
   * `measureText` returns the natural width whenever textGrowth is "auto".
   * Without this the handle would move, a width would be written, and nothing
   * on screen would change — the silent no-op this codebase keeps finding.
   * Converting hug to fixed on resize is also what Figma does.
   */
  if (node.type === "text") {
    const text = node as TextNode;
    if (changesHeight) text.textGrowth = "fixed-width-height";
    else if (changesWidth && (text.textGrowth === undefined || text.textGrowth === "auto")) {
      text.textGrowth = "fixed-width";
    }
  }

  return next;
}
