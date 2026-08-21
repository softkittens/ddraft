import type { Document, ImageFill } from "../model/types";
import { findNode } from "../model/tree";
import { auditDocument, formatAudit } from "../design/evaluator";
import type { Message, Provider, FetchFn } from "./provider";
import { completeStream, assembleToolCalls } from "./stream";
import { TOOL_DEFS, createDocumentTools } from "./tools";
import { withSystemPrompt } from "./prompt";

export type AgentEvent =
  | { type: "delta"; content: string }
  | { type: "tool"; name: string; result: string; doc?: Document }
  | { type: "done"; messages: Message[]; doc: Document }
  | { type: "error"; message: string };

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
                text: `[Selected Canvas Reference Image "${nodeName}" (id: ${node.id})]: The user selected this reference image on the canvas. Analyze its layout, visual style, color palette, and assets to guide your design.`
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

  const maxTurns = opts.maxTurns ?? 10;
  // How many times the audit may push the model back to work before giving up.
  const MAX_CORRECTIONS = 3;
  let corrections = 0;

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

      const toolCalls = assembleToolCalls(partGroups).filter((c) => c.id || c.function.name);
      out.push({
        role: "assistant",
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
      });

      if (toolCalls.length === 0) {
        // The model thinks it is finished. Measure the document and hand back
        // any blocker it left behind. This replaces an earlier loop that sent
        // a rendered screenshot: the server has no font or image rasteriser,
        // so that image was a stack of blank rectangles and the model was
        // being asked to judge a picture of nothing. Numbers name the node.
        const blockers = auditDocument(session.doc).filter(
          (f) => f.severity === "blocker"
        );

        // A document with nothing in it satisfies every rule, so a clean audit
        // is not evidence on its own. Without this, a turn that produced no
        // tool calls at all scores as a perfect run.
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
        break;
      }

      const visionPreviews: { name: string; url: string }[] = [];

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
        const result = await session.execute(call.function.name, parsed);
        out.push({ role: "tool", content: result, tool_call_id: call.id });
        yield { type: "tool", name: call.function.name, result, doc: session.doc };

        // The marker is followed by the url and then, usually, a digest. Take
        // the url only — an earlier version took the rest of the message too,
        // which produced an unfetchable url every time.
        const marker = /\[IMAGE_PREVIEW\]: (\S+)/.exec(typeof result === "string" ? result : "");
        const previewUrl = marker?.[1];
        if (previewUrl && /^(https?:|data:image\/)/.test(previewUrl)) {
          const targetName = (parsed as any)?.nodeId || (parsed as any)?.parentId || "the canvas";
          visionPreviews.push({ name: targetName, url: previewUrl });
        }
      }

      // Images produced by generate_image are real photographs, so showing them
      // back is honest. Renders are not sent: see the note on the gate above.
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
    }
  } catch (err) {
    if (opts.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
      yield { type: "done", messages: sanitizeSessionMessages(out), doc: session.doc };
      return;
    }
    // An error ends the session. This used to fall through to the `done` below,
    // so a run that never reached the provider still reported as finished with
    // an untouched document, and every caller believed it.
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  yield { type: "done", messages: sanitizeSessionMessages(out), doc: session.doc };
}

function sanitizeSessionMessages(msgs: Message[]): Message[] {
  return msgs.filter((m) => {
    if (m.role === "user" && Array.isArray(m.content)) {
      const isInternal = m.content.some(
        (c) =>
          c.type === "text" &&
          (c.text.startsWith("Measured before you finish") ||
            c.text.startsWith("This is the image that was generated"))
      );
      if (isInternal) return false;
    }
    return true;
  });
}
