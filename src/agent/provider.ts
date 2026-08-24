import type { ModelReasoningTraits, ModelWireTraits } from "./catalog";

export type ReasoningEffort = "none" | "low" | "medium" | "high";

/**
 * The effort value this endpoint will actually accept.
 *
 * Models with reasoning.supported === false never send reasoning_effort over the wire.
 */
export function toWireReasoningEffort(
  p: Pick<Provider, "reasoningEffort" | "reasoning">
): ReasoningEffort | undefined {
  if (p.reasoning?.supported === false || !p.reasoningEffort || p.reasoningEffort === "none") {
    return undefined;
  }
  return p.reasoningEffort;
}

/**
 * One notch less deliberation, for a reply the provider cut off mid-thought.
 *
 * Steps high down to medium, and medium down to low (the floor).
 */
export function stepDownEffort(effort: ReasoningEffort | undefined): ReasoningEffort {
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
  reasoning?: ModelReasoningTraits;
  wire?: ModelWireTraits;
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

export function isValidImageUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) || /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(trimmed);
}

/** Gemini 3 rejects a follow-up tool turn unless each function call carries a thought signature. */
export const GEMINI_SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

export function isGeminiModel(p: Pick<Provider, "wire">): boolean {
  return Boolean(p.wire?.requiresThoughtSignature);
}

function withGeminiThoughtSignatures(calls: ToolCall[], p?: Provider): ToolCall[] {
  if (!p || !isGeminiModel(p)) return calls;
  return calls.map((call) => {
    if (call.extra_content?.google?.thought_signature) return call;
    return {
      ...call,
      extra_content: {
        ...call.extra_content,
        google: { ...call.extra_content?.google, thought_signature: GEMINI_SKIP_THOUGHT_SIGNATURE }
      }
    };
  });
}

/**
 * OpenCode (and OpenAI) 400 the whole follow-up if any prior tool-call
 * `arguments` fail JSON.parse. Streaming models often truncate mid-object;
 * we still execute what we can, then this keeps the replay legal.
 */
export function jsonToolArguments(raw: string | undefined | null): string {
  if (raw == null || raw === "") return "{}";
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return "{}";
  }
}

export function toApiMessages(messages: Message[], p?: Provider) {
  // The catalog decides this, once. Sniffing the model name for "gpt-4o" or
  // "vl" here disagreed with loadProvider on every model neither rule named,
  // so a request could carry an image the server believed it had stripped.
  return messages.map((m) => {
    let content = m.content;
    if (Array.isArray(content)) {
      const hasImages = content.some((c) => c.type === "image_url");
      if (!p?.vision || !hasImages) {
        content = content
          .filter((c) => c.type === "text")
          .map((c) => (c as { type: "text"; text: string }).text)
          .join("\n");
      } else {
        content = content.map((c) => {
          if (c.type === "image_url" && !isValidImageUrl(c.image_url.url)) {
            return { type: "text", text: `[Image: ${c.image_url.url}]` };
          }
          return c;
        });
      }
    }
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0 && (content === "" || content == null)) {
      content = null as any;
    }
    const row: Record<string, unknown> = { role: m.role, content };
    if (m.tool_calls) {
      row.tool_calls = withGeminiThoughtSignatures(m.tool_calls, p).map((call) => ({
        ...call,
        function: { ...call.function, arguments: jsonToolArguments(call.function.arguments) }
      }));
    }
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
    const content = parts.map((part) => {
      if (part.type === "text") {
        return { type: message.role === "assistant" ? "output_text" : "input_text", text: part.text };
      }
      if (isValidImageUrl(part.image_url.url)) {
        return { type: "input_image", image_url: part.image_url.url, detail: part.image_url.detail };
      }
      return { type: message.role === "assistant" ? "output_text" : "input_text", text: `[Image: ${part.image_url.url}]` };
    });
    if (content.some((part) => part.type !== "output_text" || (part as { text?: string }).text)) {
      input.push({ role: message.role, content });
    }
    for (const call of message.tool_calls ?? []) {
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: jsonToolArguments(call.function.arguments)
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
        if (!isValidImageUrl(part.image_url.url)) {
          return { type: "text", text: `[Image: ${part.image_url.url}]` };
        }
        const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
        return match
          ? { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } }
          : { type: "image", source: { type: "url", url: part.image_url.url } };
      })
    });
  }
  return { system: system.join("\n\n"), messages: input };
}

export function usesMaxCompletionTokens(p: Pick<Provider, "wire">): boolean {
  return Boolean(p.wire?.usesMaxCompletionTokens);
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
        ...(toWireReasoningEffort(p)
          ? { reasoning: { effort: toWireReasoningEffort(p) } }
          : {})
      }
    : api === "messages"
      ? { model: p.model, max_tokens: p.maxOutputTokens ?? 4096, ...messagesInput }
    : {
        model: p.model,
        messages: toApiMessages(messages, p),
        ...(usesMaxCompletionTokens(p)
          ? { max_completion_tokens: p.maxOutputTokens ?? 4096 }
          : { max_tokens: p.maxOutputTokens ?? 4096 }),
        ...(toWireReasoningEffort(p) ? { reasoning_effort: toWireReasoningEffort(p) } : {})
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
