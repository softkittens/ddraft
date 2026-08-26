import type { Document, ImageFill } from "../model/types";
import { findNode } from "../model/tree";
import { stepDownEffort, type Message, type Provider, type FetchFn, type Tool } from "./provider";
import { completeStream, assembleToolCalls } from "./stream";
import { TOOL_DEFS, createDocumentTools } from "./tools";
import { pageScopedDocument } from "../model/pages";
import { withSystemPrompt, extractUserPrompts, MAX_MODEL_ROUNDS } from "./prompt";
import { resolvePromptContext } from "./context";
import type { StyleRun } from "../design/history";
import {
  SessionWatchdog,
  recordOutcome,
  trace,
  nodeCount,
  type AgentTrace
} from "./watchdog";

export type AgentErrorCode = "provider" | "invalid_response" | "budget" | "aborted";
export type { AgentTrace };

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
  | { type: "error"; message: string; code: AgentErrorCode; messages?: Message[]; doc?: Document };

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal) return signal.aborted;
  return err instanceof Error && (err.name === "AbortError" || err.message === "aborted");
}

/** Dropped sockets and 5xx are worth another try. 4xx (including 429 "no access") is a real refusal. */
export function isTransientProviderError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b4\d\d\b/.test(msg) || /invalid argument|no access to this model/i.test(msg)) return false;
  return /ECONNRESET|ETIMEDOUT|ECONNREFUSED|connection was closed|socket|network|\b(502|503|504)\b/i.test(msg);
}

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

