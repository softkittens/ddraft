import { describe, it, expect } from "bun:test";
import { handleAgentRequest } from "../src/agent/http";
import type { FetchFn } from "../src/agent/provider";
import { makeDoc, frame, rect } from "./harness";
import type { Message } from "../src/agent/provider";

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    }
  });
}

async function readSseEvents(res: Response): Promise<unknown[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice(6)));
}

describe("H2 key file and status", () => {
  it("reports .env as gitignored", async () => {
    const proc = Bun.spawn(["git", "check-ignore", ".env"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(out.trim()).toBe(".env");
  });

  it("returns configured false with no key and never includes the key field", async () => {
    const res = await handleAgentRequest(new Request("http://pen.test/agent/status"), { env: {} });
    const body = await res.json();
    expect(body).toEqual({ configured: false, providers: [] });
    expect(JSON.stringify(body)).not.toContain("apiKey");
    expect(JSON.stringify(body)).not.toContain("OPENAI_API_KEY");
  });

  it("advertises every provider whose key is set", async () => {
    const res = await handleAgentRequest(new Request("http://pen.test/agent/status"), {
      env: {
        OPENAI_API_KEY: "sk-o",
        OPENCODE_GO_API_KEY: "sk-g",
        DASHSCOPE_API_KEY: "sk-q"
      }
    });
    const body = (await res.json()) as { configured: boolean; providers: { id: string; models: { id: string }[] }[] };
    expect(body.configured).toBe(true);
    expect(body.providers.map((p) => p.id)).toEqual(["openai", "opencode-go", "qwen-studio"]);
    expect(body.providers[1].models.some((m) => m.id === "kimi-k2.7-code")).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk-o");
    expect(JSON.stringify(body)).not.toContain("sk-g");
    expect(JSON.stringify(body)).not.toContain("sk-q");
  });
});

describe("H5 agent HTTP", () => {
  it("streams assistant fragments then a done event", async () => {
    const fakeFetch: FetchFn = async () =>
      new Response(
        sseBody([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          "data: [DONE]\n\n"
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      );

    const doc = makeDoc(frame("f", 200, 100, [rect("r", 40, 40)]));
    const messages: Message[] = [{ role: "user", content: "hi" }];
    const res = await handleAgentRequest(
      new Request("http://pen.test/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, doc })
      }),
      {
        env: { OPENAI_API_KEY: "sk-test" },
        fetch: fakeFetch
      }
    );

    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const events = await readSseEvents(res);
    expect(events).toContainEqual({ type: "delta", content: "Hel" });
    expect(events).toContainEqual({ type: "delta", content: "lo" });
    const done = events.find((e) => (e as { type: string }).type === "done") as {
      type: string;
      messages: Message[];
      doc: unknown;
    };
    expect(done).toBeDefined();
    expect(done.messages.at(-1)?.content).toBe("Hello");
  });

  it("sends OpenCode Go requests to the zen/go chat completions URL", async () => {
    let url = "";
    const fakeFetch: FetchFn = async (input) => {
      url = String(input);
      return new Response(sseBody(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', "data: [DONE]\n\n"]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      });
    };
    const doc = makeDoc(frame("f", 100, 100, []));
    const res = await handleAgentRequest(
      new Request("http://pen.test/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hi" }],
          doc,
          providerId: "opencode-go",
          model: "glm-5.2"
        })
      }),
      { env: { OPENCODE_API_KEY: "sk-go" }, fetch: fakeFetch }
    );
    await res.text();
    expect(url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
  });

  it("keeps edits that already ran when the request is aborted", async () => {
    let calls = 0;
    const fakeFetch: FetchFn = async (_input, init) => {
      calls++;
      if (calls === 1) {
        return new Response(
          sseBody([
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"set_property","arguments":"{\\"id\\":\\"f\\",\\"property\\":\\"gap\\",\\"value\\":24}"}}]}}]}\n\n',
            "data: [DONE]\n\n"
          ]),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      }
      await new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
      throw new Error("unreachable");
    };

    const doc = makeDoc(frame("f", 200, 100, [rect("r", 40, 40)], { gap: 8 }));
    const ac = new AbortController();
    const req = new Request("http://pen.test/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "widen gap" }], doc }),
      signal: ac.signal
    });

    const pending = handleAgentRequest(req, {
      env: { OPENAI_API_KEY: "sk-test" },
      fetch: fakeFetch
    });

    await Bun.sleep(20);
    ac.abort();
    const res = await pending;
    const events = await readSseEvents(res);
    const done = events.find((e) => (e as { type: string }).type === "done") as { doc: { children: { gap?: number }[] } };
    expect(done.doc.children[0].gap).toBe(24);
  });
});
