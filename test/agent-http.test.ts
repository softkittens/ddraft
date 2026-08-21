import { describe, it, expect } from "bun:test";
import { EventEmitter } from "events";
import { handleAgentRequest, abortSignalFromNode } from "../src/agent/http";
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
    const tool = events.find((e) => (e as { type: string }).type === "tool") as {
      doc?: { children: { gap?: number }[] };
    };
    const terminal = events.find((e) => (e as { type: string }).type === "error") as { code?: string };
    expect(tool.doc?.children[0].gap).toBe(24);
    expect(terminal.code).toBe("aborted");
    expect(events.some((e) => (e as { type: string }).type === "done")).toBe(false);
  });

  it("aborts the Fetch signal when the client disconnects", () => {
    const req = new EventEmitter();
    const res = Object.assign(new EventEmitter(), { writableEnded: false });
    const signal = abortSignalFromNode(req, res);
    expect(signal.aborted).toBe(false);
    req.emit("aborted");
    expect(signal.aborted).toBe(true);
  });

  it("does not abort when a completed request emits close", () => {
    const req = new EventEmitter();
    const res = Object.assign(new EventEmitter(), { writableEnded: true });
    const signal = abortSignalFromNode(req, res);
    req.emit("close");
    res.emit("close");
    expect(signal.aborted).toBe(false);
  });

  it("aborts on response close only while the response is still open", () => {
    const req = new EventEmitter();
    const res = Object.assign(new EventEmitter(), { writableEnded: false });
    const signal = abortSignalFromNode(req, res);
    res.emit("close");
    expect(signal.aborted).toBe(true);
  });
});

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const validReview = {
  verdict: "refine",
  scores: { specificity: 3, hierarchy: 3, usability: 3, craft: 3 },
  strengths: ["Clear title"],
  issues: [{
    title: "Raise the heading",
    reason: "Title and body are the same size.",
    instruction: "Set the heading to 28px.",
    nodeIds: ["title"]
  }]
};

describe("agent review HTTP", () => {
  it("calls the critic with a fresh conversation and no tools", async () => {
    let posted: { tools?: unknown; messages: Message[] } | undefined;
    const fakeFetch: FetchFn = async (_input, init) => {
      posted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: JSON.stringify(validReview) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const res = await handleAgentRequest(
      new Request("http://pen.test/agent/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: "A reading site",
          screenshot: PNG,
          digest: "title Cover"
        })
      }),
      { env: { OPENAI_API_KEY: "sk-test" }, fetch: fakeFetch }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verdict).toBe("refine");
    expect(posted?.tools).toBeUndefined();
    expect(posted?.messages).toHaveLength(2);
    expect(posted?.messages[0].role).toBe("system");
    expect(String(posted?.messages[0].content)).toContain("cannot edit");
  });

  it("keeps the screenshot for a non-OpenAI model", async () => {
    let posted: { messages: Message[] } | undefined;
    const fakeFetch: FetchFn = async (_input, init) => {
      posted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: JSON.stringify(validReview) } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const res = await handleAgentRequest(
      new Request("http://pen.test/agent/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: "A reading site",
          screenshot: PNG,
          digest: "title Cover",
          providerId: "opencode-go",
          model: "glm-5.2"
        })
      }),
      { env: { OPENCODE_API_KEY: "sk-go" }, fetch: fakeFetch }
    );

    expect(res.status).toBe(200);
    const user = posted?.messages[1];
    expect(Array.isArray(user?.content)).toBe(true);
    expect((user?.content as { type: string }[]).some((p) => p.type === "image_url")).toBe(true);
  });

  it("rejects a non-image screenshot URL", async () => {
    const res = await handleAgentRequest(
      new Request("http://pen.test/agent/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: "x",
          digest: "y",
          screenshot: "https://example.com/shot.png"
        })
      }),
      { env: { OPENAI_API_KEY: "sk-test" } }
    );
    expect(res.status).toBe(400);
  });

  it("rejects an oversized body", async () => {
    const res = await handleAgentRequest(
      new Request("http://pen.test/agent/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": String(9 * 1024 * 1024) },
        body: "{}"
      }),
      { env: { OPENAI_API_KEY: "sk-test" } }
    );
    expect(res.status).toBe(413);
  });

  it("rejects a disallowed origin", async () => {
    const res = await handleAgentRequest(
      new Request("http://pen.test/agent/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
        body: JSON.stringify({ brief: "x", digest: "y", screenshot: PNG })
      }),
      { env: { OPENAI_API_KEY: "sk-test" } }
    );
    expect(res.status).toBe(403);
  });

  it("returns invalid_response when the critic payload is not review JSON", async () => {
    const fakeFetch: FetchFn = async () =>
      new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "not json at all" } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });

    const res = await handleAgentRequest(
      new Request("http://pen.test/agent/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: "x", digest: "title Cover", screenshot: PNG })
      }),
      { env: { OPENAI_API_KEY: "sk-test" }, fetch: fakeFetch }
    );
    expect(res.status).toBe(422);
  });
});
