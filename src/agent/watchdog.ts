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
export const WRAP_UP_ROUNDS = 3;
export const MAX_RESEARCH_TURNS = 4;
export const MAX_CORRECTIONS = 3;

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

export type CompletionEvaluation =
  | { action: "finish" }
  | { action: "retry_empty"; nudge: string }
  | { action: "correct_unfinished"; nudge: string };

export type TurnEvaluation =
  | { action: "progress" }
  | { action: "nudge"; text: string }
  | { action: "error"; reason: "thrashing" | "stalled" | "truncated"; message: string };

export class SessionWatchdog {
  turnsUsed = 0;
  corrections = 0;
  stalledTurns = 0;
  researchTurns = 0;
  truncations = 0;
  /** Rounds spent asking again for a design the model answered with prose. */
  emptyReplies = 0;
  wrappingUp = false;
  toolTally = new Map<string, number>();

  recordTool(name: string): void {
    this.toolTally.set(name, (this.toolTally.get(name) ?? 0) + 1);
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

  checkWrapUp(turn: number, maxTurns: number, screenCount: number): string | null {
    if (!this.wrappingUp && turn >= maxTurns - WRAP_UP_ROUNDS && screenCount > 0) {
      this.wrappingUp = true;
      return (
        `${maxTurns - turn} rounds left. Land what is on the canvas: finish the screen ` +
        "you are part-way through, then stop. Nothing is discarded when the rounds " +
        "run out — whatever state a node is in is the state it keeps — so do not " +
        "start a change you cannot finish in this many replies."
      );
    }
    return null;
  }

  evaluateCompletion(
    doc: Document,
    turn: number,
    maxTurns: number,
    docUnchanged: boolean,
    replyText = ""
  ): CompletionEvaluation {
    if (docUnchanged && doc.children.length > 0) {
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

    const unfinished = auditDocument(doc).filter(
      (f) => f.severity === "blocker" || FINISHING_RULES.has(f.rule)
    );

    if (unfinished.length > 0 && this.corrections < MAX_CORRECTIONS && turn < maxTurns - 1) {
      this.corrections += 1;
      return {
        action: "correct_unfinished",
        nudge: [
          formatAudit(unfinished, "Measured before you finish"),
          "",
          "Fix each one with a tool call, then finish. If a node resists two",
          "attempts, delete it and rebuild it correctly rather than nudging it",
          "again. If a fix is not possible, say which finding you are leaving",
          "and why."
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
    const built = nodeCount(docAfter) > nodesAtStart;

    if (docAfter !== docBefore && (built || revisited.length === 0)) {
      this.stalledTurns = 0;
      this.researchTurns = 0;
      return { action: "progress" };
    }

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
          "Stop adjusting these nodes. If the arrangement is wrong, delete the",
          "container and insert it once, built the way you want it. Otherwise leave",
          "it and spend what is left on the screens that are still unfinished."
        ].join("\n")
      };
    }

    if (toolCalls.every((c) => READ_ONLY_TOOLS.has(c.function.name))) {
      this.researchTurns += 1;
      if (this.researchTurns >= MAX_RESEARCH_TURNS) {
        this.researchTurns = 0;
        return {
          action: "nudge",
          text:
            "That is enough looking things up and measuring. Build with auto-layout " +
            "(fill_container, fit_content, gap, padding): dimensions resolve automatically, " +
            "and an unfinished screen is worth more than another inspection."
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
