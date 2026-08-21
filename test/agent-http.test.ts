import { describe, it, expect } from "bun:test";
import { EventEmitter } from "events";
import { handleAgentRequest, abortSignalFromNode } from "../src/agent/http";
import type { FetchFn } from "../src/agent/provider";
import { makeDoc, frame, rect } from "./harness";
import {
  agentPost,
  callsSse,
  chatReply,
  fakeProvider,
  messagesReply,
  PNG,
  responsesReply,
  reviewPost,
  saysSse,
  sseEvents,
  streamed
} from "./agent-harness";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionLog } from "../src/agent/sessionLog";

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
        GEMINI_API_KEY: "sk-m",
        XAI_API_KEY: "sk-x",
        DASHSCOPE_API_KEY: "sk-q"
      }
    });
    const body = (await res.json()) as { configured: boolean; providers: { id: string; models: { id: string }[] }[] };
    expect(body.configured).toBe(true);
    expect(body.providers.map((p) => p.id)).toEqual(["openai", "opencode-go", "gemini", "xai", "qwen-studio"]);
    expect(body.providers[1].models.some((m) => m.id === "kimi-k2.7-code")).toBe(true);
    expect(body.providers[2].models.map((m) => m.id)).toEqual([
      "gemini-3.1-pro-preview",
      "gemini-3.7-flash"
    ]);
    expect(body.providers[3].models.map((m) => m.id)).toEqual(["grok-4.6"]);
    expect(JSON.stringify(body)).not.toContain("sk-o");
    expect(JSON.stringify(body)).not.toContain("sk-g");
    expect(JSON.stringify(body)).not.toContain("sk-m");
    expect(JSON.stringify(body)).not.toContain("sk-x");
    expect(JSON.stringify(body)).not.toContain("sk-q");
  });
});

