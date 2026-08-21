import type { CompleteOptions, Message, Provider, Tool, ToolCall } from "./provider";

export async function* parseSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
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
}

export interface StreamDelta {
  content?: string;
  toolCallParts?: { index: number; id?: string; name?: string; arguments?: string }[];
}

function toApiMessages(messages: Message[], p?: Provider) {
  const isVisionCapable = p?.id === "openai" || p?.model?.includes("gpt-4o") || p?.model?.includes("vl");
  return messages.map((m) => {
    let content = m.content;
    if (Array.isArray(content) && !isVisionCapable) {
      content = content
        .filter((c) => c.type === "text")
        .map((c) => (c as { type: "text"; text: string }).text)
        .join("\n");
    }
    const row: Record<string, unknown> = { role: m.role, content };
    if (m.tool_calls) row.tool_calls = m.tool_calls;
    if (m.tool_call_id) row.tool_call_id = m.tool_call_id;
    return row;
  });
}

export async function* completeStream(
  p: Provider,
  messages: Message[],
  tools?: Tool[],
  opts: CompleteOptions = {}
): AsyncGenerator<StreamDelta> {
  const fetchImpl = opts.fetch ?? fetch;
  const body: Record<string, unknown> = {
    model: p.model,
    messages: toApiMessages(messages, p),
    stream: true,
    ...(p.reasoningEffort ? { reasoning_effort: p.reasoningEffort } : {})
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
    const text = await res.text();
    let detail = text.slice(0, 250);
    try {
      const errJson = JSON.parse(text);
      if (errJson?.error?.message) detail = errJson.error.message;
      else if (errJson?.message) detail = errJson.message;
    } catch {
      // ignore
    }
    if (res.status === 401) {
      throw new Error(`${p.id} (401 Unauthorized): ${detail}. Please check your API key in .env or set base URL.`);
    }
    throw new Error(`provider ${p.id} ${res.status}: ${detail}`);
  }

  for await (const data of parseSseData(res.body)) {
    const json = JSON.parse(data) as {
      choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
    };
    const delta = json.choices?.[0]?.delta;
    if (!delta) continue;
    const toolCallParts = (delta.tool_calls ?? []).map((c) => ({
      index: c.index,
      id: c.id,
      name: c.function?.name,
      arguments: c.function?.arguments
    }));
    yield {
      content: delta.content,
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
    function: { name: c.function.name, arguments: c.function.arguments }
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
    }
  }

  return calls.filter((c) => c.id || c.function.name);
}