function sanitizeSessionMessages(msgs: Message[], internal: ReadonlySet<Message>): Message[] {
  return msgs.filter((m) => !internal.has(m));
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
    recentStyles?: readonly StyleRun[];
    /** The page this run works on. Undefined means the whole document. */
    pageId?: string;
    trace?: AgentTrace;
  } = {}
): AsyncGenerator<AgentEvent> {
  const promptDoc = pageScopedDocument(doc, opts.pageId);
  const { latest, all } = extractUserPrompts(messages);
  const resolved = resolvePromptContext(latest, promptDoc, opts.selection ?? [], all);

  const session = createDocumentTools(doc, {
    providerId: provider.id,
    apiKey: provider.apiKey,
    fetch: opts.fetch
  }, opts.pageId, resolved.archetype);
  const maxTurns = opts.maxTurns ?? MAX_MODEL_ROUNDS;
  const out = withSystemPrompt(
    messages,
    promptDoc,
    opts.selection ?? [],
    provider.model,
    opts.recentStyles ?? [],
    maxTurns
  );

  // Attach canvas reference image if selected
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
          const rawUrl = imgFill.url || imgFill.data!;
          const nodeName = node.name || node.id;
          const isFullUrl = /^https?:\/\//i.test(rawUrl);
          const isDataUrl = /^data:image\//i.test(rawUrl);
          const isBase64 = Boolean(imgFill.data && !imgFill.url && /^[A-Za-z0-9+/=]+$/.test(imgFill.data));
          const validUrl = isFullUrl || isDataUrl
            ? rawUrl
            : isBase64
            ? `data:image/png;base64,${imgFill.data}`
            : null;

          if (validUrl) {
            out.push({
              role: "user",
              content: [
                {
                  type: "text",
                  text: `[Selected Canvas Reference Image "${nodeName}" (id: ${node.id})]: Context for the user's request. Use it only when relevant.`
                },
                { type: "image_url", image_url: { url: validUrl, detail: "high" } }
              ]
            });
          } else {
            out.push({
              role: "user",
              content: [
                {
                  type: "text",
                  text: `[Selected Canvas Image Node "${nodeName}" (id: ${node.id}, fill src: "${rawUrl}")]: Context for the user's request.`
                }
              ]
            });
          }
        }
      }
    }
  }

  trace(opts.trace, { type: "prompt", messages: out, tools: SESSION_TOOLS });

  let tracedMessages = out.length;
  const watchdog = new SessionWatchdog();
  const internal = new Set<Message>();

  let currentProvider: Provider = provider;

  const nudge = (text: string) => {
    const message: Message = { role: "user", content: [{ type: "text", text }] };
    internal.add(message);
    out.push(message);
  };

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      if (opts.signal?.aborted) break;

      watchdog.turnsUsed = turn + 1;

      const wrapUpMsg = watchdog.checkWrapUp(turn, maxTurns, session.doc.children.length);
      if (wrapUpMsg) nudge(wrapUpMsg);

      trace(opts.trace, {
        type: "model_request",
        turn: turn + 1,
        totalMessages: out.length,
        appended: out.slice(tracedMessages)
      });
      tracedMessages = out.length;
      yield { type: "status", content: `${provider.model} is thinking…` };

      let turnCompleted = false;
      let retriesLeft = 2;
      let content = "";
      let reasoning = "";
      let truncated = false;
      let partGroups: Parameters<typeof assembleToolCalls>[0] = [];

      while (!turnCompleted && retriesLeft >= 0) {
        if (opts.signal?.aborted) break;

        content = "";
        reasoning = "";
        truncated = false;
        partGroups = [];

        try {
          for await (const delta of completeStream(currentProvider, out, SESSION_TOOLS, opts)) {
            if (opts.signal?.aborted) break;
            if (delta.truncated) truncated = true;
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
          turnCompleted = true;
        } catch (streamErr) {
          if (opts.signal?.aborted) throw streamErr;
          if (!isTransientProviderError(streamErr)) throw streamErr;
          retriesLeft--;
          if (retriesLeft < 0) throw streamErr;

          const lowered = stepDownEffort(currentProvider.reasoningEffort);
          console.warn(`[ddraft-agent] Upstream connection dropped on Turn ${turn + 1}. Retrying (${retriesLeft} left, stepping down effort from ${currentProvider.reasoningEffort ?? "default"} to ${lowered})...`);
          currentProvider = { ...currentProvider, reasoningEffort: lowered };
          trace(opts.trace, { type: "effort_step_down", turn: turn + 1, reasoningEffort: lowered });
          yield { type: "status", content: `Reconnecting ${provider.model}…` };
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
      }

      if (opts.signal?.aborted) break;

      const toolCalls = assembleToolCalls(partGroups).filter((c) => c.id || c.function.name);
      trace(opts.trace, { type: "model_response", turn: turn + 1, reasoning, content, toolCalls, truncated });
      out.push({ role: "assistant", content, tool_calls: toolCalls.length > 0 ? toolCalls : undefined });

      if (truncated && toolCalls.length === 0) {
        const evalRes = watchdog.evaluateTruncation(turn, maxTurns);
        if (evalRes.action === "error") {
          recordOutcome(opts.trace, session.doc, watchdog.getMetrics(evalRes.reason));
          yield { type: "error", code: "budget", message: evalRes.message };
          return;
        }
        out.pop();
        const lowered = stepDownEffort(currentProvider.reasoningEffort);
        if (lowered !== currentProvider.reasoningEffort) {
          currentProvider = { ...currentProvider, reasoningEffort: lowered };
          trace(opts.trace, { type: "effort_step_down", turn: turn + 1, reasoningEffort: lowered });
        }
        if (evalRes.action === "nudge") nudge(evalRes.text);
        continue;
      }

      // 1. Handle answer_user conversational reply
      const answerCall = toolCalls.find((call) => call.function.name === ANSWER_USER_TOOL.name);
      if (answerCall) {
        let reply = "";
        try {
          const args = answerCall.function.arguments ? JSON.parse(answerCall.function.arguments) : {};
          if (typeof args.reply === "string") reply = args.reply.trim();
        } catch {}

        if (toolCalls.length === 1 && reply) {
          out[out.length - 1] = { role: "assistant", content: reply };
          // An empty canvas plus answer_user is a chat reply. A canvas this
          // session already changed is a wrap-up: 1d2d9f50 built 159 nodes,
          // then called this, and the loop recorded "answered without designing"
          // while 33 blockers sat on the canvas.
          if (session.doc === doc) {
            recordOutcome(opts.trace, session.pageDoc, watchdog.getMetrics("answered without designing"));
            yield { type: "delta", content: reply };
            yield { type: "done", messages: sanitizeSessionMessages(out, internal), doc: session.doc };
            return;
          }
          const evalRes = watchdog.evaluateCompletion(session.pageDoc, turn, maxTurns, false, reply, resolved.lifecycle);
          if (evalRes.action === "retry_empty") {
            out.pop();
            nudge(evalRes.nudge);
            continue;
          }
          if (evalRes.action === "correct_unfinished") {
            nudge(evalRes.nudge);
            continue;
          }
          recordOutcome(opts.trace, session.pageDoc, watchdog.getMetrics("model finished"));
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

      // 2. Handle completion when model makes no tool calls
      if (toolCalls.length === 0) {
        const evalRes = watchdog.evaluateCompletion(
          session.pageDoc,
          turn,
          maxTurns,
          session.doc === doc,
          content,
          resolved.lifecycle
        );
        if (evalRes.action === "retry_empty") {
          out.pop();
          nudge(evalRes.nudge);
          continue;
        }
        if (evalRes.action === "correct_unfinished") {
          nudge(evalRes.nudge);
          continue;
        }

        recordOutcome(opts.trace, session.pageDoc, watchdog.getMetrics("model finished"));
        yield { type: "done", messages: sanitizeSessionMessages(out, internal), doc: session.doc };
        return;
      }

      // 3. Execute tool calls
      const roundStart = session.doc;
      const nodesAtStart = nodeCount(session.doc);

      for (const call of toolCalls) {
        if (opts.signal?.aborted) break;
        watchdog.recordTool(call.function.name);
        trace(opts.trace, { type: "tool_call", turn: turn + 1, id: call.id, name: call.function.name, arguments: call.function.arguments });

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
        trace(opts.trace, { type: "tool_result", turn: turn + 1, id: call.id, name: call.function.name, changed, result });
        out.push({ role: "tool", content: result, tool_call_id: call.id });
        yield { type: "tool", name: call.function.name, result, doc: changed ? session.doc : undefined };
      }

      if (opts.signal?.aborted) break;

      // 4. Watchdog turn progress evaluation (stalls & oscillation prevention)
      const turnEval = watchdog.evaluateTurnProgress({
        docBefore: roundStart,
        docAfter: session.doc,
        nodesAtStart,
        toolCalls,
        revisited: session.drainRevisits()
      });

      if (turnEval.action === "error") {
        recordOutcome(opts.trace, session.doc, watchdog.getMetrics(turnEval.reason));
        yield {
          type: "error",
          code: "budget",
          message: turnEval.message,
          messages: sanitizeSessionMessages(out, internal),
          doc: session.doc
        };
        return;
      }

      if (turnEval.action === "nudge") {
        nudge(turnEval.text);
        continue;
      }
    }
  } catch (err) {
    if (isAbortError(err, opts.signal)) {
      yield {
        type: "error",
        code: "aborted",
        message: err instanceof Error ? err.message : "aborted",
        messages: sanitizeSessionMessages(out, internal),
        doc: session.doc
      };
      return;
    }
    yield {
      type: "error",
      code: classifyError(err),
      message: err instanceof Error ? err.message : String(err),
      messages: sanitizeSessionMessages(out, internal),
      doc: session.doc
    };
    return;
  }

  if (opts.signal?.aborted) {
    yield {
      type: "error",
      code: "aborted",
      message: "aborted",
      messages: sanitizeSessionMessages(out, internal),
      doc: session.doc
    };
    return;
  }

  /*
   * Running out of rounds on a document the audit passes is not a failure.
   *
   * One logged run built a 144-node dashboard, one screen, zero blockers — and
   * ended on a yellow budget-error box, because the loop reports the reason it
   * stopped rather than what it produced. The round cap is a cost ceiling; it
   * says nothing about whether the work is done, and the finishing audit
   * already answers that question.
   */
  if (session.doc.children.length > 0) {
    recordOutcome(opts.trace, session.doc, watchdog.getMetrics("session completed"));
    yield { type: "done", messages: sanitizeSessionMessages(out, internal), doc: session.doc };
    return;
  }

  recordOutcome(opts.trace, session.doc, watchdog.getMetrics("turn limit empty"));
  yield {
    type: "error",
    code: "budget",
    message: "No screens were placed on the canvas. Please provide a brief describing what you would like to design."
  };
}