describe("H5 agent HTTP", () => {
  it("omits credentials and image payloads from session logs", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "pen-agent-log-"));
    const log = createSessionLog(logDir, "redaction");
    log?.write({ authorization: "Bearer secret", screenshot: "data:image/png;base64,aVZCT1J3MEs=" });
    await log?.close();

    const raw = readFileSync(join(logDir, "redaction.jsonl"), "utf8");
    expect(raw).not.toContain("Bearer secret");
    expect(raw).not.toContain("aVZCT1J3MEs=");
    expect(raw).toContain("image data omitted");
  });

  it("streams assistant fragments then a done event", async () => {
    const provider = fakeProvider(() =>
      streamed({ choices: [{ delta: { content: "Hel" } }] }, { choices: [{ delta: { content: "lo" } }] })
    );

    const res = await agentPost(
      "run",
      {
        messages: [{ role: "user", content: "hi" }],
        doc: makeDoc(frame("f", 200, 100, [rect("r", 40, 40)]))
      },
      { env: { OPENAI_API_KEY: "sk-test" }, fetch: provider.fetch }
    );

    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const events = await sseEvents(res);
    expect(events[0]).toEqual({ type: "status", content: "gpt-5.6-luna is thinking…" });
    expect(events).toContainEqual({ type: "delta", content: "Hel" });
    expect(events).toContainEqual({ type: "delta", content: "lo" });
    expect(events.find((e) => e.type === "done").messages.at(-1)?.content).toBe("Hello");
  });

  it("streams status before the provider finishes", async () => {
    let release: (() => void) | undefined;
    const fakeFetch: FetchFn = () => new Promise((resolve) => {
      release = () => resolve(saysSse("ok"));
    });
    const res = await agentPost(
      "run",
      { messages: [{ role: "user", content: "hi" }], doc: makeDoc(frame("f", 100, 100)) },
      { env: { OPENAI_API_KEY: "sk-test" }, fetch: fakeFetch }
    );
    const reader = res.body!.getReader();
    const first = await reader.read();

    expect(new TextDecoder().decode(first.value)).toContain('"type":"status"');
    expect(release).toBeDefined();
    release!();
    while (!(await reader.read()).done) {
      // Drain the completed response so the background stream closes cleanly.
    }
  });

  it("sends OpenCode Go requests to the zen/go chat completions URL", async () => {
    const provider = fakeProvider(() => saysSse("ok"));
    const res = await agentPost(
      "run",
      {
        messages: [{ role: "user", content: "hi" }],
        doc: makeDoc(frame("f", 100, 100, [])),
        providerId: "opencode-go",
        model: "glm-5.2"
      },
      { env: { OPENCODE_API_KEY: "sk-go" }, fetch: provider.fetch }
    );
    await res.text();
    expect(provider.url()).toBe("https://opencode.ai/zen/go/v1/chat/completions");
  });

  it("writes a complete, secret-free JSONL trace for one agent session", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "pen-agent-log-"));
    let calls = 0;
    const fakeFetch: FetchFn = async () => {
      calls++;
      const events = calls === 1
        ? [
            { type: "response.reasoning_summary_text.delta", delta: "I should inspect the document first." },
            {
              type: "response.output_item.added",
              output_index: 0,
              item: {
                id: "fc_read",
                type: "function_call",
                call_id: "call_read",
                name: "read_digest",
                arguments: "{}"
              }
            }
          ]
        : [
            { type: "response.reasoning_text.delta", delta: "The existing screen answers the question." },
            { type: "response.output_text.delta", delta: "Done." }
          ];
      return streamed(...events);
    };

    const res = await agentPost(
      "run",
      {
        sessionId: "debug-session",
        providerId: "xai",
        model: "grok-4.6",
        reasoningEffort: "high",
        messages: [{ role: "user", content: "inspect this screen" }],
        doc: makeDoc(frame("f", 200, 100, [rect("r", 40, 40)]))
      },
      { env: { XAI_API_KEY: "sk-must-not-appear" }, fetch: fakeFetch, logDir }
    );
    await res.text();

    const raw = readFileSync(join(logDir, "debug-session.jsonl"), "utf8");
    const entries = raw.trim().split("\n").map((line) => JSON.parse(line));
    expect(entries.map((entry) => entry.type)).toContain("prompt");
    expect(entries.map((entry) => entry.type)).toContain("reasoning_delta");
    expect(entries.find((entry) => entry.type === "tool_call")).toMatchObject({
      name: "read_digest",
      arguments: "{}"
    });
    expect(entries.find((entry) => entry.type === "tool_result")?.result).toBe("f\n  r");
    expect(entries.at(-1)?.type).toBe("session_end");
    expect(raw).toContain("inspect this screen");
    expect(raw).not.toContain("sk-must-not-appear");
  });

  it("keeps edits that already ran when the request is aborted", async () => {
    let calls = 0;
    const fakeFetch: FetchFn = async (_input, init) => {
      calls++;
      if (calls === 1) {
        return callsSse("set_property", { id: "f", property: "gap", value: 24 });
      }
      await new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
      throw new Error("unreachable");
    };

    const doc = makeDoc(frame("f", 200, 100, [rect("r", 40, 40)], { gap: 8 }));
    const ac = new AbortController();
    const pending = agentPost(
      "run",
      { messages: [{ role: "user", content: "widen gap" }], doc },
      { env: { OPENAI_API_KEY: "sk-test" }, fetch: fakeFetch },
      { signal: ac.signal }
    );

    await Bun.sleep(20);
    ac.abort();
    const events = await sseEvents(await pending);
    expect(events.find((e) => e.type === "tool").doc?.children[0].gap).toBe(24);
    expect(events.find((e) => e.type === "error").code).toBe("aborted");
    expect(events.some((e) => e.type === "done")).toBe(false);
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

const REVIEW = JSON.stringify(validReview);

describe("agent review HTTP", () => {
  it("calls the critic with a fresh conversation and no tools", async () => {
    const provider = fakeProvider(() => chatReply(REVIEW));
    const res = await reviewPost(
      { brief: "A reading site for long essays", digest: "title Cover t28" },
      { env: { OPENAI_API_KEY: "sk-test" }, fetch: provider.fetch }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject(validReview);

    // One system brief and one user turn carrying the screenshot. No tools, and
    // nothing from the design conversation: the critic judges the picture.
    const posted = provider.body();
    expect(posted.tools).toBeUndefined();
    expect(posted.messages).toHaveLength(2);
    expect(posted.messages[0].role).toBe("system");
    expect(JSON.stringify(posted.messages[1])).toContain("A reading site for long essays");
  });

  it("uses the selected reasoning effort for Gemini visual review", async () => {
    const provider = fakeProvider(() => chatReply(REVIEW));
    const res = await reviewPost(
      { providerId: "gemini", model: "gemini-3.1-pro-preview", reasoningEffort: "high" },
      { env: { GEMINI_API_KEY: "gemini-key" }, fetch: provider.fetch }
    );

    expect(res.status).toBe(200);
    expect(provider.body().reasoning_effort).toBe("high");
  });

  it("uses the Responses API image format for OpenCode Go Luna", async () => {
    const provider = fakeProvider(() => responsesReply(REVIEW));
    const res = await reviewPost(
      { providerId: "opencode-go", model: "gpt-5.6-luna" },
      { env: { OPENCODE_API_KEY: "sk-go" }, fetch: provider.fetch }
    );

    expect(res.status).toBe(200);
    expect(provider.url()).toBe("https://opencode.ai/zen/go/v1/responses");
    expect(provider.body().input[1].content).toContainEqual({
      type: "input_image",
      image_url: PNG,
      detail: "high"
    });
  });

  it("keeps image_url input for an OpenCode Go chat vision model", async () => {
    const provider = fakeProvider(() => chatReply(REVIEW));
    const res = await reviewPost(
      { providerId: "opencode-go", model: "kimi-k3" },
      { env: { OPENCODE_API_KEY: "sk-go" }, fetch: provider.fetch }
    );

    expect(res.status).toBe(200);
    expect(provider.url()).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    const content = provider.body().messages[1].content;
    expect(content.some((part: { type: string }) => part.type === "image_url")).toBe(true);
  });

  it("uses Messages API image blocks for OpenCode Go Qwen vision", async () => {
    const provider = fakeProvider(() => messagesReply(REVIEW));
    const res = await reviewPost(
      { providerId: "opencode-go", model: "qwen3.8-max" },
      { env: { OPENCODE_API_KEY: "sk-go" }, fetch: provider.fetch }
    );

    expect(res.status).toBe(200);
    expect(provider.url()).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(provider.body().messages[0].content).toContainEqual(
      expect.objectContaining({ type: "image", source: expect.objectContaining({ type: "base64" }) })
    );
  });

  it("hands the screenshot to a vision model on the same provider", async () => {
    const provider = fakeProvider(() => responsesReply(REVIEW));
    const res = await reviewPost(
      { providerId: "opencode-go", model: "glm-5.2" },
      { env: { OPENCODE_API_KEY: "sk-go" }, fetch: provider.fetch }
    );

    // glm-5.2 draws; the first vision model the same provider offers looks.
    expect(res.status).toBe(200);
    expect(provider.models()).toEqual(["gpt-5.6-luna"]);
    const body = await res.json();
    expect(body.verdict).toBe("refine");
    expect(body.reviewedBy).toEqual({
      providerId: "opencode-go",
      model: "gpt-5.6-luna",
      handoff: "glm-5.2 does not read images"
    });
  });

  it("hands off again when the vision model fails on the screenshot", async () => {
    // The failure the trace actually recorded: a vision model that accepted the
    // request and returned 500 on it.
    const provider = fakeProvider((posted) =>
      posted.model === "gpt-5.6-luna"
        ? new Response("Internal server error", { status: 500 })
        : responsesReply(REVIEW)
    );
    const res = await reviewPost(
      { providerId: "opencode-go", model: "gpt-5.6-luna" },
      { env: { OPENCODE_API_KEY: "sk-go" }, fetch: provider.fetch }
    );

    expect(res.status).toBe(200);
    expect(provider.models()).toEqual(["gpt-5.6-luna", "grok-4.5"]);
    const body = await res.json();
    expect(body.reviewedBy.model).toBe("grok-4.5");
    expect(body.reviewedBy.handoff).toContain("gpt-5.6-luna failed on the screenshot");
  });

  it("says so when the provider has no model that can read the screenshot", async () => {
    const provider = fakeProvider(() => ({}));
    const res = await reviewPost(
      { providerId: "qwen-studio", model: "qwen-plus" },
      { env: { DASHSCOPE_API_KEY: "sk-qwen" }, fetch: provider.fetch }
    );

    expect(res.status).toBe(422);
    expect(provider.calls).toHaveLength(0);
    expect((await res.json()).error).toBe(
      "qwen-plus does not accept image input, and Qwen Studio offers no model that does"
    );
  });

  it("does not hand a malformed critic reply to a second model", async () => {
    const provider = fakeProvider(() => responsesReply("not json at all"));
    const res = await reviewPost(
      { providerId: "opencode-go", model: "gpt-5.6-luna" },
      { env: { OPENCODE_API_KEY: "sk-go" }, fetch: provider.fetch }
    );

    // The model answered. A second model cannot tell a one-off bad shape from a
    // stubborn one, so this costs one call, not two.
    expect(res.status).toBe(422);
    expect(provider.calls).toHaveLength(1);
  });

  it("returns invalid_response when the critic payload is not review JSON", async () => {
    const provider = fakeProvider(() => chatReply("not json at all"));
    const res = await reviewPost({ brief: "x" }, { env: { OPENAI_API_KEY: "sk-test" }, fetch: provider.fetch });
    expect(res.status).toBe(422);
  });

  it("rejects a non-image screenshot URL", async () => {
    const res = await reviewPost(
      { screenshot: "https://example.com/shot.png" },
      { env: { OPENAI_API_KEY: "sk-test" } }
    );
    expect(res.status).toBe(400);
  });

  it("rejects an oversized body", async () => {
    const res = await agentPost("review", "{}", { env: { OPENAI_API_KEY: "sk-test" } }, {
      headers: { "Content-Length": String(9 * 1024 * 1024) }
    });
    expect(res.status).toBe(413);
  });

  it("rejects a disallowed origin", async () => {
    const res = await agentPost("review", { brief: "x", digest: "y", screenshot: PNG }, {
      env: { OPENAI_API_KEY: "sk-test" }
    }, { headers: { Origin: "http://evil.example" } });
    expect(res.status).toBe(403);
  });
});
