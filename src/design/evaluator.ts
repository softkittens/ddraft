import type { LayoutNode } from "../layout/types";
import type { Document } from "../model/types";
import { layoutResolvedDocument } from "../layout/layout";
import { resolveInstances } from "../model/instance";
import {
  type AuditFinding,
  type AuditRule,
  type AuditSeverity,
  type AuditContext,
  createAuditContext,
  collectSubtreeIds,
  contrastRatio
} from "./helpers";
import {
  type FindingRule,
  type Finding,
  HARD_MIN_FONT_SIZE,
  MIN_FONT_SIZE,
  MIN_TAP_TARGET,
  checkCollision,
  checkOverflow,
  checkUnreadableSize,
  checkOffCanvas,
  evaluateLayoutConstraints,
  runConstraintAudits
} from "./rules/constraints";
import {
  checkTextClipping,
  checkTracking,
  checkProseMeasure,
  checkScaleDiscipline
} from "./rules/typography";
import {
  checkContrast,
  checkTokenBypass,
  checkAccentOveruse,
  checkShadowQuality,
  checkBorderAccent,
  checkSingleElevation
} from "./rules/styling";
import {
  checkTapTargets,
  checkDuplicateRegions,
  checkNestedScreens,
  checkEmptyContainers,
  checkInvisibleNodes,
  checkUndrawnSeries,
  checkCompositionExpectations,
  checkClonedContent,
  checkIconGeometry,
  checkPhotographCrop,
  checkRepeatedPrimaryActions,
  checkSupportingImageWalls,
  checkSectionHeightBudget,
  checkStatTileRow,
  checkCatalogCardRow,
  checkScaffoldOnlyScreens,
  checkUncenteredIconButtons,
  checkEyebrowKicker,
  checkHeadingContentGap,
  checkTextBoundaryCollisions,
  checkChromeCollisions,
  checkTextOnTextCollisions,
  checkCardRowButtonBaselines,
  checkCardRowHeights,
  checkSiblingCardActionConsistency,
  checkStrayOrphanCharacters,
  checkTextOverlappingFrames,
  checkFormInputAlignment,
  checkSegmentedPillDistribution
} from "./rules/composition";

/* ------------------------------------------------------------------ *
 * Re-exports for 100% Backward Compatibility
 * ------------------------------------------------------------------ */

export type { FindingRule, Finding, AuditRule, AuditSeverity, AuditFinding };
export {
  HARD_MIN_FONT_SIZE,
  MIN_FONT_SIZE,
  MIN_TAP_TARGET,
  contrastRatio,
  checkCollision,
  checkOverflow,
  checkUnreadableSize,
  checkOffCanvas,
  evaluateLayoutConstraints
};

/* ------------------------------------------------------------------ *
 * Rule Registry
 * ------------------------------------------------------------------ */

type AuditRuleRunner = (ctx: AuditContext) => AuditFinding[];

const AUDIT_RULES: AuditRuleRunner[] = [
  runConstraintAudits,
  checkContrast,
  checkTextClipping,
  checkTapTargets,
  checkEmptyContainers,
  checkInvisibleNodes,
  checkUndrawnSeries,
  checkNestedScreens,
  checkDuplicateRegions,
  checkAccentOveruse,
  checkCompositionExpectations,
  checkTokenBypass,
  checkShadowQuality,
  checkBorderAccent,
  checkSingleElevation,
  checkTracking,
  checkProseMeasure,
  checkStatTileRow,
  checkCatalogCardRow,
  checkClonedContent,
  checkIconGeometry,
  checkPhotographCrop,
  checkRepeatedPrimaryActions,
  checkSupportingImageWalls,
  checkSectionHeightBudget,
  checkScaleDiscipline,
  checkScaffoldOnlyScreens,
  checkUncenteredIconButtons,
  checkEyebrowKicker,
  checkHeadingContentGap,
  checkTextBoundaryCollisions,
  checkChromeCollisions,
  checkTextOnTextCollisions,
  checkTextOverlappingFrames,
  checkCardRowButtonBaselines,
  checkCardRowHeights,
  checkSiblingCardActionConsistency,
  checkFormInputAlignment,
  checkStrayOrphanCharacters,
  checkSegmentedPillDistribution
];

