import type { Document } from "../model/types";
import { walkNodes } from "../model/tree";
import { auditDocument, formatAudit, FINISHING_RULES } from "../design/evaluator";
import { digest } from "../digest/digest";

export type AgentTrace = (event: Record<string, unknown>) => void;

export function nodeCount(doc: Document): number {
  let count = 0;
  walkNodes(doc.children, () => { count += 1; });
  return count;
}

export function trace(callback: AgentTrace | undefined, event: Record<string, unknown>): void {
  try {
    callback?.(event);
  } catch {
    // Diagnostics must never change the run they are observing.
  }
}

export const MAX_STALLED_TURNS = 4;
export const WRAP_UP_ROUNDS = 8;
export const MAX_RESEARCH_TURNS = 4;
export const MAX_CORRECTIONS = 3;

/** Consecutive one-call mutating rounds before asking the model to batch. */
export const SOLO_CALL_STREAK = 3;
/** After two reminders, further singles are the model's choice. */
export const MAX_SOLO_NUDGES = 2;

/**
 * Replies cut off by the output cap before the run gives up on the model.
 *
 * Two, because the first is usually one long think that overran and the retry
 * lands; a model that overruns twice in a row is not going to stop on the third
 * ask, and every attempt costs a full round-trip.
 */
export const MAX_TRUNCATIONS = 2;

export const READ_ONLY_TOOLS = new Set(["read_digest", "measure", "search_icons"]);

export interface OutcomeMetrics {
  reason: string;
  turnsUsed: number;
  corrections: number;
  toolTally: Map<string, number>;
}

export function recordOutcome(
  traceCb: AgentTrace | undefined,
  doc: Document,
  metrics: OutcomeMetrics
): void {
  const findings = auditDocument(doc);
  const totalNodes = nodeCount(doc);

  trace(traceCb, {
    type: "outcome",
    reason: metrics.reason,
    turnsUsed: metrics.turnsUsed,
    screens: doc.children.length,
    nodes: totalNodes,
    corrections: metrics.corrections,
    toolCalls: Object.fromEntries(
      [...metrics.toolTally.entries()].sort((a, b) => b[1] - a[1])
    ),
    blockers: findings.filter((f) => f.severity === "blocker").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    infos: findings.filter((f) => f.severity === "info").length,
    rules: [...new Set(findings.map((f) => f.rule))].sort(),
    findings: findings
      .filter((f) => f.severity !== "info")
      .slice(0, 20)
      .map((f) => `[${f.severity}] ${f.rule} ${f.nodeId}: ${f.message}`),
    digest: digest(doc)
  });
}

/**
 * What the finishing audit still objects to: blockers plus the finishing rules.
 *
 * The same test the correction pass uses, exported so the end of the run can
 * ask it too.
 */
export function unfinishedFindings(doc: Document) {
  return auditDocument(doc).filter(
    (f) => f.severity === "blocker" || FINISHING_RULES.has(f.rule)
  );
}

/**
 * Whether a run that stopped here produced something broken.
 *
 * Deliberately blockers only, not the finishing rules the correction pass uses.
 * Mid-run, a finishing-rule warning is worth another round. At the wall there
 * are no more rounds, and the only question left is what the user is looking
 * at: the run behind the "Factory Floor Operations" dashboard ended on a
 * budget error carrying nothing worse than missing_display — no display-sized
 * heading on a telemetry screen — while the design itself was finished and
 * usable. Warnings still reach the user through the audit; they should not
 * turn a finished canvas into a failure.
 */
export function brokenFindings(doc: Document) {
  return auditDocument(doc).filter((f) => f.severity === "blocker");
}

export type CompletionEvaluation =
  | { action: "finish" }
  | { action: "retry_empty"; nudge: string }
  | { action: "correct_unfinished"; nudge: string };

export type TurnEvaluation =
  | { action: "progress" }
  | { action: "nudge"; text: string }
  | { action: "error"; reason: "thrashing" | "stalled" | "truncated"; message: string };

import type { SessionLifecycle } from "./context";

export class SessionWatchdog {
  turnsUsed = 0;
  corrections = 0;
  stalledTurns = 0;
  deletionTurns = 0;
  researchTurns = 0;
  totalResearchTurns = 0;
  truncations = 0;
  /** Rounds spent asking again for a design the model answered with prose. */
  emptyReplies = 0;
  wrappingUp = false;
  toolTally = new Map<string, number>();
  soloStreak = 0;
  soloNudges = 0;

  recordTool(name: string): void {
    this.toolTally.set(name, (this.toolTally.get(name) ?? 0) + 1);
  }

