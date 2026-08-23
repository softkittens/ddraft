import type { PenNode } from "../../../model/types";

/**
 * Reading one value out of a selection.
 *
 * A control over three nodes has to say one of three things: they agree, they
 * disagree, or none of them has an opinion. Collapsing the middle case into the
 * first is how a design tool silently overwrites two of them.
 */

export interface SharedValue<T> {
  /** The agreed value, or undefined when they disagree or nobody set one. */
  value: T | undefined;
  /** True when the selection holds more than one distinct value. */
  mixed: boolean;
}

export function sharedValue<T>(
  nodes: readonly PenNode[],
  read: (node: PenNode) => T | undefined,
  key: (value: T) => string = (value) => JSON.stringify(value)
): SharedValue<T> {
  let first: T | undefined;
  let firstKey: string | undefined;
  let mixed = false;

  for (const node of nodes) {
    const value = read(node);
    if (value === undefined) continue;
    const k = key(value);
    if (firstKey === undefined) {
      first = value;
      firstKey = k;
    } else if (k !== firstKey) {
      mixed = true;
    }
  }

  return mixed ? { value: undefined, mixed: true } : { value: first, mixed: false };
}

/**
 * What a node is painted with, as far as a swatch can say it.
 *
 * Gradients, images, shaders and mesh fills are `other`: there is no single
 * colour to show, and a control that rendered one would be lying about what
 * picking a new one is going to replace.
 */
export type FillKind =
  | { kind: "none" }
  | { kind: "solid"; value: string }
  | { kind: "other" };

export function fillOf(node: PenNode): FillKind {
  return readPaint((node as any).fill ?? (node as any).fills);
}

export function strokeOf(node: PenNode): FillKind {
  return readPaint((node as any).stroke ?? (node as any).strokes);
}

function readPaint(paint: unknown): FillKind {
  if (paint === undefined || paint === null) return { kind: "none" };

  if (Array.isArray(paint)) {
    const painted = paint.filter((one) => one !== undefined && one !== null);
    if (painted.length === 0) return { kind: "none" };
    // A stack of fills has no single colour either, so only a lone one counts.
    return painted.length === 1 ? readPaint(painted[0]) : { kind: "other" };
  }

  if (typeof paint === "string") {
    const trimmed = paint.trim();
    return trimmed ? { kind: "solid", value: trimmed } : { kind: "none" };
  }

  if (typeof paint === "object") {
    const record = paint as Record<string, unknown>;
    if (record.enabled === false) return { kind: "none" };
    if (record.type !== "color") return { kind: "other" };
    const color = record.color;
    return typeof color === "string" && color.trim()
      ? { kind: "solid", value: color.trim() }
      : { kind: "none" };
  }

  return { kind: "other" };
}

/** A comparable spelling of a fill, for deciding whether a selection agrees. */
export function fillKey(fill: FillKind): string {
  return fill.kind === "solid" ? `solid:${fill.value.toLowerCase()}` : fill.kind;
}
