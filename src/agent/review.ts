import { z } from "zod";
import type { Document } from "../model/types";
import { findNode } from "../model/tree";
import { setProperty } from "../model/edit";
import { digestSubtree } from "../digest/digest";
import { HARD_MIN_FONT_SIZE } from "../design/evaluator";

/* ------------------------------------------------------------------ *
 * Fixes the critic can apply itself.
 *
 * A critic that returns prose costs a whole agent turn to act on: the
 * model re-reads the canvas, re-derives the change, and calls a tool,
 * and it may do none of that correctly. Most of what a vision pass
 * actually finds is one property on one node — a tone, a size, a gap.
 * Those come back as data and are applied directly.
 *
 * The allowlist is by value shape, not just name, so a critic cannot
 * write a string into a gap. Anything structural — layout, children,
 * content — stays prose: restructuring is a design decision and the
 * model that owns the canvas should make it.
 * ------------------------------------------------------------------ */

export type FixValueKind =
  | "number"
  | "sizing"
  | "number_or_array"
  | "color"
  | "font_weight"
  | "text_align"
  | "align"
  | "justify"
  | "text_growth";

export const SAFE_FIX_PROPERTIES: Record<string, FixValueKind> = {
  width: "sizing",
  height: "sizing",
  gap: "number",
  padding: "number_or_array",
  cornerRadius: "number_or_array",
  fontSize: "number",
  fontWeight: "font_weight",
  letterSpacing: "number",
  lineHeight: "number",
  opacity: "number",
  strokeWidth: "number",
  fill: "color",
  stroke: "color",
  textAlign: "text_align",
  textGrowth: "text_growth",
  alignItems: "align",
  justifyContent: "justify"
};

