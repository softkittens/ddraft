export type ReasoningEffort = "none" | "low" | "medium" | "high";

/**
 * One notch less deliberation, for a reply the provider cut off mid-thought.
 *
 * Asking the model to think less is advice, and advice is refusable — the run
 * that prompted this had already been told to act and spent another 17,914
 * characters deliberating instead. The effort setting is not refusable. An
 * undefined effort means the endpoint picked its own, so the step down states
 * one explicitly; "low" is the floor, because a reasoning model handed "none"
 * is a different model and the run did not ask for that.
 */
export function stepDownEffort(effort: ReasoningEffort | undefined): ReasoningEffort {
  if (effort === "none") return "none";
  if (effort === "high") return "medium";
  return "low";
}

export interface Provider {
  id: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoningEffort?: ReasoningEffort;
  api?: "chat" | "responses" | "messages";
  vision?: boolean;
  /** Output ceiling for one reply, when this provider caps below the default. */
  maxOutputTokens?: number;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  extra_content?: { google?: { thought_signature?: string } };
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
  // The catalog decides this, once. Sniffing the model name for "gpt-4o" or
  // "vl" here disagreed with loadProvider on every model neither rule named,
  // so a request could carry an image the server believed it had stripped.
  return messages.map((m) => {
    let content = m.content;
    if (Array.isArray(content) && !p?.vision) {
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

export function toResponsesInput(messages: Message[]) {
  const input: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const output = Array.isArray(message.content)
        ? message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
        : message.content;
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output });
      continue;
    }

    const parts: MessageContentPart[] = Array.isArray(message.content)
      ? message.content
      : [{ type: "text", text: message.content }];
    const content = parts
      .map((part) => part.type === "text"
        ? { type: message.role === "assistant" ? "output_text" : "input_text", text: part.text }
        : { type: "input_image", image_url: part.image_url.url, detail: part.image_url.detail });
    if (content.some((part) => part.type !== "output_text" || part.text)) {
      input.push({ role: message.role, content });
    }
    for (const call of message.tool_calls ?? []) {
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments
      });
    }
  }
  return input;
}

function toMessagesInput(messages: Message[]) {
  const system: string[] = [];
  const input: { role: "user" | "assistant"; content: unknown[] }[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      system.push(typeof message.content === "string" ? message.content : message.content
        .filter((part) => part.type === "text")
        .map((part) => (part as { type: "text"; text: string }).text)
        .join("\n"));
      continue;
    }
    const parts: MessageContentPart[] = Array.isArray(message.content)
      ? message.content
      : [{ type: "text", text: message.content }];
    input.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: parts.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
        return match
          ? { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } }
          : { type: "image", source: { type: "url", url: part.image_url.url } };
      })
    });
  }
  return { system: system.join("\n\n"), messages: input };
}

export async function complete(
  p: Provider,
  messages: Message[],
  opts: CompleteOptions = {}
): Promise<Message> {
  const fetchImpl = opts.fetch ?? fetch;
  const api = p.api || "chat";
  const messagesInput = api === "messages" ? toMessagesInput(messages) : null;
  const body: Record<string, unknown> = api === "responses"
    ? {
        model: p.model,
        input: toResponsesInput(messages),
        ...(p.reasoningEffort && p.reasoningEffort !== "none"
          ? { reasoning: { effort: p.reasoningEffort } }
          : {})
      }
    : api === "messages"
      ? { model: p.model, max_tokens: p.maxOutputTokens ?? 4096, ...messagesInput }
    : {
        model: p.model,
        messages: toApiMessages(messages, p),
        ...(p.reasoningEffort ? { reasoning_effort: p.reasoningEffort } : {})
      };
  const endpoint = api === "chat" ? "chat/completions" : api;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${p.apiKey}`
  };
  if (api === "messages") {
    headers["x-api-key"] = p.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }
  const res = await fetchImpl(`${p.baseUrl.replace(/\/$/, "")}/${endpoint}`, {
    method: "POST",
    headers,
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
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
    content?: { type?: string; text?: string }[];
  };
  if (api !== "chat") {
    const parts = api === "responses"
      ? (data.output ?? []).flatMap((item) => item.content ?? [])
      : data.content ?? [];
    const content = parts
      .filter((part) => part.type === "output_text" || part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
    return { role: "assistant", content };
  }
  const msg = data.choices?.[0]?.message;
  return {
    role: "assistant",
    content: msg?.content ?? "",
    tool_calls: msg?.tool_calls
  };
}
