/**
 * What an agent test needs before it can assert anything: a provider that
 * answers, a request to hand the server, and a way to read the stream back.
 *
 * All three used to be written out per test — twenty copies of `new
 * Request(url, { method: "POST", body: JSON.stringify(...) })`, and four
 * spellings of "a provider that returns this JSON". Setup was most of every
 * case, so a test read as thirty lines of scaffolding with one assertion at the
 * bottom, and the thing under test was the hardest part to find.
 */
import { handleAgentRequest, type AgentHttpDeps } from "../src/agent/http";
import type { FetchFn } from "../src/agent/provider";

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
 *
 * Return a plain value for a 200 JSON body; return a Response to control the
 * status or stream, which is how the failure and handoff cases are written.
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
