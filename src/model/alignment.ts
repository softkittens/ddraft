import type { FrameNode, PenNode } from "./types";

/**
 * How a frame arranges its children, and what the engine will really do with
 * what is stored.
 *
 * Every function here answers the second question rather than the first. A
 * control that read `frame.justifyContent` and lit up the matching button would
 * agree with the file and disagree with the screen, which is the one thing an
 * inspector must never do: `vocabulary.ts` counts 787 writes across the logs
 * that stored a CSS spelling the engine does not read, and 321 of them were
 * these two properties. Those frames still say `space-between` today and still
 * render packed to the start.
 *
 * So the control shows what is drawn, and says separately when the file
 * disagrees. Aliases are deliberately not applied on the way in — they run on
 * the write path, and running them here would launder exactly the corruption
 * this is meant to reveal.
 */

export type Layout = "horizontal" | "vertical" | "none";
export type Justify = "start" | "center" | "end" | "space_between" | "space_around";
export type Align = "start" | "center" | "end";

/** The three positions on one axis, in grid order. */
export const POSITIONS: readonly Align[] = ["start", "center", "end"];

/** justifyContent values that place children rather than pack them. */
export const DISTRIBUTIONS: readonly Justify[] = ["space_between", "space_around"];

export interface Effective<T> {
  /** What the layout engine does with what is stored. */
  value: T;
  /** Exactly what the file holds, including undefined and misspellings. */
  stored: unknown;
  /** False when the engine had to fall back because it did not know the value. */
  understood: boolean;
}

/**
 * `layout.ts:85` reads `frame.layout || "horizontal"`, then treats anything
 * that is not `"none"` or `"horizontal"` as vertical. So an unset layout is a
 * row, and a misspelt one is a column — `layout: "flex"` renders as a stack.
 */
export function effectiveLayout(stored: unknown): Effective<Layout> {
  if (stored === undefined || stored === null || stored === "") {
    return { value: "horizontal", stored, understood: true };
  }
  if (stored === "none" || stored === "horizontal" || stored === "vertical") {
    return { value: stored, stored, understood: true };
  }
  return { value: "vertical", stored, understood: false };
}

/**
 * `computeMainAxisPositions` defaults to `start` and its switch has no default
 * arm, so an unknown value leaves the cursor where `start` would have put it.
 */
export function effectiveJustify(stored: unknown): Effective<Justify> {
  if (stored === undefined || stored === null) {
    return { value: "start", stored, understood: true };
  }
  const known: readonly string[] = ["start", "center", "end", "space_between", "space_around"];
  if (typeof stored === "string" && known.includes(stored)) {
    return { value: stored as Justify, stored, understood: true };
  }
  return { value: "start", stored, understood: false };
}

/** `computeCrossAxisPosition` returns the start offset from its `default` arm. */
export function effectiveAlign(stored: unknown): Effective<Align> {
  if (stored === undefined || stored === null) {
    return { value: "start", stored, understood: true };
  }
  if (stored === "start" || stored === "center" || stored === "end") {
    return { value: stored, stored, understood: true };
  }
  return { value: "start", stored, understood: false };
}

export interface FrameAlignment {
  layout: Effective<Layout>;
  justifyContent: Effective<Justify>;
  alignItems: Effective<Align>;
}

export function readAlignment(node: PenNode): FrameAlignment {
  const frame = node as FrameNode;
  return {
    layout: effectiveLayout(frame.layout),
    justifyContent: effectiveJustify(frame.justifyContent),
    alignItems: effectiveAlign(frame.alignItems)
  };
}

/** A one-line account of a value the engine could not read, or null when it could. */
export function misreadNote(property: string, effective: Effective<unknown>): string | null {
  if (effective.understood) return null;
  return `${property} is "${String(effective.stored)}" in the file; the engine reads that as "${String(effective.value)}"`;
}

/**
 * The nine cells, and which property each axis of the grid drives.
 *
 * The grid is spatial: the top-left cell means top-left on the canvas whichever
 * way the frame flows. Which of the two properties gets asked changes instead,
 * because `justifyContent` follows the main axis — it is horizontal in a row
 * and vertical in a column. Wiring the grid straight to the properties would
 * silently transpose every alignment the moment somebody switched direction.
 */
export function cellToProperties(
  layout: Layout,
  col: number,
  row: number
): { justifyContent: Align; alignItems: Align } {
  const x = POSITIONS[col];
  const y = POSITIONS[row];
  return layout === "vertical"
    ? { justifyContent: y, alignItems: x }
    : { justifyContent: x, alignItems: y };
}

/**
 * The cell a frame currently sits in, or null when it sits in none of them —
 * a distributed frame is spread across a whole row or column of the grid.
 */
export function propertiesToCell(
  layout: Layout,
  justifyContent: Justify,
  alignItems: Align
): { col: number; row: number } | null {
  if (justifyContent === "space_between" || justifyContent === "space_around") return null;
  const main = POSITIONS.indexOf(justifyContent);
  const cross = POSITIONS.indexOf(alignItems);
  if (main < 0 || cross < 0) return null;
  return layout === "vertical" ? { col: cross, row: main } : { col: main, row: cross };
}

/**
 * CSS flexbox for a preview of what a cell would do.
 *
 * The nine previews are real flex containers rather than drawings, so the thing
 * on the button is produced the same way the thing on the canvas is. The value
 * names line up one for one except for the two distributions, which is why the
 * engine's spelling uses underscores at all.
 */
export interface FlexStyle {
  "flex-direction": "row" | "column";
  "justify-content": "flex-start" | "center" | "flex-end" | "space-between" | "space-around";
  "align-items": "flex-start" | "center" | "flex-end";
}

export function flexStyle(layout: Layout, justifyContent: Justify, alignItems: Align): FlexStyle {
  const justify: FlexStyle["justify-content"] =
    justifyContent === "space_between"
      ? "space-between"
      : justifyContent === "space_around"
        ? "space-around"
        : justifyContent === "end"
          ? "flex-end"
          : justifyContent === "center"
            ? "center"
            : "flex-start";
  const align: FlexStyle["align-items"] =
    alignItems === "end" ? "flex-end" : alignItems === "center" ? "center" : "flex-start";
  return {
    "flex-direction": layout === "vertical" ? "column" : "row",
    "justify-content": justify,
    "align-items": align
  };
}
