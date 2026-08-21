import { describe, it, expect } from "bun:test";
import { complete, type Provider, type FetchFn } from "../src/agent/provider";
import { loadProvider, listConfiguredProviders, UnknownModelError } from "../src/agent/credentials";
import { runSession, type AgentEvent } from "../src/agent/session";
import { createDocumentTools, TOOL_DEFS } from "../src/agent/tools";
import { makeDoc, frame, rect } from "./harness";
import { digest } from "../src/digest/digest";
import { cloneDocument } from "../src/model/tree";
import { parseDocument } from "../src/model/parse";
import { agentSystemPrompt } from "../src/agent/prompt";
import { assembleToolCalls } from "../src/agent/stream";
import { getLucideIconPath } from "../src/model/icons";

const echoProvider: Provider = {
  id: "echo",
  baseUrl: "https://example.test/v1",
  model: "echo-1",
  apiKey: "sk-test-secret"
};

function jsonResponse(body: unknown, url?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-Request-Url": url || "" }
  });
}

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    }
  });
}

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentSse(text: string): Response {
  return new Response(sseBody([sseEvent({ choices: [{ delta: { content: text } }] }), "data: [DONE]\n\n"]), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

async function collectSession(
  fetchImpl: FetchFn,
  extra: { maxTurns?: number } = {}
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of runSession(
    echoProvider,
    [{ role: "user", content: "hi" }],
    makeDoc(frame("f", 200, 100, [rect("r", 40, 40)])),
    { fetch: fetchImpl, ...extra }
  )) {
    events.push(ev);
  }
  return events;
}

describe("H1 provider client", () => {
  it("reaches two providers when only baseUrl, model and apiKey change", async () => {
    const seen: { url: string; model: string; auth: string }[] = [];
    const fakeFetch: FetchFn = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body));
      seen.push({ url, model: body.model, auth: headers.get("Authorization") || "" });
      return jsonResponse({
        choices: [{ message: { role: "assistant", content: "ok" } }]
      });
    };

    const a: Provider = { id: "a", baseUrl: "https://a.test/v1", model: "model-a", apiKey: "key-a" };
    const b: Provider = { id: "b", baseUrl: "https://b.test/v1", model: "model-b", apiKey: "key-b" };
    await complete(a, [{ role: "user", content: "hi" }], undefined, { fetch: fakeFetch });
    await complete(b, [{ role: "user", content: "hi" }], undefined, { fetch: fakeFetch });

    expect(seen[0].url).toBe("https://a.test/v1/chat/completions");
    expect(seen[1].url).toBe("https://b.test/v1/chat/completions");
    expect(seen[0].model).toBe("model-a");
    expect(seen[1].model).toBe("model-b");
    expect(seen[0].auth).toBe("Bearer key-a");
    expect(seen[1].auth).toBe("Bearer key-b");
  });

  it("returns an assistant message with content when no tools are given", async () => {
    const fakeFetch: FetchFn = async () =>
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "hello from the model" } }]
      });
    const reply = await complete(echoProvider, [{ role: "user", content: "hi" }], undefined, { fetch: fakeFetch });
    expect(reply.role).toBe("assistant");
    expect(reply.content).toBe("hello from the model");
  });
});

describe("H2 credentials", () => {
  it("returns null when no key is present and does not throw", () => {
    const result = loadProvider("openai", {});
    expect(result).toBeNull();
  });

  it("lists only providers whose keys are set", () => {
    const none = listConfiguredProviders({});
    expect(none).toEqual([]);

    const two = listConfiguredProviders({
      OPENAI_API_KEY: "sk-openai",
      DASHSCOPE_API_KEY: "sk-qwen"
    });
    expect(two.map((p) => p.id)).toEqual(["openai", "qwen-studio"]);
    expect(JSON.stringify(two)).not.toContain("sk-openai");
    expect(JSON.stringify(two)).not.toContain("sk-qwen");
  });

  it("loads OpenCode Go from OPENCODE_API_KEY without logging the key", () => {
    const logs: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const p = loadProvider("opencode-go", { OPENCODE_API_KEY: "sk-live-do-not-print" }, "glm-5.2");
      expect(p).not.toBeNull();
      expect(p?.baseUrl).toBe("https://opencode.ai/zen/go/v1");
      expect(p?.model).toBe("glm-5.2");
      expect(p?.apiKey).toBe("sk-live-do-not-print");
      expect(logs.join("\n")).not.toContain("sk-live-do-not-print");
    } finally {
      console.info = original;
    }
  });

  it("refuses an unknown model instead of quietly running a different one", () => {
    expect(() => loadProvider("opencode-go", { OPENCODE_API_KEY: "k" }, "gpt-9-imaginary")).toThrow(
      UnknownModelError
    );
    try {
      loadProvider("opencode-go", { OPENCODE_API_KEY: "k" }, "gpt-9-imaginary");
    } catch (e) {
      // The message has to carry the way out, or the caller only learns it was wrong.
      expect((e as Error).message).toContain("gpt-9-imaginary");
      expect((e as Error).message).toContain("glm-5.2");
    }
  });

  it("still falls back to the first model when the caller names none", () => {
    const p = loadProvider("opencode-go", { OPENCODE_API_KEY: "k" });
    expect(p?.model).toBeTruthy();
  });
});

