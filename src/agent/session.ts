import type { Document, ImageFill } from "../model/types";
import { findNode, walkNodes } from "../model/tree";
import { auditDocument, formatAudit, FINISHING_RULES } from "../design/evaluator";
import { digest } from "../digest/digest";
import type { Message, Provider, FetchFn, Tool } from "./provider";
import { completeStream, assembleToolCalls } from "./stream";
import { TOOL_DEFS, createDocumentTools } from "./tools";
import { withSystemPrompt, MAX_MODEL_ROUNDS } from "./prompt";
import type { StyleRun } from "../design/history";

export type AgentErrorCode = "provider" | "invalid_response" | "budget" | "aborted";

export type AgentTrace = (event: Record<string, unknown>) => void;

const ANSWER_USER_TOOL: Tool = {
  name: "answer_user",
  description: "Reply to a request that does not require changing the canvas. Never combine this with canvas tools.",
  parameters: {
    type: "object",
    properties: { reply: { type: "string", description: "The complete reply to show the user" } },
    required: ["reply"]
  }
};

const SESSION_TOOLS = [ANSWER_USER_TOOL, ...TOOL_DEFS];

export type AgentEvent =
  | { type: "status"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "delta"; content: string }
  | { type: "tool_start"; name: string; detail?: string }
  | { type: "tool"; name: string; result: string; doc?: Document }
  | { type: "done"; messages: Message[]; doc: Document }
  | { type: "error"; message: string; code: AgentErrorCode };

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && (err.name === "AbortError" || err.message === "aborted");
}

/**
 * The one line worth showing while a tool is still running.
 *
 * Most tools return before anyone could read a label. generate_image does not —
 * it holds the run for the length of an image call with nothing on screen, so
 * the panel showed a finished summary and then a dead chat for minutes. What it
 * is drawing is the only detail that makes the wait legible.
 */
function toolDetail(name: string, args: unknown): string | undefined {
  const bag = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  if (name === "generate_image" && typeof bag.prompt === "string") return bag.prompt;
  if (name === "search_icons" && typeof bag.query === "string") return bag.query;
  return undefined;
}

function classifyError(err: unknown): AgentErrorCode {
  if (err instanceof SyntaxError) return "invalid_response";
  return "provider";
}

function trace(callback: AgentTrace | undefined, event: Record<string, unknown>) {
  try {
    callback?.(event);
  } catch {
    // Diagnostics must never change the run they are observing.
  }
}

