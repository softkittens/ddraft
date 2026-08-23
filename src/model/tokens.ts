import type { Document, PenNode } from "./types";
import { walkNodes } from "./tree";
import { resolveVariable } from "./variables";

/**
 * What a document offers a person editing it by hand.
 *
 * A control panel that opens a colour wheel invites a designer to type a hex
 * that belongs to no palette, and a numeric field invites a 15px next to the
 * 14px and 16px already there. Both are findings the audit already raises
 * against the agent — `typography.ts` fails a screen for more than six font
 * sizes, for odd spacing steps, and for text that misses contrast. Offering
 * the document's own tokens first means a hand edit lands inside the same
 * system the agent is held to, without anybody being told a rule.
 *
 * Everything here reads the document rather than the style catalog. A file
 * that arrived from somewhere else still has colours and sizes in it, and
 * those are the ones its designer should be reaching for.
 */

export type SwatchRole = "surface" | "foreground" | "border" | "accent" | "status" | "custom";

export interface Swatch {
  /** What a write puts on the node, e.g. "$accent-primary". */
  token: string;
  /** The variable name, without the $. */
  name: string;
  /** The resolved colour, for painting the chip. */
  value: string;
  role: SwatchRole;
  /** Title-cased, for a tooltip. */
  label: string;
}

export interface FontToken {
  token: string;
  name: string;
  value: string;
  label: string;
}

/**
 * The palette roles in the order a person reads them: what the page is made
 * of, then what sits on it, then what draws the eye.
 *
 * Spelled out rather than imported from the style system, which would pull
 * fifty-eight palettes into the bundle for the sake of eight strings — the
 * same reason `styleKeys.ts` exists.
 */
const ROLE_ORDER: Array<[string, SwatchRole]> = [
  ["surface-primary", "surface"],
  ["surface-secondary", "surface"],
  ["foreground-primary", "foreground"],
  ["foreground-secondary", "foreground"],
  ["foreground-muted", "foreground"],
  ["border-subtle", "border"],
  ["accent-primary", "accent"],
  ["accent-secondary", "accent"],
  ["status-ok", "status"],
  ["status-warn", "status"],
  ["status-fault", "status"]
];