  /**
   * 1d2d9f50 spent 44 of 67 rounds on a single call. Wrap-up already says a
   * round costs the same with twenty calls, but it only fires near the ceiling.
   * This is that sentence, mid-run, and it does not stop the session.
   */
  noteSoloRound(toolCalls: { function: { name: string } }[]): string | null {
    if (this.wrappingUp || this.soloNudges >= MAX_SOLO_NUDGES) {
      this.soloStreak = 0;
      return null;
    }
    const mutating = toolCalls.filter(
      (c) => !READ_ONLY_TOOLS.has(c.function.name) && c.function.name !== "answer_user"
    );
    if (mutating.length === 1) this.soloStreak += 1;
    else this.soloStreak = 0;

    if (this.soloStreak < SOLO_CALL_STREAK) return null;

    this.soloStreak = 0;
    this.soloNudges += 1;
    return (
      "A round costs the same whether it carries one tool call or twenty. " +
      "Put the rest of this step into one reply: several insert_node calls (one band each), " +
      "and batch_set_properties for every property edit at once."
    );
  }

  /**
   * A reply the provider cut off at the output cap, carrying no tool call.
   *
   * The instruction is about where the tokens went rather than about design,
   * because that is the actual failure: the model thought until it ran out of
   * room. Telling it to think less and call sooner is the only thing that
   * changes the outcome.
   */
  evaluateTruncation(turn: number, maxTurns: number): TurnEvaluation {
    this.truncations += 1;
    if (this.truncations > MAX_TRUNCATIONS || turn >= maxTurns - 1) {
      return {
        action: "error",
        reason: "truncated",
        message:
          `The model ran out of room to reply ${this.truncations} times without making a single tool call — ` +
          "it spent the whole budget thinking. Everything built so far is kept. " +
          "Try a lower reasoning effort, or a smaller request."
      };
    }
    return {
      action: "nudge",
      text:
        "Your last reply was cut off before any tool call: it ran out of output tokens " +
        "part-way through thinking. Nothing was applied. Decide quickly this time and " +
        "spend the reply on tool calls instead of deliberation — send the next concrete " +
        "step now, even if it is smaller than the one you were planning."
    };
  }

  /**
   * The warning that the rounds are running out.
   *
   * The first version of this said "land what is on the canvas ... finish the
   * screen now", and it measurably backfired: across the logged runs, rounds
   * after this fired carried 2.21 tool calls against 2.79 before it, a 21% drop
   * in density at the exact moment the run needed to be densest. Telling a
   * model it is running out of time makes it careful, and careful means small
   * verifiable steps — one property per round-trip.
   *
   * The four runs that hit the wall are the four least dense runs in the corpus
   * (1.3 to 2.1 calls per round). One of them spent 30 rounds on a 144-node
   * dashboard; another built 145 nodes in 13 rounds at 6.8 calls per round.
   * Same output, less than half the budget. So the scarce thing is round trips,
   * not edits, and the nudge now says that instead of counting down.
   */
  checkWrapUp(turn: number, maxTurns: number, screenCount: number): string | null {
    const wrapThreshold = Math.min(8, Math.max(3, Math.floor(maxTurns * 0.35)));
    if (!this.wrappingUp && turn >= maxTurns - wrapThreshold && screenCount > 0) {
      this.wrappingUp = true;
      return (
        `${maxTurns - turn} rounds left, and a round costs the same whether it carries one tool call or twenty. ` +
        "Put everything that is left into this one reply: several insert_node calls, one band each, " +
        "and batch_set_properties for polish. Do not create a second screen to start over, " +
        "and do not delete a screen that already has a design. " +
        "Nothing is discarded when the rounds run out — whatever state a node is in is the state it keeps — so do not " +
        "delete or start changes you cannot finish in this reply."
      );
    }
    return null;
  }