describe("H3 tool loop", () => {
  it("ends after one request when the reply has no tool calls", async () => {
    let requests = 0;
    const fakeFetch: FetchFn = async () => {
      requests++;
      return contentSse("done");
    };
    const events = await collectSession(fakeFetch);
    expect(requests).toBe(1);
    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.messages.at(-1)?.content).toBe("done");
      expect(done.messages.filter((m) => m.role === "tool")).toHaveLength(0);
    }
  });

  it("emits one tool message per call with matching tool_call_id", async () => {
    let requests = 0;
    const fakeFetch: FetchFn = async () => {
      requests++;
      if (requests === 1) {
        return new Response(
          sseBody([
            sseEvent({
              choices: [{
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_1", function: { name: "read_digest", arguments: "{}" } },
                    { index: 1, id: "call_2", function: { name: "read_digest", arguments: "{}" } }
                  ]
                }
              }]
            }),
            "data: [DONE]\n\n"
          ]),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      }
      return contentSse("finished");
    };
    const events = await collectSession(fakeFetch);
    const tools = events.filter((e) => e.type === "tool");
    expect(tools).toHaveLength(2);
    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      const toolMsgs = done.messages.filter((m) => m.role === "tool");
      expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["call_1", "call_2"]);
    }
  });

  it("returns a parse error as a tool result and does not throw", async () => {
    let requests = 0;
    const fakeFetch: FetchFn = async () => {
      requests++;
      if (requests === 1) {
        return new Response(
          sseBody([
            sseEvent({
              choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    id: "bad",
                    function: { name: "read_digest", arguments: "{not json" }
                  }]
                }
              }]
            }),
            "data: [DONE]\n\n"
          ]),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      }
      return contentSse("recovered");
    };
    const events = await collectSession(fakeFetch);
    const tool = events.find((e) => e.type === "tool");
    expect(tool?.type).toBe("tool");
    if (tool?.type === "tool") {
      expect(tool.result.toLowerCase()).toContain("json");
    }
    const done = events.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.messages.find((m) => m.role === "tool")?.tool_call_id).toBe("bad");
      expect(done.messages.at(-1)?.content).toBe("recovered");
    }
  });
});

