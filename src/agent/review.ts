import { z } from "zod";
import type { Document } from "../model/types";
import { findNode } from "../model/tree";
import { setProperty } from "../model/edit";
import { digestSubtree } from "../digest/digest";
import { auditDocument, HARD_MIN_FONT_SIZE } from "../design/evaluator";
import type { AuditFinding, AuditSeverity } from "../design/helpers";

/**
 * How far down a deterministic finding is allowed to push the critic's scores.
 *
 * The rubric reserves 2 for a material hierarchy, legibility or interaction
 * failure and puts a localized craft issue at 3-4. Enforcement used to clamp
 * every finding to 2 regardless of severity, so a single localized accent
 * warning came back as hierarchy 2 / craft 2 — and the revision the agent then
 * wrote was scoped to match the score, not the finding. A finding now lowers a
 * score to its own severity's floor and no further.
 */
const SEVERITY_SCORE_FLOOR: Record<AuditSeverity, number> = {
  blocker: 2,
  warning: 3,
  info: 4
};

/**
 * The findings that actually speak to hierarchy. Everything else in the
 * enforced set is craft — an alignment, a baseline, a margin — and marking
 * hierarchy down for a staggered button baseline asks for a rebuild of the
 * page when the defect is one row of buttons.
 */
const HIERARCHY_RULES = new Set<AuditFinding["rule"]>([
  "missing_display",
  "undersized_subject",
  "false_floor",
  "empty_tail",
  "oversized_section_height",
  "accent_overuse"
]);

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

const AUDIT_RISK: Record<AuditFinding["severity"], number> = {
  info: 0,
  warning: 1,
  blocker: 2
};

/**
 * A direct property correction is only safe if it does not introduce a new
 * measured warning/blocker. Apply fixes independently so one bad suggestion
 * cannot discard the useful fixes beside it.
 */
function introducesAuditRegression(before: AuditFinding[], after: AuditFinding[]): boolean {
  const previousRisk = new Map<string, number>();
  for (const finding of before) {
    const key = `${finding.rule}:${finding.nodeId}`;
    previousRisk.set(key, Math.max(previousRisk.get(key) ?? -1, AUDIT_RISK[finding.severity]));
  }

  return after.some((finding) => {
    if (finding.severity === "info") return false;
    const key = `${finding.rule}:${finding.nodeId}`;
    return AUDIT_RISK[finding.severity] > (previousRisk.get(key) ?? -1);
  });
}

/**
 * Apply the critic's property fixes straight to the document. Returns the
 * document unchanged when nothing survives, so the caller can tell whether a
 * model turn is still needed.
 */
export function applyReviewFixes(doc: Document, review: DesignReview): AppliedFixes {
  const applied: string[] = [];
  const rejected: string[] = [];
  const coordinated: NonNullable<DesignReview["fixes"]> = [];
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
    const beforeAudit = auditDocument(next);
    const updated = setProperty(next, fix.nodeId, fix.property, fix.value);
    if (updated === next) {
      // Already at that value. Not a failure, but not progress either.
      continue;
    }
    if (introducesAuditRegression(beforeAudit, auditDocument(updated))) {
      coordinated.push(fix);
      continue;
    }
    next = updated;
    applied.push(`${fix.nodeId}.${fix.property}`);
  }

  // Some visually safe corrections are only safe as a pair. Changing a
  // button fill before its label colour (or vice versa) creates a temporary
  // contrast warning even though the completed pair removes it. Retry only
  // the individually unsafe suggestions as one transaction, and accept the
  // group only when the completed canvas introduces no measured regression.
  if (coordinated.length > 0) {
    const beforeAudit = auditDocument(next);
    let candidate = next;
    const changed: string[] = [];
    for (const fix of coordinated) {
      const updated = setProperty(candidate, fix.nodeId, fix.property, fix.value);
      if (updated !== candidate) {
        candidate = updated;
        changed.push(`${fix.nodeId}.${fix.property}`);
      }
    }
    if (changed.length > 0 && !introducesAuditRegression(beforeAudit, auditDocument(candidate))) {
      next = candidate;
      applied.push(...changed);
    } else {
      rejected.push(...coordinated.map((fix) => `${fix.nodeId}.${fix.property}`));
    }
  }

  return { doc: next, applied, rejected };
}

