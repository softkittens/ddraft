import {
  toApiMessages,
  toResponsesInput,
  toWireReasoningEffort,
  usesMaxCompletionTokens,
  type CompleteOptions,
  type Message,
  type Provider,
  type Tool,
  type ToolCall
} from "./provider";

export async function* parseSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          if (data) yield data;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

export interface StreamDelta {
  content?: string;
  reasoning?: string;
  /**
   * The provider stopped this reply because it ran out of output tokens.
   *
   * Worth its own flag because the shape it arrives in is indistinguishable
   * from a finished answer: no content, no tool calls, the stream simply ends.
   * A reasoning model at high effort can spend the entire budget thinking — one
   * logged run wrote 20,291 characters of reasoning, was cut off mid-word, and
   * emitted nothing, and the session loop read that silence as "done" and
   * shipped four empty screens.
   */
  truncated?: boolean;
  toolCallParts?: {
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
    extra_content?: ToolCall["extra_content"];
  }[];
}

/**
 * Output cap for one reply.
 *
 * Sent explicitly so the ceiling is ours and is the same across providers,
 * rather than whatever default the endpoint happens to apply. Generous: a round
 * is meant to carry several tool calls, and a whole screen subtree in one
 * insert_node is a large argument.
 */
export const MAX_OUTPUT_TOKENS = 16000;

/** This provider's ceiling, or the default when it does not set one. */
export const outputCap = (p: Provider): number => p.maxOutputTokens ?? MAX_OUTPUT_TOKENS;

async function responseError(p: Provider, res: Response): Promise<Error> {
  const text = await res.text();
  let detail = text.slice(0, 250);
  try {
    const json = JSON.parse(text);
    if (json?.error?.message) detail = json.error.message;
    else if (json?.message) detail = json.message;
  } catch {
    // Keep the plain response body.
  }
  if (res.status === 401) {
    return new Error(`${p.id} (401 Unauthorized): ${detail}. Please check your API key in .env or set base URL.`);
  }
  return new Error(`provider ${p.id} ${res.status}: ${detail}`);
}

