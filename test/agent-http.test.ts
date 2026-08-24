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
  sseEvents,
  streamed
} from "./agent-harness";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionLog } from "../src/agent/sessionLog";

describe("H2 key configuration & /agent/status", () => {
  it("advertises configured providers without leaking API keys", async () => {
    const unconfigured = await handleAgentRequest(new Request("http://pen.test/agent/status"), { env: {} });
    expect(await unconfigured.json()).toEqual({ configured: false, providers: [] });

    const res = await handleAgentRequest(new Request("http://pen.test/agent/status"), {
      env: {
        VERCEL_API_KEY: "sk-v",
        OPENCODE_GO_API_KEY: "sk-g",
        GEMINI_API_KEY: "sk-m",
        XAI_API_KEY: "sk-x",
        DASHSCOPE_API_KEY: "sk-q"
      }
    });
    const body = (await res.json()) as { configured: boolean; providers: { id: string; models: { id: string }[] }[] };
    expect(body.configured).toBe(true);
    expect(body.providers.map((p) => p.id)).toEqual(["vercel", "opencode-zen", "opencode-go", "gemini", "xai", "qwen-studio"]);
    expect(body.providers[3].models.map((m) => m.id)).toEqual(["gemini-3.1-pro-preview", "gemini-3.7-flash"]);
    expect(JSON.stringify(body)).not.toMatch(/sk-[vgmxq]/);
  });
});

describe("H5 agent HTTP run endpoint & session logging", () => {
  it("redacts credentials and images in session log traces", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "ddraft-agent-log-"));
    const log = createSessionLog(logDir, "redaction");
    log?.write({ authorization: "Bearer secret", screenshot: "data:image/png;base64,aVZCT1J3MEs=" });
    await log?.close();

    const raw = readFileSync(join(logDir, "redaction.jsonl"), "utf8");
    expect(raw).not.toContain("Bearer secret");
    expect(raw).not.toContain("aVZCT1J3MEs=");
    expect(raw).toContain("image data omitted");
  });

  it("streams status, deltas, tool results, and records JSONL traces", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "ddraft-agent-log-"));
    let calls = 0;
    const fakeFetch: FetchFn = async () => {
      calls++;
      return calls === 1
        ? streamed(
            { type: "response.reasoning_summary_text.delta", delta: "Inspect screen." },
            { type: "response.output_item.added", output_index: 0, item: { id: "fc_read", type: "function_call", call_id: "c_read", name: "read_digest", arguments: "{}" } }
          )
        : streamed({ type: "response.output_text.delta", delta: "Done." });
    };

    const res = await agentPost(
      "run",
      {
        sessionId: "debug-session",
        providerId: "xai",
        model: "grok-4.6",
        reasoningEffort: "high",
        messages: [{ role: "user", content: "inspect screen" }],
        doc: makeDoc(frame("f", 200, 100, [rect("r", 40, 40)]))
      },
      { env: { XAI_API_KEY: "sk-secret" }, fetch: fakeFetch, logDir }
    );

    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    await res.text();
    const raw = readFileSync(join(logDir, "debug-session.jsonl"), "utf8");
    expect(raw).toContain("inspect screen");
    expect(raw).not.toContain("sk-secret");
  });

  it("handles abort signals and preserves committed edits", async () => {
    let calls = 0;
    const fakeFetch: FetchFn = async (_input, init) => {
      calls++;
      if (calls === 1) return callsSse("set_property", { id: "f", property: "gap", value: 24 });
      await new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
      throw new Error("unreachable");
    };

    const ac = new AbortController();
    const pending = agentPost(
      "run",
      { providerId: "opencode-go", model: "glm-5.2", messages: [{ role: "user", content: "widen gap" }], doc: makeDoc(frame("f", 200, 100, [rect("r", 40, 40)], { gap: 8 })) },
      { env: { OPENCODE_API_KEY: "sk-test" }, fetch: fakeFetch },
      { signal: ac.signal }
    );

    await Bun.sleep(20);
    ac.abort();
    const events = await sseEvents(await pending);
    expect(events.find((e) => e.type === "tool").doc?.children[0].gap).toBe(24);
    expect(events.find((e) => e.type === "error").code).toBe("aborted");

    // Node EventEmitter signal propagation
    const req = new EventEmitter();
    const resNode = Object.assign(new EventEmitter(), { writableEnded: false });
    const signal = abortSignalFromNode(req, resNode);
    req.emit("aborted");
    expect(signal.aborted).toBe(true);
  });
});