const COLOR_PATTERN = /^(#|rgba?\(|hsla?\()/i;

function looksLikeColor(value: string): boolean {
  return COLOR_PATTERN.test(value.trim());
}

/** "accent-primary" -> "Accent Primary" */
function titleCase(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Every colour token the document defines, palette roles first and in their
 * own order, then anything else the file happens to carry.
 */
export function documentSwatches(doc: Document): Swatch[] {
  const variables = doc.variables;
  if (!variables) return [];

  const seen = new Set<string>();
  const out: Swatch[] = [];

  const push = (name: string, role: SwatchRole): void => {
    if (seen.has(name)) return;
    const entry = variables[name];
    if (entry === undefined) return;
    const declaredType = typeof entry === "object" && entry !== null ? (entry as any).type : undefined;
    const value = resolveVariable(`$${name}`, variables);
    if (!value) return;
    // A file that stores variables as bare strings declares no type, so the
    // shape of the value is the only thing left to go on.
    if (declaredType !== undefined ? declaredType !== "color" : !looksLikeColor(value)) return;
    seen.add(name);
    out.push({ token: `$${name}`, name, value, role, label: titleCase(name) });
  };

  for (const [name, role] of ROLE_ORDER) push(name, role);
  for (const name of Object.keys(variables)) push(name, "custom");

  return out;
}

/** The typeface tokens, heading first. */
export function documentFonts(doc: Document): FontToken[] {
  const variables = doc.variables;
  if (!variables) return [];

  const preferred = ["font-heading", "font-body", "font-caption"];
  const names = [
    ...preferred.filter((name) => variables[name] !== undefined),
    ...Object.keys(variables).filter((name) => name.startsWith("font-") && !preferred.includes(name))
  ];

  const out: FontToken[] = [];
  for (const name of names) {
    const value = resolveVariable(`$${name}`, variables);
    if (!value) continue;
    out.push({ token: `$${name}`, name, value, label: titleCase(name) });
  }
  return out;
}

/**
 * The font sizes this page actually uses, largest first.
 *
 * `typography.ts` calls four to six sizes a type scale, so on a healthy page
 * this is a short row of buttons. On an unhealthy one it is long, which is
 * itself worth seeing.
 */
export function documentTypeScale(nodes: readonly PenNode[]): number[] {
  const sizes = new Set<number>();
  walkNodes([...nodes], (node) => {
    if (node.type !== "text") return;
    const size = (node as any).fontSize;
    if (typeof size === "number" && Number.isFinite(size) && size > 0) sizes.add(size);
  });
  return [...sizes].sort((a, b) => b - a);
}

/** Flatten `16`, `[16, 24]` and `[8, 16, 8, 16]` alike to the numbers in them. */
function paddingValues(padding: unknown, into: Set<number>): void {
  if (typeof padding === "number") {
    if (Number.isFinite(padding)) into.add(padding);
    return;
  }
  if (!Array.isArray(padding)) return;
  for (const part of padding) {
    if (typeof part === "number" && Number.isFinite(part)) into.add(part);
  }
}

/** The gaps and paddings this page actually uses, smallest first, zero excluded. */
export function documentSpacingScale(nodes: readonly PenNode[]): number[] {
  const steps = new Set<number>();
  walkNodes([...nodes], (node) => {
    const gap = (node as any).gap;
    if (typeof gap === "number" && Number.isFinite(gap)) steps.add(gap);
    paddingValues((node as any).padding, steps);
  });
  steps.delete(0);
  return [...steps].sort((a, b) => a - b);
}

/**
 * The literal colours a page paints with, most-used first.
 *
 * A document only has tokens if something wrote them — `set_style` does, an
 * imported .pen file generally does not. Without this the colour control opens
 * empty on exactly the files a person is most likely to be editing by hand,
 * which teaches them to reach for the free hex field and never come back.
 * Harvesting what is already on the canvas is the same move `documentTypeScale`
 * makes for sizes: the document is its own system, whether or not it named one.
 */
export function documentColorsInUse(nodes: readonly PenNode[], limit = 12): Swatch[] {
  const counts = new Map<string, number>();

  const add = (paint: unknown): void => {
    if (Array.isArray(paint)) {
      for (const one of paint) add(one);
      return;
    }
    let value: unknown = paint;
    if (typeof value === "object" && value !== null) {
      // Gradients, images and shaders have no single colour to offer.
      if ((value as any).type !== "color") return;
      value = (value as any).color;
    }
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    // A token is already covered by documentSwatches, and this list only exists
    // when there are none.
    if (trimmed.startsWith("$") || !looksLikeColor(trimmed)) return;
    const key = trimmed.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  walkNodes([...nodes], (node) => {
    add((node as any).fill);
    add((node as any).fills);
    add((node as any).stroke);
    add((node as any).strokes);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => ({ token: value, name: value, value, role: "custom" as const, label: value.toUpperCase() }));
}

/**
 * The corner radii this page uses, smallest first.
 *
 * `0` and the pill value are left out: they are structural choices rather than
 * steps on a scale, and the control offers them separately so they are always
 * reachable even on a document that has never used either.
 */
export function documentRadiusScale(nodes: readonly PenNode[]): number[] {
  const steps = new Set<number>();
  const add = (value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value)) steps.add(value);
    else if (Array.isArray(value)) for (const part of value) add(part);
  };
  walkNodes([...nodes], (node) => add((node as any).cornerRadius));
  steps.delete(0);
  for (const step of steps) if (step >= PILL_RADIUS) steps.delete(step);
  return [...steps].sort((a, b) => a - b);
}

/** Big enough that any control reads as a pill, which is what it means. */
export const PILL_RADIUS = 9999;

/**
 * What to offer before a document has said anything.
 *
 * Six sizes and six steps, because that is the top of the range the audit
 * calls a scale — a new file should start at the healthy end of it.
 */
export const DEFAULT_TYPE_SCALE = [32, 24, 20, 16, 14, 12];
export const DEFAULT_SPACING_SCALE = [4, 8, 12, 16, 24, 32];
export const DEFAULT_RADIUS_SCALE = [4, 8, 12, 16, 24];