/* ------------------------------------------------------------------ *
 * Audit Engine Core
 * ------------------------------------------------------------------ */

function dedupe(findings: AuditFinding[]): AuditFinding[] {
  const seen = new Set<string>();
  const out: AuditFinding[] = [];
  for (const f of findings) {
    const key = `${f.rule}|${f.nodeId}|${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  const order: Record<AuditSeverity, number> = { blocker: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function auditDesign(
  tree: LayoutNode[],
  doc: Document,
  targetId?: string
): AuditFinding[] {
  const ctx = createAuditContext(tree, doc);
  const findings = AUDIT_RULES.flatMap((run) => run(ctx));

  if (!targetId) return dedupe(findings);

  const scope = collectSubtreeIds(doc, targetId);
  if (!scope) return dedupe(findings);
  return dedupe(findings.filter((f) => scope.has(f.nodeId)));
}

export function auditDocument(doc: Document, targetId?: string): AuditFinding[] {
  const resolved = resolveInstances(doc);
  return auditDesign(layoutResolvedDocument(resolved), resolved, targetId);
}

export function formatAudit(findings: AuditFinding[], label: string): string {
  if (findings.length === 0) {
    return `${label}: no findings. Every rule ran and none matched.`;
  }
  const blockers = findings.filter((f) => f.severity === "blocker");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");
  const lines = [
    `${label}: ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}, ` +
      `${warnings.length} warning${warnings.length === 1 ? "" : "s"}, ${infos.length} info.`
  ];
  if (infos.length > 0) {
    lines.push(
      "Fix every blocker. Address the warnings. Info is consistency only — leave it unless the screen is otherwise done."
    );
  } else if (blockers.length > 0 || warnings.length > 0) {
    lines.push("Fix every blocker. Address the warnings.");
  }
  for (const f of [...blockers, ...warnings, ...infos]) {
    lines.push(`[${f.severity}] ${f.rule} ${f.nodeId}: ${f.message}`);
    lines.push(`  fix: ${f.fix}`);
  }
  return lines.join("\n");
}

export function formatAuditForCritic(findings: AuditFinding[]): string {
  if (findings.length === 0) return "";
  const blockers = findings.filter((f) => f.severity === "blocker");
  const warnings = findings.filter((f) => f.severity === "warning");

  // Keep all blockers; keep at most 1 representative finding per warning rule and max 5 warnings total
  const seenRules = new Set<string>();
  const cappedWarnings: AuditFinding[] = [];
  for (const w of warnings) {
    if (!seenRules.has(w.rule) && cappedWarnings.length < 5) {
      seenRules.add(w.rule);
      cappedWarnings.push(w);
    }
  }

  if (blockers.length === 0 && cappedWarnings.length === 0) return "";

  const lines: string[] = [
    `Deterministic measurements (${blockers.length} blocker${blockers.length === 1 ? "" : "s"}, ${warnings.length} total warning${warnings.length === 1 ? "" : "s"}):`
  ];
  for (const f of [...blockers, ...cappedWarnings]) {
    lines.push(`[${f.severity}] ${f.rule} on ${f.nodeId}: ${f.message}`);
    if (f.fix) lines.push(`  fix: ${f.fix}`);
  }
  return lines.join("\n");
}

export const FINISHING_RULES: ReadonlySet<AuditRule> = new Set<AuditRule>([
  "missing_display",
  "empty_tail",
  "cloned_content",
  "missed_bleed",
  "undersized_subject",
  "catalog_row",
  "heading_content_gap"
]);

const IMMEDIATE_RULES: ReadonlySet<AuditRule> = new Set<AuditRule>([
  "clipped",
  "collision",
  "invisible_node",
  "off_canvas",
  "text_clipped",
  "text_too_small",
  "low_contrast",
  "token_bypass"
]);

export function auditInsertion(doc: Document, subtreeId: string): AuditFinding[] {
  return auditDocument(doc, subtreeId).filter(
    (f) => f.severity !== "info" && IMMEDIATE_RULES.has(f.rule)
  );
}

export function insertionNote(doc: Document, subtreeId: string): string {
  const findings = auditInsertion(doc, subtreeId);
  if (findings.length === 0) return "";
  return formatAudit(findings, "Measured on what you just inserted");
}
