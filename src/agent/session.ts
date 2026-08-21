import type { Document, ImageFill } from "../model/types";
import { findNode } from "../model/tree";
import { auditDocument, formatAudit } from "../design/evaluator";
import type { Message, Provider, FetchFn } from "./provider";
import { completeStream, assembleToolCalls } from "./stream";
import { TOOL_DEFS, createDocumentTools } from "./tools";
import { withSystemPrompt } from "./prompt";

export type AgentErrorCode = "provider" | "invalid_response" | "budget" | "aborted";
const NO_CANVAS_CHANGE = "[no canvas change]";

export type AgentEvent =
  | { type: "delta"; content: string }
  | { type: "tool"; name: string; result: string; doc?: Document }
  | { type: "done"; messages: Message[]; doc: Document }
  | { type: "error"; message: string; code: AgentErrorCode };

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && (err.name === "AbortError" || err.message === "aborted");
}

function classifyError(err: unknown): AgentErrorCode {
  if (err instanceof SyntaxError) return "invalid_response";
  return "provider";
}

export async function* runSession(
  provider: Provider,
  messages: Message[],
  doc: Document,
  opts: { fetch?: FetchFn; signal?: AbortSignal; maxTurns?: number; selection?: string[] } = {}
): AsyncGenerator<AgentEvent> {
  const session = createDocumentTools(doc);
  const out = withSystemPrompt(messages, doc, opts.selection ?? [], provider.model);

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

  const maxTurns = opts.maxTurns ?? 30;
  const MAX_STALLED_TURNS = 4;
  // How many times the audit may push the model back to work before giving up.
  const MAX_CORRECTIONS = 3;
  let corrections = 0;
  let stalledTurns = 0;
  let previousNoChangeSignature = "";

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      if (opts.signal?.aborted) break;
      let content = "";
      const partGroups: Parameters<typeof assembleToolCalls>[0] = [];

      for await (const delta of completeStream(provider, out, TOOL_DEFS, opts)) {
        if (opts.signal?.aborted) break;
        if (delta.content) {
          content += delta.content;
          yield { type: "delta", content: delta.content };
        }
        if (delta.toolCallParts) partGroups.push(delta.toolCallParts);
      }

      if (opts.signal?.aborted) break;

      const toolCalls = assembleToolCalls(partGroups).filter((c) => c.id || c.function.name);
      out.push({
        role: "assistant",
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      });

      if (toolCalls.length === 0) {
        // A text-only response means the model decided no canvas work was needed.
        // Do not turn ordinary conversation into an unsolicited repair pass.
        const explicitlyNoChange = content.trimEnd().endsWith(NO_CANVAS_CHANGE);
        if (session.doc === doc && (session.doc.children.length > 0 || explicitlyNoChange)) {
          yield { type: "done", messages: sanitizeSessionMessages(out), doc: session.doc };
          return;
        }

        // The model thinks it is finished. Measure the document and hand back
        // any blocker it left behind.
        const blockers = auditDocument(session.doc).filter(
          (f) => f.severity === "blocker"
        );

        // A document with nothing in it satisfies every rule, so a clean audit
        // is not evidence on its own.
        if (session.doc.children.length === 0 && corrections < MAX_CORRECTIONS && turn < maxTurns - 1) {
          corrections += 1;
          out.push({
            role: "user",
            content: [
              {
                type: "text",
                text: "The canvas is still empty — nothing was built. Start with set_style, then build the first screen."
              }
            ]
          });
          continue;
        }

        if (blockers.length > 0 && corrections < MAX_CORRECTIONS && turn < maxTurns - 1) {
          corrections += 1;
          out.push({
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  formatAudit(blockers, "Measured before you finish"),
                  "",
                  "Fix each one with a tool call, then finish. If a fix is not possible,",
                  "say which finding you are leaving and why."
                ].join("\n")
              }
            ]
          });
          continue;
        }
        yield { type: "done", messages: sanitizeSessionMessages(out), doc: session.doc };
        return;
      }

      const roundStart = session.doc;
      const visionPreviews: { name: string; url: string }[] = [];
      let allCallsFailed = true;

      for (const call of toolCalls) {
        if (opts.signal?.aborted) break;
        let parsed: unknown;
        try {
          parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          const result = `error: invalid JSON arguments: ${detail}`;
          out.push({ role: "tool", content: result, tool_call_id: call.id });
          yield { type: "tool", name: call.function.name, result };
          continue;
        }
        const before = session.doc;
        const result = await session.execute(call.function.name, parsed);
        if (!result.startsWith("error:")) allCallsFailed = false;
        const changed = session.doc !== before;
        out.push({ role: "tool", content: result, tool_call_id: call.id });
        yield { type: "tool", name: call.function.name, result, doc: changed ? session.doc : undefined };

        // The marker is followed by the url and then, usually, a digest. Take
        // the url only.
        const marker = /\[IMAGE_PREVIEW\]: (\S+)/.exec(typeof result === "string" ? result : "");
        const previewUrl = marker?.[1];
        if (previewUrl && /^(https?:|data:image\/)/.test(previewUrl)) {
          const targetName = (parsed as any)?.nodeId || (parsed as any)?.parentId || "the canvas";
          visionPreviews.push({ name: targetName, url: previewUrl });
        }
      }

      if (opts.signal?.aborted) break;

      // Images produced by generate_image are real photographs, so showing them back is honest.
      for (const prev of visionPreviews) {
        out.push({
          role: "user",
          content: [
            {
              type: "text",
              text: `This is the image that was generated and placed on "${prev.name}". If it does not match the brief, call generate_image again with a more specific prompt. Otherwise carry on.`
            },
            {
              type: "image_url",
              image_url: { url: prev.url, detail: "low" }
            }
          ]
        });
      }

      if (session.doc === roundStart && visionPreviews.length === 0) {
        const signature = toolCalls
          .map((call) => `${call.function.name}:${call.function.arguments}`)
          .join("|");
        stalledTurns = allCallsFailed || signature === previousNoChangeSignature
          ? stalledTurns + 1
          : 0;
        previousNoChangeSignature = signature;
        if (stalledTurns >= MAX_STALLED_TURNS) {
          yield {
            type: "error",
            code: "budget",
            message: `Agent stopped after ${stalledTurns} tool rounds made no canvas progress. Partial design was kept.`
          };
          return;
        }
      } else {
        stalledTurns = 0;
        previousNoChangeSignature = "";
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

  yield {
    type: "error",
    code: "budget",
    message: `Emergency limit reached after ${maxTurns} model rounds. Partial design was kept.`
  };
}

function sanitizeSessionMessages(msgs: Message[]): Message[] {
  return msgs.filter((m) => {
    if (m.role === "user" && Array.isArray(m.content)) {
      const isInternal = m.content.some(
        (c) =>
          c.type === "text" &&
          (c.text.startsWith("Measured before you finish") ||
            c.text.startsWith("This is the image that was generated") ||
            c.text.startsWith("The canvas is still empty"))
      );
      if (isInternal) return false;
    }
    return true;
  }).map((m) => m.role === "assistant" && typeof m.content === "string"
    ? { ...m, content: m.content.replace(/\s*\[no canvas change\]\s*$/, "") }
    : m);
}