const SIZING_KEYWORD = /^(fill_container|fit_content(\(\d+\))?)$/;
/** A token or a hex. The same contract the canvas rules put on every colour. */
const COLOR_VALUE = /^(\$[a-z-]+|#[0-9a-fA-F]{3,8})$/;

/**
 * The floor under each numeric fix, below which the value deletes content.
 *
 * A critic that cannot restructure will reach for the nearest property that
 * makes an offending element go away, and the nearest property is usually a
 * zero. Four of the fixes in the logs are `fontSize: 0` on the four KPI labels
 * of a factory dashboard — ACTIVE UNITS, THROUGHPUT, CELL EFFICIENCY, OPEN
 * EXCEPTIONS — proposed to satisfy the eyebrow_kicker warning by erasing the
 * text the warning was about. That is a fix in the shape of the schema and a
 * deletion in effect, and applyReviewFixes writes it without a model in the
 * loop, so nothing downstream would have caught it.
 *
 * Removing an element is a design decision. It belongs in `issues`, where the
 * model that owns the canvas decides, not in the fix list that is applied
 * unread.
 */
const FIX_MINIMUMS: Record<string, number> = {
  fontSize: HARD_MIN_FONT_SIZE,
  lineHeight: 0.5,
  width: 1,
  height: 1,
  opacity: 0.05
};

export function isValidFixValue(property: string, value: unknown): boolean {
  const kind = SAFE_FIX_PROPERTIES[property];
  if (!kind) return false;
  const floor = FIX_MINIMUMS[property];
  if (floor !== undefined && typeof value === "number" && value < floor) return false;
  const numbers = (v: unknown) => typeof v === "number" && Number.isFinite(v);

  switch (kind) {
    case "number":
      return numbers(value);
    case "sizing":
      return numbers(value) || (typeof value === "string" && SIZING_KEYWORD.test(value));
    case "number_or_array":
      return numbers(value) || (Array.isArray(value) && value.length > 0 && value.every(numbers));
    case "color":
      return typeof value === "string" && COLOR_VALUE.test(value);
    case "font_weight":
      return (numbers(value) && (value as number) >= 100 && (value as number) <= 900) ||
        (typeof value === "string" && /^(normal|bold|[1-9]00)$/.test(value));
    case "text_align":
      return typeof value === "string" && ["left", "center", "right", "justify"].includes(value);
    case "align":
      return typeof value === "string" && ["start", "center", "end"].includes(value);
    case "justify":
      return typeof value === "string" &&
        ["start", "center", "end", "space_between", "space_around"].includes(value);
    case "text_growth":
      return typeof value === "string" &&
        ["auto", "fixed-width", "fixed-width-height"].includes(value);
  }
}

export const designReviewSchema = z.preprocess((val) => {
  let input = val;
  if (typeof val === "string") {
    try {
      input = JSON.parse(val);
    } catch {
      return val;
    }
  }
  if (typeof input === "object" && input !== null) {
    const obj = { ...(input as Record<string, unknown>) };
    if (Array.isArray(obj.strengths)) obj.strengths = obj.strengths.slice(0, 10);
    if (Array.isArray(obj.issues)) obj.issues = obj.issues.slice(0, 10);
    if (Array.isArray(obj.fixes)) obj.fixes = obj.fixes.slice(0, 50);
    return obj;
  }
  return input;
}, z.object({
  verdict: z.enum(["pass", "refine"]),
  scores: z.object({
    specificity: z.number().min(1).max(5),
    hierarchy: z.number().min(1).max(5),
    usability: z.number().min(1).max(5),
    craft: z.number().min(1).max(5)
  }),
  strengths: z.array(z.string()).max(10).optional().default([]),
  issues: z.array(z.object({
    title: z.string(),
    reason: z.string(),
    instruction: z.string(),
    nodeIds: z.array(z.string()).optional()
  })).max(10).optional().default([]),
  /** Single-property corrections, applied without spending a model turn. */
  fixes: z.array(z.object({
    nodeId: z.string(),
    property: z.string(),
    value: z.union([z.number(), z.string(), z.array(z.number())])
  })).max(50).optional()
}));

export type DesignReview = z.infer<typeof designReviewSchema>;

/** Which model actually looked at the screenshot, and why it was not the first choice. */
export interface ReviewedBy {
  providerId: string;
  model: string;
  /** Absent when the model driving the canvas reviewed its own work. */
  handoff?: string;
}

export type ReviewResponse = DesignReview & { reviewedBy?: ReviewedBy };

export interface AppliedFixes {
  doc: Document;
  applied: string[];
  rejected: string[];
}

/**
 * Apply the critic's property fixes straight to the document. Returns the
 * document unchanged when nothing survives, so the caller can tell whether a
 * model turn is still needed.
 */
export function applyReviewFixes(doc: Document, review: DesignReview): AppliedFixes {
  const applied: string[] = [];
  const rejected: string[] = [];
  let next = doc;

  for (const fix of review.fixes ?? []) {
    if (!isValidFixValue(fix.property, fix.value)) {
      rejected.push(`${fix.nodeId}.${fix.property}`);
      continue;
    }
    if (!findNode(next.children, fix.nodeId)) {
      rejected.push(`${fix.nodeId}.${fix.property}`);
      continue;
    }
    const updated = setProperty(next, fix.nodeId, fix.property, fix.value);
    if (updated === next) {
      // Already at that value. Not a failure, but not progress either.
      continue;
    }
    next = updated;
    applied.push(`${fix.nodeId}.${fix.property}`);
  }

  return { doc: next, applied, rejected };
}

/**
 * The revision brief handed back to the model that owns the canvas.
 *
 * The critic names node ids and nothing else about them, so the model used to
 * open the revision by reading them: one trace spent its first six tool calls
 * on read_digest for the ids the instruction had just quoted, plus their
 * parents. Those ids are already in hand here. Shipping each cited subtree with
 * the instruction that cites it is the same trade the tool results make —
 * context at the point that needs it costs a few lines, and finding it later
 * costs a round trip.
 */
export function applyReviewMessage(
  brief: string,
  review: DesignReview,
  doc?: Document
): string {
  const lines = [
    "[Visual review revision]",
    `Original brief: ${brief}`,
    "A critic looked at a screenshot of this canvas. Apply its instructions with",
    "canvas tools. Recompose the regions it names instead of only adding",
    "decoration, and leave the rest of the canvas alone — this is a revision, not",
    "a second design pass.",
    "When you finish, say in one sentence what you changed. What the product is",
    "has already been said."
  ];

  if (review.issues.length === 0) {
    lines.push("- Address layout alignment, button centering, media breathing room, and visual hierarchy to bring the design to production polish.");
  } else {
    for (const issue of review.issues) {
      const where = issue.nodeIds && issue.nodeIds.length > 0 ? ` (${issue.nodeIds.join(", ")})` : "";
      lines.push(`- ${issue.title}${where}: ${issue.instruction}`);
    }
  }

  const cited = [...new Set(review.issues.flatMap((issue) => issue.nodeIds ?? []))];
  const subtrees = doc
    ? cited
        .filter((id) => findNode(doc.children, id))
        .map((id) => `${id}:\n${digestSubtree(doc, id)}`)
    : [];
  if (subtrees.length > 0) {
    lines.push("", "The nodes it named, as they stand now:", ...subtrees);
  }
  return lines.join("\n");
}
