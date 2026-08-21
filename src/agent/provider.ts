export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface Provider {
  id: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoningEffort?: ReasoningEffort;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type MessageContent = string | MessageContentPart[];

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: MessageContent;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: object;
}

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CompleteOptions {
  fetch?: FetchFn;
  signal?: AbortSignal;
}

export function toApiMessages(messages: Message[], p?: Provider) {
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

export async function complete(
  p: Provider,
  messages: Message[],
  tools?: Tool[],
  opts: CompleteOptions = {}
): Promise<Message> {
  const fetchImpl = opts.fetch ?? fetch;
  const body: Record<string, unknown> = {
    model: p.model,
    messages: toApiMessages(messages, p),
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

  if (!res.ok) {
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

  const data = (await res.json()) as {
    choices?: { message?: { role?: string; content?: string | null; tool_calls?: ToolCall[] } }[];
  };
  const msg = data.choices?.[0]?.message;
  return {
    role: "assistant",
    content: msg?.content ?? "",
    tool_calls: msg?.tool_calls
  };
}