describe("H4 document tools", () => {
  it("returns a string from every tool and never undefined", async () => {
    const session = createDocumentTools(makeDoc(frame("f", 200, 100, [rect("r", 40, 40)])));
    for (const def of TOOL_DEFS) {
      const result = await session.execute(def.name, {});
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("does not change the document when set_property gets an invalid property", async () => {
    const start = makeDoc(frame("f", 200, 100, [rect("r", 40, 40)]));
    const session = createDocumentTools(cloneDocument(start));
    const result = await session.execute("set_property", { id: "r", property: "not_a_real_prop", value: 9 });
    expect(result.toLowerCase()).toContain("error");
    expect(digest(session.doc)).toBe(digest(start));
  });

  it("shows the new value in the digest after set_property", async () => {
    const session = createDocumentTools(makeDoc(frame("f", 200, 100, [rect("r", 40, 40)], { gap: 8 })));
    const result = await session.execute("set_property", { id: "f", property: "gap", value: 24 });
    expect(result).toContain("g24");
    expect(digest(session.doc)).toContain("g24");
  });

  it("treats id root as the whole document when no such node exists", async () => {
    const start = makeDoc(frame("f", 200, 100, [rect("r", 40, 40)]));
    const session = createDocumentTools(cloneDocument(start));
    const whole = await session.execute("read_digest", {});
    const aliased = await session.execute("read_digest", { id: "root" });
    expect(aliased).toBe(whole);
    expect(aliased).not.toContain("not found");
    expect(aliased).toContain("f");
  });

  it("reads a real node whose id is root instead of aliasing it", async () => {
    const session = createDocumentTools(makeDoc(frame("root", 200, 100, [rect("r", 40, 40)]), frame("other", 80, 80, [])));
    const subtree = await session.execute("read_digest", { id: "root" });
    const whole = await session.execute("read_digest", {});
    expect(subtree).toContain("root");
    expect(subtree).not.toContain("other");
    expect(whole).toContain("other");
  });

  it("searches Lucide icons and returns matching icon names", async () => {
    const session = createDocumentTools(makeDoc(frame("f", 200, 100, [])));
    const result = await session.execute("search_icons", { query: "heart" });
    expect(result).toContain("heart");
    expect(result).toContain("Found");
  });

  it("inserts a Lucide vector icon into a container frame", async () => {
    const session = createDocumentTools(makeDoc(frame("f", 200, 100, [])));
    const result = await session.execute("insert_icon", { icon: "star", parentId: "f", size: 28, stroke: "#3B82F6" });
    expect(result).toContain("ok: inserted Lucide icon \"star\"");
    expect(session.doc.children[0].children?.[0].type).toBe("icon");
    expect((session.doc.children[0].children?.[0] as any).icon).toBe("star");
  });

  it("stores resolved geometry on insert_icon so the browser does not need the catalog", async () => {
    const session = createDocumentTools(makeDoc(frame("f", 200, 100, [])));
    await session.execute("insert_icon", { icon: "ellipse", parentId: "f" });
    const icon = session.doc.children[0].children?.[0] as { geometry?: string; icon?: string };
    expect(icon.icon).toBe("ellipse");
    expect(typeof icon.geometry).toBe("string");
    expect(icon.geometry).toContain("a 10,6");
    expect(icon.geometry!.length).toBeGreaterThan(10);

    const roundTrip = parseDocument(JSON.stringify(session.doc));
    expect((roundTrip.children[0] as { children?: { geometry?: string }[] }).children?.[0].geometry).toBe(icon.geometry);
  });

  it("keeps scaffold status icons in the browser core set", () => {
    for (const name of ["signal", "wifi", "battery-full"]) {
      expect(getLucideIconPath(name)?.length).toBeGreaterThan(10);
    }
  });

  it("falls back when an icon has no stored geometry and is not in the core set", () => {
    const previous = process.cwd;
    (process as { cwd?: unknown }).cwd = undefined;
    try {
      expect(getLucideIconPath("not-a-real-icon-zzz")).toBeUndefined();
    } finally {
      process.cwd = previous;
    }
  });

  it("reports that image generation is unavailable rather than substituting a stock photo", async () => {
    // With no provider key configured this used to return one fixed Unsplash
    // photograph for every prompt, so the caller believed it had an image of
    // whatever it asked for. Saying so is the only honest answer.
    const session = createDocumentTools(makeDoc(frame("f", 200, 100, [])));
    const result = await session.execute("generate_image", { prompt: "Stallion sunset", nodeId: "f" });
    expect(result).toContain("error: Image generation is not configured");
    expect(result).toContain("Design without photography");
    // and it leaves the node alone rather than filling it with something else
    expect((session.doc.children[0] as any).fill?.type).toBeUndefined();
  });
});

describe("Selection context", () => {
  const doc = makeDoc(
    frame("screen", 390, 844, [
      frame("header", 390, 64),
      frame("body", 390, 400)
    ])
  );

  // Regression guard for "look at this selection" -> the model guessing "root".
  it("names the selected node so 'this' has a referent", () => {
    const prompt = agentSystemPrompt(doc, ["header"]);
    expect(prompt).toContain(`Selection: header`);
    expect(prompt).toContain('"this", "the selection" and "it" mean that node');
  });

  it("says so when nothing is selected", () => {
    expect(agentSystemPrompt(doc, [])).toContain("nothing is selected");
  });

  it("ignores ids that are not in the document", () => {
    expect(agentSystemPrompt(doc, ["ghost"])).toContain("nothing is selected");
  });

  it("lists every node when several are selected", () => {
    const prompt = agentSystemPrompt(doc, ["header", "body"]);
    expect(prompt).toContain("Selection: 2 nodes");
    expect(prompt).toContain("header");
    expect(prompt).toContain("body");
  });

  it("treats the whole-document aliases a model invents as the whole document", () => {
    const tools = createDocumentTools(doc);
    for (const alias of ["root", "document", "canvas"]) {
      expect(tools.execute("read_digest", { id: alias })).resolves.not.toContain("error:");
    }
  });
});

describe("Stream tool assembly", () => {
  it("assembles multiple sequential tool calls that share index 0 without concatenating names or args", () => {
    const parts = [
      [{ index: 0, id: "call_1", name: "set_property", arguments: "" }],
      [{ index: 0, arguments: '{"id":"frame1","property":"fill","value":"#fff"}' }],
      [{ index: 0, id: "call_2", name: "set_property", arguments: "" }],
      [{ index: 0, arguments: '{"id":"frame1","property":"stroke","value":"#000"}' }]
    ];

    const calls = assembleToolCalls(parts);
    expect(calls).toHaveLength(2);
    expect(calls[0].id).toBe("call_1");
    expect(calls[0].function.name).toBe("set_property");
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ id: "frame1", property: "fill", value: "#fff" });

    expect(calls[1].id).toBe("call_2");
    expect(calls[1].function.name).toBe("set_property");
    expect(JSON.parse(calls[1].function.arguments)).toEqual({ id: "frame1", property: "stroke", value: "#000" });
  });

  it("assembles chunked argument tokens properly", () => {
    const parts = [
      [{ index: 0, id: "call_1", name: "set_", arguments: "" }],
      [{ index: 0, name: "property", arguments: '{"id":' }],
      [{ index: 0, arguments: '"card"}' }]
    ];

    const calls = assembleToolCalls(parts);
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("set_property");
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ id: "card" });
  });
});

