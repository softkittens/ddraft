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
import { assembleToolCalls, completeStream } from "../src/agent/stream";
import { getLucideIconPath } from "../src/model/icons";
import { generateDesignImage } from "../src/agent/image_gen";

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
    [{ role: "user", content: "edit the canvas" }],
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
    await complete(a, [{ role: "user", content: "hi" }], { fetch: fakeFetch });
    await complete(b, [{ role: "user", content: "hi" }], { fetch: fakeFetch });

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
    const reply = await complete(echoProvider, [{ role: "user", content: "hi" }], { fetch: fakeFetch });
    expect(reply.role).toBe("assistant");
    expect(reply.content).toBe("hello from the model");
  });

  it("keeps image input in the streaming tool loop for catalogued vision models", async () => {
    let posted: { messages: { content: unknown }[] } | undefined;
    const fetch: FetchFn = async (_input, init) => {
      posted = JSON.parse(String(init?.body));
      return new Response(sseBody(["data: [DONE]\n\n"]));
    };
    const provider: Provider = {
      id: "opencode-go",
      baseUrl: "https://example.test/v1",
      model: "kimi-k3",
      apiKey: "key",
      vision: true
    };
    const content = [
      { type: "text" as const, text: "reference" },
      { type: "image_url" as const, image_url: { url: "data:image/png;base64,xx" } }
    ];

    for await (const _ of completeStream(provider, [{ role: "user", content }], undefined, { fetch })) {
      // drain
    }

    expect(posted?.messages[0].content).toEqual(content);
  });

  it("uses output_text when an assistant turn is sent through Responses", async () => {
    let posted: { input: { content: { type: string }[] }[] } | undefined;
    const provider: Provider = { ...echoProvider, api: "responses" };
    await complete(provider, [
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" }
    ], {
      fetch: async (_input, init) => {
        posted = JSON.parse(String(init?.body));
        return jsonResponse({ output: [] });
      }
    });

    expect(posted?.input[0].content[0].type).toBe("input_text");
    expect(posted?.input[1].content[0].type).toBe("output_text");
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

  it("marks every native OpenCode Go vision model in the picker", () => {
    const models = listConfiguredProviders({ OPENCODE_API_KEY: "k" })[0].models;
    const vision = models
      .map((model) => loadProvider("opencode-go", { OPENCODE_API_KEY: "k" }, model.id))
      .filter((provider) => provider?.vision)
      .map((provider) => provider?.model);
    expect(vision).toEqual([
      "gpt-5.6-luna",
      "grok-4.5",
      "kimi-k3",
      "kimi-k2.7-code",
      "deepseek-v4-flash-vision-exp",
      "minimax-m3",
      "qwen3.8-max",
      "mimo-v2.5"
    ]);
  });
});

describe("H3 tool loop", () => {
  it("lets the model answer a non-design question without forcing an empty-canvas build", async () => {
    let requests = 0;
    let posted: { tools?: unknown[] } | undefined;
    const fakeFetch: FetchFn = async (_input, init) => {
      requests++;
      posted = JSON.parse(String(init?.body));
      return contentSse("I am the selected model. [no canvas change]");
    };
    const events: AgentEvent[] = [];
    for await (const event of runSession(
      echoProvider,
      [{ role: "user", content: "what model are you?" }],
      makeDoc(),
      { fetch: fakeFetch }
    )) {
      events.push(event);
    }

    expect(requests).toBe(1);
    expect(Array.isArray(posted?.tools)).toBe(true);
    expect(events.some((event) => event.type === "tool")).toBe(false);
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    const done = events.find((event) => event.type === "done");
    expect(done?.type === "done" && done.messages.at(-1)?.content).toBe("I am the selected model.");
  });

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

  it("uses the configured Qwen workspace origin and Image 3.0 request shape", async () => {
    let url = "";
    let posted: {
      input: { messages: { content: { text: string }[] }[] };
      parameters: { size: string };
    } | undefined;
    const result = await generateDesignImage("Stallion sunset", {
      aspectRatio: "portrait",
      env: {
        QWEN_API_KEY: "sk-test",
        QWEN_BASE_URL: "https://workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
      },
      fetch: async (input, init) => {
        url = String(input);
        posted = JSON.parse(String(init?.body));
        return jsonResponse({
          output: { choices: [{ message: { content: [{ image: "https://images.test/horse.png" }] } }] }
        });
      }
    });

    expect(url).toBe("https://workspace.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
    expect(posted?.input.messages[0].content).toEqual([{ text: "Stallion sunset" }]);
    expect(posted?.parameters.size).toBe("768*1024");
    expect(result).toEqual({ url: "https://images.test/horse.png", provider: "qwen" });
  });

  it("reports a configured provider failure instead of claiming no key exists", async () => {
    const pending = generateDesignImage("Stallion sunset", {
      env: { QWEN_API_KEY: "sk-test" },
      fetch: async () => new Response(JSON.stringify({
        code: "InvalidApiKey",
        message: "Invalid API-key provided."
      }), { status: 401 })
    });

    expect(pending).rejects.toThrow("Qwen 401 InvalidApiKey: Invalid API-key provided.");
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
