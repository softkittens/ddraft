import { handleAgentRequest, type AgentHttpDeps } from "../src/agent/http";
import type { FetchFn, Provider } from "../src/agent/provider";
import { runSession, type AgentEvent } from "../src/agent/session";
import type { Document } from "../src/model/types";

/** A 1x1 PNG. Enough to pass the data-URL check; a fake provider never looks. */
export const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/* One complete provider reply, in each of the three API shapes the client speaks. */
export const chatReply = (content: string) => ({
  choices: [{ message: { role: "assistant", content } }]
});
export const responsesReply = (text: string) => ({
  output: [{ type: "message", content: [{ type: "output_text", text }] }]
});
export const messagesReply = (text: string) => ({ content: [{ type: "text", text }] });

export const sseEvent = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

export function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
}

/** A streaming provider response: these events, then [DONE]. */
export function streamed(...events: unknown[]): Response {
  return new Response(sseStream([...events.map(sseEvent), "data: [DONE]\n\n"]), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

/** A stream that says one thing and stops. */
export const saysSse = (text: string) => streamed({ choices: [{ delta: { content: text } }] });

/** A stream that calls one tool and stops. */
export const callsSse = (name: string, args: unknown, id = "c1") =>
  streamed({
    choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }]
  });

/** The events a server-sent stream carried, parsed. */
export async function sseEvents(res: Response): Promise<any[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice(6)));
}

export interface FakeProvider {
  fetch: FetchFn;
  /** Every request the provider received, in order. */
  calls: { url: string; body: any }[];
  /** The model each call named — the handoff chain, where there is one. */
  models(): string[];
  /** The URL of the last call, which is how the API shape is checked. */
  url(): string;
  /** The body of the last call. */
  body(): any;
}

/**
 * A provider that records what it was asked and replies with `answer`.
 */
export function fakeProvider(answer: (body: any, url: string) => unknown): FakeProvider {
  const calls: { url: string; body: any }[] = [];
  return {
    calls,
    models: () => calls.map((call) => call.body?.model),
    url: () => calls.at(-1)?.url ?? "",
    body: () => calls.at(-1)?.body,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const reply = answer(calls.at(-1)!.body, url);
      return reply instanceof Response
        ? reply
        : new Response(JSON.stringify(reply), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
    }
  };
}

export function agentPost(
  path: "run" | "review",
  body: unknown,
  deps: AgentHttpDeps,
  init: RequestInit = {}
): Promise<Response> {
  return handleAgentRequest(
    new Request(`http://pen.test/agent/${path}`, {
      method: "POST",
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
      body: typeof body === "string" ? body : JSON.stringify(body)
    }),
    deps
  );
}

/** A review request with the fields every case needs already filled in. */
export const reviewPost = (body: Record<string, unknown>, deps: AgentHttpDeps) =>
  agentPost("review", { brief: "A reading site", screenshot: PNG, digest: "title Cover", ...body }, deps);

export type TestStep = Response | string | [string, unknown];

export const defaultTestProvider: Provider = {
  id: "test",
  baseUrl: "https://example.test/v1",
  model: "test-model",
  apiKey: "sk-test"
};

/**
 * Declaratively runs an agent session through a sequence of steps.
 * Steps can be:
 * - A tool tuple: ["insert_node", { ... }]
 * - A string reply: "All done!"
 * - A custom Response: streamed(...)
 */
export async function runTestSequence(
  initialDoc: Document,
  steps: TestStep[],
  options: {
    prompt?: string;
    provider?: Provider;
    maxTurns?: number;
  } = {}
): Promise<{
  events: AgentEvent[];
  calls: number;
  finalDoc: Document;
}> {
  let callIndex = 0;
  const events: AgentEvent[] = [];
  const provider = options.provider ?? defaultTestProvider;
  const prompt = options.prompt ?? "edit canvas";

  const fetchImpl: FetchFn = async () => {
    const step = steps[Math.min(callIndex, steps.length - 1)];
    callIndex++;
    if (step instanceof Response) return step;
    if (typeof step === "string") return saysSse(step);
    if (Array.isArray(step)) return callsSse(step[0], step[1], `c_${callIndex}`);
    return saysSse("done");
  };

  for await (const ev of runSession(
    provider,
    [{ role: "user", content: prompt }],
    initialDoc,
    { fetch: fetchImpl, maxTurns: options.maxTurns }
  )) {
    events.push(ev);
  }

  const lastDone = events.find((e) => e.type === "done");
  const finalDoc = lastDone && lastDone.type === "done" ? lastDone.doc : initialDoc;

  return { events, calls: callIndex, finalDoc };
}