/** Turn a failed deterministic correction back into an agent-owned revision. */
export function enforceRejectedFixes(
  review: DesignReview,
  rejected: string[]
): DesignReview {
  if (rejected.length === 0) return review;

  const rejectedSet = new Set(rejected);
  const rejectedFixes = (review.fixes ?? []).filter((fix) =>
    rejectedSet.has(`${fix.nodeId}.${fix.property}`)
  );
  const nodeIds = [...new Set(rejectedFixes.map((fix) => fix.nodeId))];
  const properties = rejectedFixes.map((fix) => `${fix.nodeId}.${fix.property}`).join(", ");

  // A rejected fix means a measured regression was caught before it landed —
  // nothing changed on the canvas. That is worth a refine and one issue, not
  // the blocker-level 2 the rubric reserves for a screen you cannot use.
  return {
    ...review,
    verdict: "refine",
    scores: {
      ...review.scores,
      usability: Math.min(review.scores.usability, SEVERITY_SCORE_FLOOR.warning),
      craft: Math.min(review.scores.craft, SEVERITY_SCORE_FLOOR.warning)
    },
    issues: [
      ...review.issues,
      {
        title: "Unsafe automatic correction",
        reason: `The proposed direct correction (${properties}) introduced a measured design regression and was not applied.`,
        instruction: "Correct the cited element with coordinated canvas changes, then verify its contrast, alignment, and surrounding layout.",
        nodeIds
      }
    ]
  };
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
function findRootScreenForNode(doc: Document | undefined, nodeId: string): string | undefined {
  if (!doc || !doc.children) return undefined;
  for (const root of doc.children) {
    if (root.id === nodeId || findNode([root], nodeId)) {
      return root.name || root.id;
    }
  }
  return undefined;
}

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
      const firstId = issue.nodeIds?.[0];
      const screenName = firstId ? findRootScreenForNode(doc, firstId) : undefined;
      const screenTag = screenName ? `[${screenName}] ` : "";
      const where = issue.nodeIds && issue.nodeIds.length > 0 ? ` (${issue.nodeIds.join(", ")})` : "";
      lines.push(`- ${screenTag}${issue.title}${where}: ${issue.instruction}`);
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

export function enforceAuditFindings(
  review: DesignReview,
  findings: AuditFinding[]
): DesignReview {
  const reviewBlockingRules = new Set<AuditFinding["rule"]>([
    "cropped_photography",
    "oversized_section_height",
    "empty_tail",
    "icon_alignment",
    "uneven_card_heights",
    "misaligned_buttons",
    "inconsistent_card_actions",
    "accent_overuse",
    "false_floor",
    "missing_product_image",
    "undersized_subject",
    "missing_display"
  ]);
  const severeFindings = findings.filter(
    (f) =>
      f.severity === "blocker" ||
      reviewBlockingRules.has(f.rule)
  );
  if (severeFindings.length === 0) return review;

  const nextIssues = [...review.issues];
  for (const f of severeFindings) {
    const title =
      f.rule === "cropped_photography"
        ? "Cropped photograph out of proportion"
        : f.rule === "oversized_section_height"
        ? "Oversized section height in vertical flow"
        : f.rule.replace(/_/g, " ");

    const exists = nextIssues.some(
      (iss) =>
        iss.nodeIds?.includes(f.nodeId) &&
        (iss.title.toLowerCase().includes(f.rule) || iss.reason.includes(f.message))
    );
    if (!exists) {
      nextIssues.push({
        title,
        reason: f.message,
        instruction: f.fix,
        nodeIds: [f.nodeId]
      });
    }
  }

  const floor = Math.min(...severeFindings.map((f) => SEVERITY_SCORE_FLOOR[f.severity]));
  const hierarchyFloor = severeFindings.some((f) => HIERARCHY_RULES.has(f.rule))
    ? floor
    : review.scores.hierarchy;

  return {
    ...review,
    verdict: "refine",
    scores: {
      ...review.scores,
      craft: Math.min(review.scores.craft, floor),
      hierarchy: Math.min(review.scores.hierarchy, hierarchyFloor)
    },
    issues: nextIssues
  };
}