  evaluateCompletion(
    doc: Document,
    turn: number,
    maxTurns: number,
    docUnchanged: boolean,
    replyText = "",
    lifecycle?: SessionLifecycle
  ): CompletionEvaluation {
    if (docUnchanged && doc.children.length > 0) {
      return { action: "finish" };
    }

    if (lifecycle === "revision_edit") {
      return { action: "finish" };
    }

    /*
     * An empty canvas with a written reply is usually a conversational answer
     * the model wrote as prose instead of through answer_user.
     *
     * It gets one push-back, not three. Asking again is worth a round because
     * the model may have been asked for a design and stopped short; asking a
     * third time is not, because a model that ignored the tool twice is not
     * going to reach for it on the next ask. One logged run spent four rounds
     * and two minutes answering "hello" this way, re-writing the same greeting
     * each time, and the reply the user finally saw was the fourth copy.
     */
    const answered = replyText.trim().length > 0;
    const budget = answered ? 1 : MAX_CORRECTIONS;

    if (doc.children.length === 0 && this.emptyReplies < budget && turn < maxTurns - 1) {
      this.emptyReplies += 1;
      return {
        action: "retry_empty",
        nudge:
          "The canvas is still empty. Decide again: if the request requires design " +
          "work, use canvas tools; otherwise call answer_user. Do not build merely " +
          "because the canvas is empty."
      };
    }

    // Out of push-backs with prose in hand: that prose is the answer.
    if (doc.children.length === 0 && answered) {
      return { action: "finish" };
    }

    const unfinished = unfinishedFindings(doc);

    if (unfinished.length > 0 && this.corrections < MAX_CORRECTIONS && turn < maxTurns - 1) {
      this.corrections += 1;
      return {
        action: "correct_unfinished",
        nudge: [
          formatAudit(unfinished, "Measured before you finish"),
          "",
          "Apply the necessary property or layout fixes to resolve any blocker findings, then finish.",
          "Do not delete or dismantle existing design sections."
        ].join("\n")
      };
    }

    return { action: "finish" };
  }

  evaluateTurnProgress(options: {
    docBefore: Document;
    docAfter: Document;
    nodesAtStart: number;
    toolCalls: { function: { name: string } }[];
    revisited: { key: string; values: string[] }[];
  }): TurnEvaluation {
    const { docBefore, docAfter, nodesAtStart, toolCalls, revisited } = options;
    const currentNodes = nodeCount(docAfter);
    const built = currentNodes > nodesAtStart;
    const deleted = currentNodes < nodesAtStart;

    if (deleted) {
      this.deletionTurns += 1;
      if (this.deletionTurns >= 3) {
        this.deletionTurns = 0;
        return {
          action: "nudge",
          text:
            "You have spent multiple rounds deleting individual nodes. Stop dismantling the page. " +
            "Edit the existing slots: one insert_node per band, several in this reply. " +
            "Do not create a second screen and delete the one that already has a design."
        };
      }
    } else if (built) {
      this.deletionTurns = 0;
    }

    if (docAfter !== docBefore && (built || revisited.length === 0)) {
      this.stalledTurns = 0;
      this.researchTurns = 0;
      const soloNudge = this.noteSoloRound(toolCalls);
      if (soloNudge) return { action: "nudge", text: soloNudge };
      return { action: "progress" };
    }

    this.soloStreak = 0;

    if (revisited.length > 0) {
      this.stalledTurns += 1;
      if (this.stalledTurns >= MAX_STALLED_TURNS) {
        return {
          action: "error",
          reason: "thrashing",
          message: `Agent stopped after ${this.stalledTurns} rounds spent undoing its own edits. Partial design was kept.`
        };
      }
      return {
        action: "nudge",
        text: [
          "Measured across this run — these are back to values they already held:",
          ...revisited.map(({ key, values }) => `  ${key}: ${values.join(" → ")}`),
          "",
          "The canvas is where it was several rounds ago and those rounds are gone.",
          "Stop repeatedly toggling these properties. Apply the intended value directly",
          "or leave it and spend what is left on the screens that are still unfinished."
        ].join("\n")
      };
    }

    if (toolCalls.every((c) => READ_ONLY_TOOLS.has(c.function.name))) {
      this.researchTurns += 1;
      this.totalResearchTurns += 1;
      if (this.researchTurns >= MAX_RESEARCH_TURNS || this.totalResearchTurns >= 6) {
        this.researchTurns = 0;
        return {
          action: "nudge",
          text:
            "That is enough looking things up and measuring. Build with auto-layout " +
            "(fill_container, fit_content, gap, padding): dimensions resolve automatically, " +
            "and an unfinished screen is worth more than another inspection. Complete and land the remaining screens now."
        };
      }
      return { action: "progress" };
    }

    this.stalledTurns += 1;
    if (this.stalledTurns >= MAX_STALLED_TURNS) {
      return {
        action: "error",
        reason: "stalled",
        message: `Agent stopped after ${this.stalledTurns} tool rounds made no canvas progress. Partial design was kept.`
      };
    }
    if (this.stalledTurns >= 2) {
      return {
        action: "nudge",
        text:
          "Your last tool calls made no canvas changes (the values were already set or the nodes were unaffected). " +
          "If an element is misaligned (e.g. an icon button not centered), set justifyContent: 'center', alignItems: 'center' on its parent frame, " +
          "or proceed with building the remaining sections."
      };
    }
    return { action: "progress" };
  }

  getMetrics(reason: string): OutcomeMetrics {
    return {
      reason,
      turnsUsed: this.turnsUsed,
      corrections: this.corrections,
      toolTally: this.toolTally
    };
  }
}
