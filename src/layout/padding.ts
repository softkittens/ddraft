import type { Padding } from "./types";

/**
 * Normalise any padding input format into an explicit 4-side Padding object.
 *
 * Why:
 * Layout math requires unambiguous per-edge numbers (top, right, bottom, left)
 * to compute content boxes and child offset positions along both main and cross axes.
 */
export function normalisePadding(p: unknown): Padding {
  // If no padding is specified, all edges default to 0.
  if (p === undefined || p === null) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  // Uniform padding: a single number applies to all 4 sides.
  if (typeof p === "number") {
    return { top: p, right: p, bottom: p, left: p };
  }

  if (Array.isArray(p)) {
    // Two-value shorthand: [vertical, horizontal]
    // Proved by Section 4.6 probe padVH: [10, 40] -> top/bottom 10, left/right 40
    if (p.length === 2) {
      const [v, h] = p;
      return { top: v, right: h, bottom: v, left: h };
    }

    // Four-value format: [top, right, bottom, left] (CSS order TRBL)
    // Proved by Section 4.6 probe padTRBL: [5, 10, 15, 20]
    if (p.length === 4) {
      const [top, right, bottom, left] = p;
      return { top, right, bottom, left };
    }
  }

  // Fallback for unexpected data formats
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/**
 * The inverse: four edges back to the shortest form that means them.
 *
 * A control that always wrote `[t, r, b, l]` would turn every `padding: 16` in
 * a document into a four-element array the first time anybody nudged it, which
 * is noise in the file and in every diff of it.
 */
export function compactPadding(sides: Padding): number | [number, number] | [number, number, number, number] {
  const { top, right, bottom, left } = sides;
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && right === left) return [top, right];
  return [top, right, bottom, left];
}