export async function* runSession(
  provider: Provider,
  messages: Message[],
  doc: Document,
  opts: {
    fetch?: FetchFn;
    signal?: AbortSignal;
    maxTurns?: number;
    selection?: string[];
    /** What the last few runs chose, so the model can avoid repeating itself. */
    recentStyles?: readonly StyleRun[];
    trace?: AgentTrace;
  } = {}
): AsyncGenerator<AgentEvent> {
  const session = createDocumentTools(doc, {
    providerId: provider.id,
    apiKey: provider.apiKey,
    fetch: opts.fetch
  });
  const out = withSystemPrompt(messages, doc, opts.selection ?? [], provider.model, opts.recentStyles ?? []);

  // If the user selected any node with a reference image, attach it for vision models!
  if (opts.selection && opts.selection.length > 0) {
    for (const selId of opts.selection) {
      const node = findNode(doc.children, selId);
      if (node) {
        const fillAny = (node as any).fill;
        const imgFill = Array.isArray(fillAny)
          ? (fillAny.find((f: any) => f?.type === "image") as ImageFill | undefined)
          : fillAny?.type === "image"
          ? (fillAny as ImageFill)
          : undefined;

        if (imgFill && (imgFill.url || imgFill.data)) {
          const imgUrl = imgFill.url || imgFill.data!;
          const nodeName = node.name || node.id;
          out.push({
            role: "user",
            content: [
              {
                type: "text",
                text: `[Selected Canvas Reference Image "${nodeName}" (id: ${node.id})]: Context for the user's request. Use it only when relevant.`
              },
              {
                type: "image_url",
                image_url: { url: imgUrl, detail: "high" }
              }
            ]
          });
        }
      }
    }
  }

  trace(opts.trace, { type: "prompt", messages: out, tools: SESSION_TOOLS });

  /**
   * How much of the conversation has already been written to the trace.
   *
   * model_request used to log the whole message array every turn, so turn 65
   * re-recorded turns 1 through 64. One three-run log came to 7.1MB, of which
   * model_request was 6.7MB — 92.6% of the file was the same text written
   * again. Logging only what is new since the last turn keeps the trace
   * readable and still reconstructs the full array by concatenation.
   */
  let tracedMessages = out.length;
  /** What the run spent its budget on, reported at the end. */
  const toolTally = new Map<string, number>();
  let turnsUsed = 0;

  /**
   * What the run produced, written once at the end.
   *
   * session_done and session_end used to carry a timestamp and nothing else,
   * so the single most useful moment in a trace — what was actually on the
   * canvas when the model stopped — could not be read back at all. Answering
   * "did this run go well" meant replaying every tool call by hand.
   */
  const traceOutcome = (reason: string) => {
    const findings = auditDocument(session.doc);
    let nodes = 0;
    walkNodes(session.doc.children, () => { nodes += 1; });
    trace(opts.trace, {
      type: "outcome",
      reason,
      turnsUsed,
      screens: session.doc.children.length,
      nodes,
      corrections,
      toolCalls: Object.fromEntries(
        [...toolTally.entries()].sort((a, b) => b[1] - a[1])
      ),
      blockers: findings.filter((f) => f.severity === "blocker").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      infos: findings.filter((f) => f.severity === "info").length,
      rules: [...new Set(findings.map((f) => f.rule))].sort(),
      // The findings themselves, not only how many. A count says a run had four
      // warnings; the messages say which four, on which node, with the measured
      // numbers — the difference between knowing a run went badly and knowing
      // what to change.
      findings: findings
        .filter((f) => f.severity !== "info")
        .slice(0, 20)
        .map((f) => `[${f.severity}] ${f.rule} ${f.nodeId}: ${f.message}`),
      // What was actually on the canvas. Without it a trace could say a run
      // finished with no blockers and still leave no way to see that a heading
      // was sitting under a photograph.
      digest: digest(session.doc)
    });
  };

  const maxTurns = opts.maxTurns ?? MAX_MODEL_ROUNDS;
  const MAX_STALLED_TURNS = 4;
  /** Rounds left when the model is told to land what it has and stop. */
  const WRAP_UP_ROUNDS = 3;
  /**
   * Tools that answer a question instead of changing the canvas. Looking an
   * icon up is work, and a round spent on it is not a stalled round — reading
   * every non-mutating round as a stall killed runs four icon searches into a
   * brief, before the model had drawn anything at all.
   */
  const READ_ONLY_TOOLS = new Set(["read_digest", "measure", "search_icons"]);
  /** Research still has to end. Enough rounds to look things up, not to browse. */
  const MAX_RESEARCH_TURNS = 6;
  // How many times the audit may push the model back to work before giving up.
  const MAX_CORRECTIONS = 3;
  let corrections = 0;
  let stalledTurns = 0;
  let researchTurns = 0;
  let wrappingUp = false;

  /** Messages this loop injected, dropped from the transcript it hands back. */
  const internal = new Set<Message>();
  const nudge = (text: string) => {
    const message: Message = { role: "user", content: [{ type: "text", text }] };
    internal.add(message);
    out.push(message);
  };

  const nodeCount = (d: Document): number => {
    let n = 0;
    walkNodes(d.children, () => { n += 1; });
    return n;
  };

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      if (opts.signal?.aborted) break;
      turnsUsed = turn + 1;

      // The run used to end mid-change: the ceiling fell one call into a
      // three-call rearrangement and kept the half of it that had landed, so
      // the screen the model was repairing was left worse than before it
      // started. It has no way to feel the budget draining — say it, while
      // there are still enough rounds to finish a thought.
      if (!wrappingUp && turn >= maxTurns - WRAP_UP_ROUNDS && session.doc.children.length > 0) {
        wrappingUp = true;
        nudge(
          `${maxTurns - turn} rounds left. Land what is on the canvas: finish the screen ` +
            "you are part-way through, then stop. Nothing is discarded when the rounds " +
            "run out — whatever state a node is in is the state it keeps — so do not " +
            "start a change you cannot finish in this many replies."
        );
      }

      trace(opts.trace, {
        type: "model_request",
        turn: turn + 1,
        totalMessages: out.length,
        // Only the messages added since the previous turn.
        appended: out.slice(tracedMessages)
      });
      tracedMessages = out.length;
      yield { type: "status", content: `${provider.model} is thinking…` };
      let content = "";
      let reasoning = "";
      const partGroups: Parameters<typeof assembleToolCalls>[0] = [];

      for await (const delta of completeStream(provider, out, SESSION_TOOLS, opts)) {
        if (opts.signal?.aborted) break;
        if (delta.reasoning) {
          reasoning += delta.reasoning;
          trace(opts.trace, { type: "reasoning_delta", turn: turn + 1, content: delta.reasoning });
          yield { type: "reasoning", content: delta.reasoning };
        }
        if (delta.content) {
          content += delta.content;
          trace(opts.trace, { type: "assistant_delta", turn: turn + 1, content: delta.content });
          yield { type: "delta", content: delta.content };
        }
        if (delta.toolCallParts) partGroups.push(delta.toolCallParts);
      }

      if (opts.signal?.aborted) break;

      const toolCalls = assembleToolCalls(partGroups).filter((c) => c.id || c.function.name);
      trace(opts.trace, {
        type: "model_response",
        turn: turn + 1,
        reasoning,
        content,
        toolCalls
      });
      out.push({
        role: "assistant",
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      });

      const answerCall = toolCalls.find((call) => call.function.name === ANSWER_USER_TOOL.name);
      if (answerCall) {
        let reply = "";
        try {
          const args = answerCall.function.arguments ? JSON.parse(answerCall.function.arguments) : {};
          if (typeof args.reply === "string") reply = args.reply.trim();
        } catch {
          // The model gets one ordinary tool error and can retry with valid JSON.
        }

        if (toolCalls.length === 1 && reply) {
          out[out.length - 1] = { role: "assistant", content: reply };
          traceOutcome("answered without designing");
          yield { type: "delta", content: reply };
          yield { type: "done", messages: sanitizeSessionMessages(out, internal), doc: session.doc };
          return;
        }

        const result = toolCalls.length === 1
          ? "error: reply must be a non-empty string"
          : "error: answer_user cannot be combined with canvas tools";
        out[out.length - 1] = { role: "assistant", content, tool_calls: [answerCall] };
        out.push({ role: "tool", content: result, tool_call_id: answerCall.id });
        continue;
      }

      if (toolCalls.length === 0) {
        if (session.doc === doc && session.doc.children.length > 0) {
          traceOutcome("model finished");
          yield { type: "done", messages: sanitizeSessionMessages(out, internal), doc: session.doc };
          return;
        }

        // The model thinks it is finished. Measure the document and hand back
        // what it left behind — the things that are broken, and the things that
        // are merely unbuilt. Both only mean something now: a screen halfway
        // through construction fails the second set by definition, which is why
        // they are not reported at the call that writes them.
        const unfinished = auditDocument(session.doc).filter(
          (f) => f.severity === "blocker" || FINISHING_RULES.has(f.rule)
        );

        // A document with nothing in it satisfies every rule, so a clean audit
        // is not evidence on its own.
        if (session.doc.children.length === 0 && corrections < MAX_CORRECTIONS && turn < maxTurns - 1) {
          corrections += 1;
          // This reply did not follow either completion path, so it is
          // provisional. Keep only the classified reply from the retry.
          out.pop();
          nudge(
            "The canvas is still empty. Decide again: if the request requires design " +
              "work, use canvas tools; otherwise call answer_user. Do not build merely " +
              "because the canvas is empty."
          );
          continue;
        }

        if (unfinished.length > 0 && corrections < MAX_CORRECTIONS && turn < maxTurns - 1) {
          corrections += 1;
          nudge([
            formatAudit(unfinished, "Measured before you finish"),
            "",
            "Fix each one with a tool call, then finish. If a node resists two",
            "attempts, delete it and rebuild it correctly rather than nudging it",
            "again. If a fix is not possible, say which finding you are leaving",
            "and why."
          ].join("\n"));
          continue;
        }
        traceOutcome("model finished");
        yield { type: "done", messages: sanitizeSessionMessages(out, internal), doc: session.doc };
        return;
      }

      const roundStart = session.doc;
      const nodesAtStart = nodeCount(session.doc);

      for (const call of toolCalls) {
        if (opts.signal?.aborted) break;
        toolTally.set(call.function.name, (toolTally.get(call.function.name) ?? 0) + 1);
        trace(opts.trace, {
          type: "tool_call",
          turn: turn + 1,
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments
        });
        let parsed: unknown;
        try {
          parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          const result = `error: invalid JSON arguments: ${detail}`;
          trace(opts.trace, { type: "tool_result", turn: turn + 1, id: call.id, name: call.function.name, result });
          out.push({ role: "tool", content: result, tool_call_id: call.id });
          yield { type: "tool", name: call.function.name, result };
          continue;
        }
        const before = session.doc;
        yield { type: "tool_start", name: call.function.name, detail: toolDetail(call.function.name, parsed) };
        const result = await session.execute(call.function.name, parsed);
        const changed = session.doc !== before;
        trace(opts.trace, {
          type: "tool_result",
          turn: turn + 1,
          id: call.id,
          name: call.function.name,
          changed,
          result
        });
        out.push({ role: "tool", content: result, tool_call_id: call.id });
        yield { type: "tool", name: call.function.name, result, doc: changed ? session.doc : undefined };
      }

      if (opts.signal?.aborted) break;

      // Slots this round put back to a value they already held. The tools keep
      // the history, because they are what does the writing.
      const revisited = session.drainRevisits();
      const built = nodeCount(session.doc) > nodesAtStart;

      if (session.doc !== roundStart && (built || revisited.length === 0)) {
        stalledTurns = 0;
        researchTurns = 0;
      } else if (revisited.length > 0) {
        // A round whose only effect was to put something back the way it
        // already was. The document changed, so the test below would call this
        // progress; it is the opposite, and it is what a run burns its budget
        // on. The tools already say so in their results and it did not stop a
        // run from spending nine rounds this way — advice is refusable, a stall
        // budget is not.
        stalledTurns += 1;
        if (stalledTurns >= MAX_STALLED_TURNS) {
          traceOutcome("thrashing");
          yield {
            type: "error",
            code: "budget",
            message: `Agent stopped after ${stalledTurns} rounds spent undoing its own edits. Partial design was kept.`
          };
          return;
        }
        nudge([
          "Measured across this run — these are back to values they already held:",
          ...revisited.map(({ key, values }) => `  ${key}: ${values.join(" → ")}`),
          "",
          "The canvas is where it was several rounds ago and those rounds are gone.",
          "Stop adjusting these nodes. If the arrangement is wrong, delete the",
          "container and insert it once, built the way you want it. Otherwise leave",
          "it and spend what is left on the screens that are still unfinished."
        ].join("\n"));
        continue;
      } else if (toolCalls.every((c) => READ_ONLY_TOOLS.has(c.function.name))) {
        // Reading, not stalling. Budgeted separately, and when it runs out the
        // model is sent back to work rather than killed — it has the answers it
        // went looking for, so ending the run here would throw them away.
        researchTurns += 1;
        if (researchTurns >= MAX_RESEARCH_TURNS) {
          researchTurns = 0;
          nudge(
            "That is enough looking things up. Build with what you have now: any icon " +
              "name you could not confirm can be replaced later, and an unfinished screen " +
              "is worth more than another search."
          );
          continue;
        }
      } else {
        // A round that tried to change the canvas and changed nothing. That is
        // the real stall: a rejected edit, a bad id, a tool erroring in a loop.
        stalledTurns += 1;
        if (stalledTurns >= MAX_STALLED_TURNS) {
          traceOutcome("stalled");
          yield {
            type: "error",
            code: "budget",
            message: `Agent stopped after ${stalledTurns} tool rounds made no canvas progress. Partial design was kept.`
          };
          return;
        }
      }
    }
  } catch (err) {
    if (isAbortError(err, opts.signal)) {
      yield { type: "error", code: "aborted", message: err instanceof Error ? err.message : "aborted" };
      return;
    }
    yield {
      type: "error",
      code: classifyError(err),
      message: err instanceof Error ? err.message : String(err)
    };
    return;
  }

  if (opts.signal?.aborted) {
    yield { type: "error", code: "aborted", message: "aborted" };
    return;
  }

  // Not "Emergency limit reached". The run was warned three rounds out, the
  // canvas is kept exactly as the last call left it, and asking again carries
  // on from there — three facts the old wording denied while showing the user
  // a red provider error for a budget that worked as designed.
  traceOutcome("turn limit");
  yield {
    type: "error",
    code: "budget",
    message: `The ${maxTurns}-round budget is spent. Everything built is kept — say what to finish and the next run continues from here.`
  };
}

/**
 * The transcript without the loop's own prompting.
 *
 * Corrections, nudges and the wrap-up warning are addressed to the model and
 * written by this file; a saved session that replayed them would show the user
 * telling themselves to stop looking things up. They used to be recognised by
 * the first words of each one, which is a list that drifts: it still carried a
 * prefix for a message nothing sends any more, and never carried one for the
 * research nudge, which has been leaking into saved sessions the whole time.
 * Identity cannot drift — these are the same objects the loop pushed.
 */
function sanitizeSessionMessages(msgs: Message[], internal: ReadonlySet<Message>): Message[] {
  return msgs.filter((m) => !internal.has(m));
}
