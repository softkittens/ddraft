import type { Document, PenNode, FrameNode, TextNode } from "../src/model/types";
import { walkNodes, childrenOf, isParentNode } from "../src/model/tree";

/* ------------------------------------------------------------------ *
 * Craft metrics.
 *
 * The audit answers "is anything broken". These answer "is this a
 * system or a pile". A design with no blockers can still be flat,
 * inconsistent and repetitive, and none of the audit rules would say
 * so. Every number here is computed from the document, so a change to
 * the prompt or the tools moves a number instead of an opinion.
 * ------------------------------------------------------------------ */

export interface CraftMetrics {
  /** Top-level frames that carry a status bar. */
  screens: number;
  nodes: number;
  /** Deepest nesting. Cards inside cards inside cards push this up. */
  depth: number;

  /** Distinct gap and padding values. A system reuses a few; a pile invents one per frame. */
  spacingValues: number;
  /** Spacing values that are not multiples of 4. */
  spacingOffGrid: number;

  /** Distinct font sizes. Below 3 is flat, above 7 is noise. */
  typeSizes: number;
  /** Largest font size over smallest. 1.0 means every word has the same weight. */
  typeRange: number;

  /** Elements whose *background* is the accent token. One per screen is the rule.
   *  Accent on a text fill or an icon stroke is emphasis and is not counted. */
  accentFills: number;
  /** Share of colour values that are tokens rather than literals, 0..1. */
  tokenCoverage: number;

  /** Components declared with reusable: true. */
  components: number;
  /** Share of nodes that are ref instances, 0..1. Repetition built once and placed. */
  reuseRatio: number;

  /** Text nodes with content over 40 characters that never set a wrapping mode. */
  unwrappedProse: number;
  /** Frames with no children, no fill and no size. Spacer hacks. */
  emptyFrames: number;
}

const SPACING_KEYS = ["gap"] as const;

/** Node types that paint a background. Anything else carrying a colour is foreground. */
const BACKGROUND_TYPES = new Set(["frame", "group", "rectangle", "ellipse", "polygon"]);

/** True when the node has any fill at all, including a photo or a gradient. */
function hasAnyFill(node: PenNode): boolean {
  const f = (node as any).fill ?? (node as any).fills;
  if (Array.isArray(f)) return f.length > 0;
  return f !== undefined && f !== null && f !== "";
}

function paddingValues(node: PenNode): number[] {
  const p = (node as FrameNode).padding;
  if (typeof p === "number") return [p];
  if (Array.isArray(p)) return p.filter((v) => typeof v === "number") as number[];
  return [];
}

/** Every colour-bearing value on a node, as written. */
function colorValues(node: PenNode): string[] {
  const out: string[] = [];
  const collect = (v: any) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") {
      if (typeof v.color === "string") out.push(v.color);
      if (typeof v.value === "string") out.push(v.value);
    }
  };
  collect((node as any).fill);
  collect((node as any).fills);
  collect((node as any).stroke);
  collect((node as any).strokes);
  return out.filter((s) => s.startsWith("$") || s.startsWith("#") || /^rgb/i.test(s));
}

function depthOf(nodes: PenNode[], level = 1): number {
  let deepest = nodes.length > 0 ? level : 0;
  for (const n of nodes) {
    if (isParentNode(n)) {
      const kids = childrenOf(n);
      if (kids.length > 0) deepest = Math.max(deepest, depthOf(kids, level + 1));
    }
  }
  return deepest;
}

/** Mobile screens carry a status bar, desktop screens a top bar. Reading only
 *  for the first counted every desktop run as having no screens at all. */
function isScreen(node: PenNode): boolean {
  if (node.type !== "frame") return false;
  if (/(status|top) ?bar/i.test(node.name ?? "")) return false;
  return childrenOf(node).some((c) => /(status|top) ?bar/i.test(c.name ?? ""));
}

export function craftMetrics(doc: Document): CraftMetrics {
  const spacing = new Set<number>();
  const fontSizes = new Set<number>();
  let nodes = 0;
  let accentFills = 0;
  let tokens = 0;
  let literals = 0;
  let components = 0;
  let refs = 0;
  let unwrappedProse = 0;
  let emptyFrames = 0;

  walkNodes(doc.children, (node) => {
    nodes += 1;

    for (const key of SPACING_KEYS) {
      const v = (node as any)[key];
      if (typeof v === "number" && v > 0) spacing.add(v);
    }
    for (const v of paddingValues(node)) if (v > 0) spacing.add(v);

    const paintsBackground = BACKGROUND_TYPES.has(node.type);
    for (const c of colorValues(node)) {
      if (c.startsWith("$")) {
        tokens += 1;
        // Counted only on a background. Read from every node, an icon stroked in
        // the accent inflated this to eight on a document that had two.
        if (paintsBackground && /accent-primary/.test(c)) accentFills += 1;
      } else {
        literals += 1;
      }
    }

    if (node.reusable === true) components += 1;
    if (node.type === "ref") refs += 1;

    if (node.type === "text") {
      const t = node as TextNode;
      if (typeof t.fontSize === "number" && t.fontSize > 0) fontSizes.add(t.fontSize);
      const content = t.content ?? "";
      const wraps = t.textGrowth === "fixed-width" || t.textGrowth === "fixed-width-height";
      if (content.length > 40 && !wraps) unwrappedProse += 1;
    }

    if (node.type === "frame") {
      // Any fill counts, not only one written as a token or a hex. A frame
      // holding a photograph is not an empty frame.
      if (childrenOf(node).length === 0 && !hasAnyFill(node)) emptyFrames += 1;
    }
  });

  const sizes = [...fontSizes].sort((a, b) => a - b);
  const colorTotal = tokens + literals;

  return {
    screens: doc.children.filter(isScreen).length,
    nodes,
    depth: depthOf(doc.children),
    spacingValues: spacing.size,
    spacingOffGrid: [...spacing].filter((v) => v % 4 !== 0).length,
    typeSizes: sizes.length,
    typeRange: sizes.length > 0 ? Number((sizes[sizes.length - 1] / sizes[0]).toFixed(2)) : 0,
    accentFills,
    tokenCoverage: colorTotal === 0 ? 0 : Number((tokens / colorTotal).toFixed(3)),
    components,
    reuseRatio: nodes === 0 ? 0 : Number((refs / nodes).toFixed(3)),
    unwrappedProse,
    emptyFrames
  };
}
