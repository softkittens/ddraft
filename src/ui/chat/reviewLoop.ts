/**
 * Whether the visual-review loop should stop, send another revision, or apply
 * the last refine without looking again.
 *
 * 3fbe82f2: Luna's third review said refine (alignment, fold) and the loop
 * broke because pass === AUTO_REVIEW_REVISIONS. The refine was shown and never
 * given to the agent.
 *
 * 5f5d9706: DeepSeek's post-fix screenshot aborted. That used to drop a refine
 * we already had, so the second review also never became a revision.
 */
export type ReviewLoopNext = "stop" | "revise" | "apply_last";

export function reviewLoopNext(input: {
  pass: number;
  maxRevisions: number;
  verdict?: "pass" | "refine";
  hasReview: boolean;
}): ReviewLoopNext {
  if (!input.hasReview) return "stop";
  if (input.verdict !== "refine") return "stop";
  if (input.pass < input.maxRevisions) return "revise";
  return "apply_last";
}
