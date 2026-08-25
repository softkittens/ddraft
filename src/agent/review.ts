import { z } from "zod";
import type { Document } from "../model/types";
import { findNode } from "../model/tree";
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
  "repeated_primary_action",
  "supporting_image_wall",
  "accent_overuse"
]);

export const reviewIssueSchema = z.object({
  title: z.string(),
  reason: z.string(),
  instruction: z.string(),
  nodeIds: z.array(z.string()).optional()
});

export type ReviewIssue = z.infer<typeof reviewIssueSchema>;

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
  qualityGate: z.object({
    distinctive: z.boolean(),
    proportional: z.boolean(),
    presentationReady: z.boolean(),
    reason: z.string()
  }).optional(),
  strengths: z.array(z.string()).max(10).optional().default([]),
  issues: z.array(reviewIssueSchema).max(10).optional().default([])
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
  const hasMismatch = review.issues.some((issue) =>
    /(?:direction|composition|style|palette)\s+mismatch/i.test(issue.title) ||
    /^restyle\b/i.test(issue.title)
  );

  const lines = [
    hasMismatch ? "[Visual review revision - Direction mismatch: restyle permitted]" : "[Visual review revision]",
    `Original brief: ${brief}`,
    "A critic looked at a screenshot of this canvas. Apply its instructions with",
    "canvas tools. Recompose the regions it names instead of only adding",
    "decoration, and leave the rest of the canvas alone — this is a revision, not",
    "a second design pass. If the critic specifically identifies a fundamental",
    "direction, palette, or style mismatch with the product's positioning, you may",
    "call set_style or recompose the visual foundation.",
    "Never delete a create_screen slot (Main, Top Bar, rails, Inset, Bleed) or the",
    "screen itself. Use replace_node to refactor cited sections or cards in a single atomic tool call, or batch_set_properties to adjust spacing, height, and tokens in-place.",
    "When you finish, say in one sentence what you changed. What the product is",
    "has already been said."
  ];

  const actionableIssues = review.issues.filter(
    (issue) => (issue.nodeIds && issue.nodeIds.length > 0) || /(?:mismatch|restyle)/i.test(issue.title)
  );

  if (actionableIssues.length === 0 && review.issues.length === 0) {
    lines.push("- Address layout alignment, button centering, media breathing room, and visual hierarchy to bring the design to production polish.");
  } else {
    const list = actionableIssues.length > 0 ? actionableIssues : review.issues;
    for (const issue of list) {
      const firstId = issue.nodeIds?.[0];
      const screenName = firstId ? findRootScreenForNode(doc, firstId) : undefined;
      const screenTag = screenName ? `[${screenName}] ` : "";
      const where = issue.nodeIds && issue.nodeIds.length > 0 ? ` (${issue.nodeIds.join(", ")})` : "";
      lines.push(`- ${screenTag}${issue.title}${where}: ${issue.instruction}`);
    }
  }

  return lines.join("\n");
}

export function finalizeReview(
  review: DesignReview,
  findings: AuditFinding[] = []
): DesignReview {
  const severeFindings = findings.filter((f) => f.severity === "blocker");

  const nextIssues = [...(review.issues || [])];
  const qualityReady = Boolean(
    review.qualityGate?.distinctive &&
    review.qualityGate?.proportional &&
    review.qualityGate?.presentationReady
  );
  for (const f of severeFindings) {
    const title =
      f.rule === "oversized_section_height"
        ? "Oversized section height in vertical flow"
        : f.rule.replace(/_/g, " ");

    const exists = nextIssues.some((iss) => iss.nodeIds?.includes(f.nodeId));
    if (!exists) {
      nextIssues.push({
        title,
        reason: f.message,
        instruction: f.fix,
        nodeIds: [f.nodeId]
      });
    }
  }

  const scores = { ...review.scores };
  if (severeFindings.length > 0) {
    const floor = Math.min(...severeFindings.map((f) => SEVERITY_SCORE_FLOOR[f.severity]));
    const hierarchyFloor = severeFindings.some((f) => HIERARCHY_RULES.has(f.rule))
      ? floor
      : scores.hierarchy;
    scores.craft = Math.min(scores.craft, floor);
    scores.hierarchy = Math.min(scores.hierarchy, hierarchyFloor);
  }

  const allScoresAtLeastFour =
    scores.specificity >= 4 &&
    scores.hierarchy >= 4 &&
    scores.usability >= 4 &&
    scores.craft >= 4;

  const isPass = qualityReady && allScoresAtLeastFour && nextIssues.length === 0 && severeFindings.length === 0;

  return {
    verdict: isPass ? "pass" : "refine",
    scores,
    qualityGate: review.qualityGate,
    strengths: review.strengths || [],
    issues: nextIssues
  };
}

export const enforceAuditFindings = finalizeReview;