const validReview = {
  verdict: "refine",
  scores: { specificity: 3, hierarchy: 3, usability: 3, craft: 3 },
  strengths: ["Clear title"],
  issues: [{ title: "Raise heading", reason: "Small title", instruction: "Set 28px", nodeIds: ["title"] }]
};
const REVIEW = JSON.stringify(validReview);

describe("agent review HTTP endpoint & vision handoffs", () => {
  it("routes visual reviews with system prompts and provider-specific payload shapes", async () => {
    // Gemini Chat vision
    const pChat = fakeProvider(() => chatReply(REVIEW));
    const resChat = await reviewPost({ providerId: "gemini", model: "gemini-3.7-flash", brief: "Essays", digest: "title Cover" }, { env: { GEMINI_API_KEY: "k" }, fetch: pChat.fetch });
    expect(resChat.status).toBe(200);
    expect(await resChat.json()).toMatchObject(validReview);
    expect(pChat.body().tools).toBeUndefined();

    // OpenCode Go Responses format
    const pResp = fakeProvider(() => responsesReply(REVIEW));
    const resResp = await reviewPost({ providerId: "opencode-go", model: "gpt-5.6-luna" }, { env: { OPENCODE_API_KEY: "k" }, fetch: pResp.fetch });
    expect(resResp.status).toBe(200);
    expect(pResp.url()).toBe("https://opencode.ai/zen/go/v1/responses");

    // OpenCode Go Messages format (Qwen)
    const pMsg = fakeProvider(() => messagesReply(REVIEW));
    const resMsg = await reviewPost({ providerId: "opencode-go", model: "qwen3.8-max" }, { env: { OPENCODE_API_KEY: "k" }, fetch: pMsg.fetch });
    expect(resMsg.status).toBe(200);
    expect(pMsg.url()).toBe("https://opencode.ai/zen/go/v1/messages");
  });

  it("sends section close-ups through one complete overview review", async () => {
    let calls = 0;
    const pMulti = fakeProvider(() => {
      calls++;
      return responsesReply(REVIEW);
    });
    const res = await reviewPost(
      {
        providerId: "opencode-go",
        model: "gpt-5.6-luna",
        brief: "Lisbon coworking site",
        screenshots: [
          { id: "hero", name: "Hero Section", dataUrl: PNG, kind: "section" },
          { id: "pricing", name: "Pricing Section", dataUrl: PNG, kind: "section" }
        ]
      },
      { env: { OPENCODE_API_KEY: "k" }, fetch: pMulti.fetch }
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
    expect(JSON.stringify(pMulti.body())).toContain("Close-up Section");
    expect(JSON.stringify(pMulti.body())).toContain("Hero Section");
    expect(JSON.stringify(pMulti.body())).toContain("Pricing Section");
  });

  it("keeps viewport crops as overview context instead of focused sections", async () => {
    let calls = 0;
    const provider = fakeProvider(() => {
      calls++;
      return responsesReply(REVIEW);
    });
    const res = await reviewPost(
      {
        providerId: "opencode-go",
        model: "gpt-5.6-luna",
        brief: "Scrollable store",
        screenshots: [
          { id: "store", name: "Store", dataUrl: PNG, kind: "screen" },
          { id: "store_end_viewport", name: "Store — End", dataUrl: PNG, kind: "viewport" }
        ]
      },
      { env: { OPENCODE_API_KEY: "k" }, fetch: provider.fetch }
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
    expect(JSON.stringify(provider.body())).toContain("crop boundary is not a canvas boundary");
  });

  it("does not run a second crop-only critic beside the overview", async () => {
    const overview = {
      ...validReview,
      issues: ["One", "Two", "Three", "Four"].map((title) => ({
        title,
        reason: `${title} overview issue`,
        instruction: `Fix ${title}`,
        nodeIds: ["screen"]
      }))
    };
    let calls = 0;
    const provider = fakeProvider(() => {
      calls++;
      return responsesReply(JSON.stringify(overview));
    });
    const res = await reviewPost(
      {
        providerId: "opencode-go",
        model: "gpt-5.6-luna",
        brief: "Dashboard",
        screenshots: [{ id: "cards", name: "Card Grid", dataUrl: PNG, kind: "section" }]
      },
      { env: { OPENCODE_API_KEY: "k" }, fetch: provider.fetch }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(calls).toBe(1);
    expect(body.issues[0].title).toBe("One");
    expect(body.issues).toHaveLength(4);
  });

  it("handles vision handoffs, retries on failure, and informs when unsupported", async () => {
    // Automatic handoff from non-vision model (glm-5.2 -> gpt-5.6-luna)
    const pHandoff = fakeProvider(() => responsesReply(REVIEW));
    const resHandoff = await reviewPost({ providerId: "opencode-go", model: "glm-5.2" }, { env: { OPENCODE_API_KEY: "k" }, fetch: pHandoff.fetch });
    expect(resHandoff.status).toBe(200);
    const bodyHandoff = await resHandoff.json();
    expect(bodyHandoff.reviewedBy.model).toBe("gpt-5.6-luna");

    // Vision failure retry (gpt-5.6-luna fails -> retries grok-4.5)
    const pRetry = fakeProvider((posted) => posted.model === "gpt-5.6-luna" ? new Response("500", { status: 500 }) : responsesReply(REVIEW));
    const resRetry = await reviewPost({ providerId: "opencode-go", model: "gpt-5.6-luna" }, { env: { OPENCODE_API_KEY: "k" }, fetch: pRetry.fetch });
    expect(resRetry.status).toBe(200);
    expect((await resRetry.json()).reviewedBy.model).toBe("grok-4.5");

    // Provider offers no vision model (Qwen Studio)
    const resNoVision = await reviewPost({ providerId: "qwen-studio", model: "qwen-plus" }, { env: { DASHSCOPE_API_KEY: "k" } });
    expect(resNoVision.status).toBe(422);
    expect((await resNoVision.json()).error).toContain("offers no model that does");
  });

  it("enforces validation and rejects malformed requests (400, 403, 413, 422)", async () => {
    // Malformed review JSON reply
    const pBad = fakeProvider(() => chatReply("not json"));
    expect((await reviewPost({ providerId: "gemini", model: "gemini-3.7-flash", brief: "x" }, { env: { GEMINI_API_KEY: "k" }, fetch: pBad.fetch })).status).toBe(422);

    // Non-image screenshot URL
    expect((await reviewPost({ screenshot: "https://example.com/shot.png" }, { env: { GEMINI_API_KEY: "k" } })).status).toBe(400);

    // Oversized body payload (413)
    const res413 = await agentPost("review", "{}", { env: { GEMINI_API_KEY: "k" } }, { headers: { "Content-Length": String(33 * 1024 * 1024) } });
    expect(res413.status).toBe(413);

    // Disallowed origin (403)
    const res403 = await agentPost("review", { brief: "x", digest: "y", screenshot: PNG }, { env: { GEMINI_API_KEY: "k" } }, { headers: { Origin: "http://evil.example" } });
    expect(res403.status).toBe(403);
  });
});