async function* completeResponsesStream(
  p: Provider,
  messages: Message[],
  tools: Tool[] | undefined,
  opts: CompleteOptions
): AsyncGenerator<StreamDelta> {
  const body: Record<string, unknown> = {
    model: p.model,
    input: toResponsesInput(messages),
    stream: true,
    max_output_tokens: outputCap(p),
    ...(toWireReasoningEffort(p)
      ? { reasoning: { effort: toWireReasoningEffort(p) } }
      : {})
  };
  if (tools?.length) {
    body.tools = tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }

  const res = await (opts.fetch ?? fetch)(`${p.baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify(body),
    signal: opts.signal
  });
  if (!res.ok || !res.body) throw await responseError(p, res);

  const argumentItems = new Set<string>();
  const callIds = new Map<string, string>();
  for await (const data of parseSseData(res.body)) {
    const event = JSON.parse(data) as any;
    if (event.type === "response.output_text.delta") {
      yield { content: event.delta };
      continue;
    }
    if (event.type === "response.reasoning_text.delta" ||
        event.type === "response.reasoning_summary_text.delta") {
      yield { reasoning: event.delta };
      continue;
    }
    if (event.type === "response.function_call_arguments.delta") {
      const key = event.item_id ?? event.call_id;
      argumentItems.add(key);
      yield {
        toolCallParts: [{
          index: event.output_index ?? 0,
          id: event.call_id ?? callIds.get(event.item_id),
          arguments: event.delta
        }]
      };
      continue;
    }
    if (event.type === "response.function_call_arguments.done") {
      const key = event.item_id ?? event.call_id;
      if (!argumentItems.has(key)) {
        argumentItems.add(key);
        yield {
          toolCallParts: [{
            index: event.output_index ?? 0,
            id: event.call_id ?? callIds.get(event.item_id),
            name: event.name,
            arguments: event.arguments
          }]
        };
      }
      continue;
    }
    if ((event.type === "response.output_item.added" || event.type === "response.output_item.done") &&
        event.item?.type === "function_call") {
      const item = event.item;
      const key = item.id ?? item.call_id;
      if (item.id && item.call_id) callIds.set(item.id, item.call_id);
      const argumentsText = argumentItems.has(key) ? undefined : item.arguments;
      if (argumentsText) argumentItems.add(key);
      yield {
        toolCallParts: [{
          index: event.output_index ?? 0,
          id: item.call_id ?? item.id,
          name: item.name,
          arguments: argumentsText
        }]
      };
      continue;
    }
    if (event.type === "response.incomplete" ||
        event.response?.incomplete_details?.reason === "max_output_tokens") {
      yield { truncated: true };
      continue;
    }
    if (event.type === "error" || event.type === "response.failed") {
      const error = event.error ?? event.response?.error;
      throw new Error(error?.message ?? "Responses stream failed");
    }
  }
}

export async function* completeStream(
  p: Provider,
  messages: Message[],
  tools?: Tool[],
  opts: CompleteOptions = {}
): AsyncGenerator<StreamDelta> {
  if (p.api === "responses") {
    yield* completeResponsesStream(p, messages, tools, opts);
    return;
  }

  const fetchImpl = opts.fetch ?? fetch;
  const cap = outputCap(p);

  const body: Record<string, unknown> = {
    model: p.model,
    messages: toApiMessages(messages, p),
    stream: true,
    ...(usesMaxCompletionTokens(p) ? { max_completion_tokens: cap } : { max_tokens: cap }),
    ...(toWireReasoningEffort(p) ? { reasoning_effort: toWireReasoningEffort(p) } : {})
  };
  if (tools && tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
  }

  const res = await fetchImpl(`${p.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${p.apiKey}`
    },
    body: JSON.stringify(body),
    signal: opts.signal
  });
  if (!res.ok || !res.body) {
    throw await responseError(p, res);
  }

  for await (const data of parseSseData(res.body)) {
    const json = JSON.parse(data) as {
      choices?: { finish_reason?: string | null; delta?: { content?: string; reasoning?: string; reasoning_content?: string; thinking?: string; tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
        extra_content?: ToolCall["extra_content"];
      }[] } }[];
    };
    const choice = json.choices?.[0];
    // "length" is the provider saying it cut the reply off. It arrives on the
    // final chunk, whose delta is usually empty, so it has to be read before
    // the delta guard below returns.
    if (choice?.finish_reason === "length") yield { truncated: true };
    const delta = choice?.delta;
    if (!delta) continue;
    const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking;
    const toolCallParts = (delta.tool_calls ?? []).map((c) => ({
      index: c.index,
      id: c.id,
      name: c.function?.name,
      arguments: c.function?.arguments,
      extra_content: c.extra_content
    }));
    yield {
      content: delta.content,
      reasoning: typeof reasoning === "string" ? reasoning : undefined,
      toolCallParts: toolCallParts.length > 0 ? toolCallParts : undefined
    };
  }
}

export function assembleToolCalls(
  parts: StreamDelta["toolCallParts"][],
  existing: ToolCall[] = []
): ToolCall[] {
  const calls: ToolCall[] = existing.map((c) => ({
    id: c.id,
    type: "function" as const,
    function: { name: c.function.name, arguments: c.function.arguments },
    extra_content: c.extra_content
  }));

  let lastActive: ToolCall | null = calls.length > 0 ? calls[calls.length - 1] : null;
  const activeByIndex = new Map<number, ToolCall>();

  for (const group of parts) {
    if (!group) continue;
    for (const part of group) {
      let target: ToolCall | null = null;

      if (part.id) {
        const found = calls.find((c) => c.id === part.id);
        if (found) {
          target = found;
        } else {
          target = {
            id: part.id,
            type: "function" as const,
            function: { name: "", arguments: "" }
          };
          calls.push(target);
        }
        activeByIndex.set(part.index, target);
        lastActive = target;
      } else {
        target = activeByIndex.get(part.index) ?? lastActive;
        if (!target) {
          target = {
            id: `call_${calls.length + 1}`,
            type: "function" as const,
            function: { name: "", arguments: "" }
          };
          calls.push(target);
          activeByIndex.set(part.index, target);
          lastActive = target;
        }
      }

      if (part.name) {
        if (!target.function.name) {
          target.function.name = part.name;
        } else if (target.function.name !== part.name && !target.function.name.endsWith(part.name)) {
          target.function.name += part.name;
        }
      }

      if (part.arguments) {
        target.function.arguments += part.arguments;
      }
      if (part.extra_content) target.extra_content = part.extra_content;
    }
  }

  return calls.filter((c) => c.id || c.function.name);
}
