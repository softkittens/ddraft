import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { complete, type Provider, type FetchFn, type Message } from "../src/agent/provider";
import {
  loadProvider,
  listConfiguredProviders,
  loadVisionProvider,
  UnknownModelError
} from "../src/agent/credentials";
import { visionModelFor } from "../src/agent/catalog";
import { runSession, type AgentEvent } from "../src/agent/session";
import { createDocumentTools, TOOL_DEFS } from "../src/agent/tools";
import { makeDoc, frame, rect } from "./harness";
import { callsSse, saysSse, streamed } from "./agent-harness";
import { digest } from "../src/digest/digest";
import { cloneDocument } from "../src/model/tree";
import { parseDocument } from "../src/model/parse";
import { agentSystemPrompt } from "../src/agent/prompt";
import { assembleToolCalls, completeStream } from "../src/agent/stream";
import { getLucideIconPath, searchLucideIcons, getAllLucideIconNames, iconCatalogAvailable } from "../src/model/icons";
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
      return streamed();
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

  it("uses native Responses streaming and preserves function-call history", async () => {
    let url = "";
    let posted: any;
    const fetchImpl: FetchFn = async (input, init) => {
      url = String(input);
      posted = JSON.parse(String(init?.body));
      return streamed(
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { id: "fc_next", type: "function_call", call_id: "call_next", name: "insert_node", arguments: "" }
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_next",
          output_index: 0,
          delta: '{"parentId":"n1"}'
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            id: "fc_next",
            type: "function_call",
            call_id: "call_next",
            name: "insert_node",
            arguments: '{"parentId":"n1"}'
          }
        }
      );
    };

    const history = [
      { role: "user" as const, content: "design" },
      {
        role: "assistant" as const,
        content: "planning",
        tool_calls: [{
          id: "call_style",
          type: "function" as const,
          function: { name: "set_style", arguments: '{"palette":"Minimal Ink"}' }
        }]
      },
      { role: "tool" as const, content: "ok", tool_call_id: "call_style" }
    ];
    const groups = [];
    for await (const delta of completeStream(
      { ...echoProvider, api: "responses" },
      history,
      [{ name: "insert_node", description: "Insert", parameters: { type: "object" } }],
      { fetch: fetchImpl }
    )) groups.push(delta.toolCallParts);

    expect(url).toBe("https://example.test/v1/responses");
    expect(posted.stream).toBe(true);
    expect(posted.tools[0]).toEqual({
      type: "function", name: "insert_node", description: "Insert", parameters: { type: "object" }
    });
    expect(posted.input).toContainEqual({
      type: "function_call",
      call_id: "call_style",
      name: "set_style",
      arguments: '{"palette":"Minimal Ink"}'
    });
    expect(posted.input).toContainEqual({ type: "function_call_output", call_id: "call_style", output: "ok" });
    expect(assembleToolCalls(groups)[0]).toEqual({
      id: "call_next",
      type: "function",
      function: { name: "insert_node", arguments: '{"parentId":"n1"}' }
    });
  });

  it("streams Responses reasoning separately from assistant content", async () => {
    const deltas = [];
    for await (const delta of completeStream(
      { ...echoProvider, api: "responses" },
      [{ role: "user", content: "inspect this" }],
      undefined,
      {
        fetch: async () => streamed(
          { type: "response.reasoning_summary_text.delta", delta: "Checking the hierarchy." },
          { type: "response.output_text.delta", delta: "Done." }
        )
      }
    )) deltas.push(delta);

    expect(deltas.map((delta) => delta.reasoning).filter(Boolean)).toEqual([
      "Checking the hierarchy."
    ]);
    expect(deltas.map((delta) => delta.content).filter(Boolean)).toEqual(["Done."]);
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

  it("finds a vision model on the same provider, and skips the ones already tried", () => {
    expect(visionModelFor("opencode-go")?.id).toBe("gpt-5.6-luna");
    expect(visionModelFor("opencode-go", ["gpt-5.6-luna"])?.id).toBe("grok-4.5");
    expect(visionModelFor("opencode-go", ["gpt-5.6-luna", "grok-4.5"])?.id).toBe("kimi-k3");
    // Qwen Studio lists no model that reads images, so there is nothing to hand
    // the screenshot to and the caller has to say so.
    expect(visionModelFor("qwen-studio")).toBeUndefined();
  });

  it("loads the handoff model with the same key the caller already supplied", () => {
    const env = { OPENCODE_API_KEY: "k" };
    const alternate = loadVisionProvider("opencode-go", env, ["deepseek-v4-pro"], "high");
    expect(alternate).toMatchObject({
      id: "opencode-go",
      model: "gpt-5.6-luna",
      apiKey: "k",
      vision: true,
      reasoningEffort: "high"
    });
    expect(loadVisionProvider("qwen-studio", { DASHSCOPE_API_KEY: "k" }, [])).toBeNull();
  });

  it("loads both requested Gemini vision models through Google's compatible endpoint", () => {
    const providers = listConfiguredProviders({ GEMINI_API_KEY: "gemini-key" });
    expect(providers[0].models.map((model) => model.id)).toEqual([
      "gemini-3.1-pro-preview",
      "gemini-3.7-flash"
    ]);
    const provider = loadProvider("gemini", { GEMINI_API_KEY: "gemini-key" }, "gemini-3.7-flash", "high");
    expect(provider).toMatchObject({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.7-flash",
      vision: true,
      reasoningEffort: "high"
    });
  });

  it("loads Grok 4.6 through xAI's Responses API", () => {
    const providers = listConfiguredProviders({ XAI_API_KEY: "xai-key" });
    expect(providers[0].id).toBe("xai");
    expect(providers[0].models.map((model) => model.id)).toEqual(["grok-4.6"]);
    expect(loadProvider("xai", { XAI_API_KEY: "xai-key" }, "grok-4.6", "high")).toMatchObject({
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.6",
      api: "responses",
      vision: true,
      reasoningEffort: "high"
    });
  });
});

describe("H3 tool loop", () => {
  it("announces a tool before running it, not only after", async () => {
    let requests = 0;
    const events: AgentEvent[] = [];
    for await (const event of runSession(
      echoProvider,
      [{ role: "user", content: "add a note" }],
      makeDoc(),
      {
        fetch: async () => {
          requests += 1;
          return requests === 1
            ? callsSse("insert_node", {
                parentId: null,
                node: { type: "text", content: "Read slowly", fontSize: 20 }
              })
            : saysSse("Added it.");
        }
      }
    )) events.push(event);

    const order = events
      .filter((event) => event.type === "tool_start" || event.type === "tool")
      .map((event) => event.type);
    // A tool that takes half a minute — generate_image — left the panel with a
    // finished summary and nothing else on screen for the whole call.
    expect(order).toEqual(["tool_start", "tool"]);
  });

  it("carries the image subject on the start event, so the wait says what it is for", async () => {
    let requests = 0;
    const events: AgentEvent[] = [];
    for await (const event of runSession(
      echoProvider,
      [{ role: "user", content: "add a portrait" }],
      makeDoc(frame("hero", 390, 300)),
      {
        fetch: async () => {
          requests += 1;
          return requests === 1
            ? callsSse("generate_image", { prompt: "A tabby in a sunlit window", nodeId: "hero" })
            : saysSse("Done.");
        }
      }
    )) events.push(event);

    const start = events.find((event) => event.type === "tool_start");
    expect(start?.type === "tool_start" && start.name).toBe("generate_image");
    expect(start?.type === "tool_start" && start.detail).toBe("A tabby in a sunlit window");
  });

  it("lets the model answer a non-design question without forcing an empty-canvas build", async () => {
    let requests = 0;
    let posted: { tools?: unknown[] } | undefined;
    const fakeFetch: FetchFn = async (_input, init) => {
      requests++;
      posted = JSON.parse(String(init?.body));
      return callsSse("answer_user", { reply: "I am the selected model." });
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
    expect((posted?.tools as Array<{ function?: { name?: string } }>).some(
      (tool) => tool.function?.name === "answer_user"
    )).toBe(true);
    expect(events.some((event) => event.type === "tool")).toBe(false);
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    const done = events.find((event) => event.type === "done");
    expect(done?.type === "done" && done.messages.at(-1)?.content).toBe("I am the selected model.");
  });

  it("does not turn a missed conversational answer into design work", async () => {
    let requests = 0;
    const events: AgentEvent[] = [];
    for await (const event of runSession(
      echoProvider,
      [{ role: "user", content: "hello" }],
      makeDoc(),
      {
        fetch: async () => {
          requests += 1;
          return requests === 1
            ? saysSse("Hello! What can I help you with?")
            : callsSse("answer_user", { reply: "Hello! What can I help you with?" });
        }
      }
    )) events.push(event);

    const done = events.find((event) => event.type === "done");
    expect(requests).toBe(2);
    expect(events.some((event) => event.type === "tool")).toBe(false);
    expect(done?.type === "done" && done.doc.children).toEqual([]);
    expect(done?.type === "done" && done.messages.at(-1)?.content).toBe("Hello! What can I help you with?");
    expect(done?.type === "done" && done.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  it("ends after one request when the reply has no tool calls", async () => {
    let requests = 0;
    const fakeFetch: FetchFn = async () => {
      requests++;
      return saysSse("done");
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
        return streamed({
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "read_digest", arguments: "{}" } },
                { index: 1, id: "call_2", function: { name: "read_digest", arguments: "{}" } }
              ]
            }
          }]
        });
      }
      return saysSse("finished");
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
        return streamed({
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: "bad", function: { name: "read_digest", arguments: "{not json" } }]
            }
          }]
        });
      }
      return saysSse("recovered");
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

  it("resolves geometry for icons arriving through insert_node", async () => {
    // The rule the prompt gives the model is an insert_node shape, so this is
    // the path most icons take. Without geometry every non-core icon painted
    // the generic fallback glyph.
    const session = createDocumentTools(makeDoc(frame("f", 200, 100, [])));
    await session.execute("insert_node", {
      parentId: "f",
      node: {
        type: "frame", id: "row", layout: "horizontal",
        children: [{ type: "icon", id: "bm", icon: "bookmark", width: 22, height: 22 }]
      }
    });
    const icon = session.doc.children[0].children?.[0].children?.[0] as { geometry?: string };
    expect(typeof icon.geometry).toBe("string");
    expect(icon.geometry).toBe(getLucideIconPath("bookmark"));
  });

  it("resolves geometry for the tab icons create_screen builds", async () => {
    const session = createDocumentTools(makeDoc());
    await session.execute("create_screen", {
      name: "Home", kind: "mobile",
      tabs: [{ label: "Saved", icon: "bookmark", active: true }, { label: "You", icon: "user" }]
    });
    const icons: { icon?: string; geometry?: string }[] = [];
    const walk = (node: any) => {
      if (node?.type === "icon") icons.push(node);
      for (const child of node?.children ?? []) walk(child);
    };
    walk(session.doc.children[0]);
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon.geometry).toBe(getLucideIconPath(icon.icon!));
  });

  it("carries geometry across an icon rename, and clears it for an unknown name", async () => {
    const session = createDocumentTools(makeDoc(frame("f", 200, 100, [])));
    await session.execute("insert_icon", { icon: "star", parentId: "f" });
    const id = session.doc.children[0].children![0].id;

    await session.execute("set_property", { id, property: "icon", value: "heart" });
    expect((session.doc.children[0].children![0] as any).geometry).toBe(getLucideIconPath("heart"));

    await session.execute("set_property", { id, property: "icon", value: "not-a-real-icon-zzz" });
    expect((session.doc.children[0].children![0] as any).geometry).toBeUndefined();
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

  it("uses Nano Banana Lite when the selected chat provider is Gemini", async () => {
    let url = "";
    let posted: {
      model: string;
      input: { type: string; text: string }[];
      response_format: { type: string; aspect_ratio: string; image_size: string };
    } | undefined;
    const session = createDocumentTools(makeDoc(frame("avatar", 64, 64)), {
      providerId: "gemini",
      apiKey: "gemini-test-key",
      fetch: async (input, init) => {
        url = String(input);
        posted = JSON.parse(String(init?.body));
        return jsonResponse({
          steps: [{ type: "model_output", content: [{
            type: "image",
            data: "aW1hZ2U=",
            mime_type: "image/png"
          }] }]
        });
      }
    });
    const result = await session.execute("generate_image", {
      prompt: "Editorial horse portrait",
      nodeId: "avatar"
    });

    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(posted?.model).toBe("gemini-3.1-flash-lite-image");
    expect(posted?.input).toEqual([{ type: "text", text: "Editorial horse portrait" }]);
    expect(posted?.response_format).toEqual({
      type: "image",
      aspect_ratio: "1:1",
      image_size: "1K"
    });
    expect(result).toContain("generated image (gemini)");
    expect(result).toContain("square composition for the 64x64 target");
    expect(result).not.toContain("data:image");
    expect(session.doc.children[0].fill).toEqual({
      type: "image",
      url: "data:image/png;base64,aW1hZ2U="
    });
  });

  it("uses Grok Imagine when the selected chat provider is xAI", async () => {
    let url = "";
    let posted: Record<string, unknown> | undefined;
    const session = createDocumentTools(makeDoc(frame("hero", 320, 180)), {
      providerId: "xai",
      apiKey: "xai-test-key",
      fetch: async (input, init) => {
        url = String(input);
        posted = JSON.parse(String(init?.body));
        return jsonResponse({ data: [{ b64_json: "aW1hZ2U=" }] });
      }
    });

    const result = await session.execute("generate_image", {
      prompt: "Editorial horse portrait",
      nodeId: "hero"
    });

    expect(url).toBe("https://api.x.ai/v1/images/generations");
    expect(posted).toEqual({
      model: "grok-imagine-image-quality",
      prompt: "Editorial horse portrait",
      n: 1,
      response_format: "b64_json",
      aspect_ratio: "16:9",
      resolution: "1k"
    });
    expect(result).toContain("generated image (xai)");
    expect(result).not.toContain("data:image");
    expect(session.doc.children[0].fill).toEqual({
      type: "image",
      url: "data:image/jpeg;base64,aW1hZ2U="
    });
  });

  it("does not generate an image without a real destination", async () => {
    let requested = false;
    const session = createDocumentTools(makeDoc(), {
      providerId: "gemini",
      apiKey: "gemini-test-key",
      fetch: async () => {
        requested = true;
        return jsonResponse({});
      }
    });

    expect(await session.execute("generate_image", {
      prompt: "Editorial horse portrait",
      nodeId: "missing"
    })).toContain("node missing not found");
    expect(requested).toBe(false);
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

  it("preserves Gemini thought signatures in the next tool round", async () => {
    const signature = "encrypted-signature";
    let posted: { messages: Message[] } | undefined;
    const first = await Array.fromAsync(completeStream(
      { ...echoProvider, id: "gemini" },
      [{ role: "user", content: "Use the tool" }],
      [{ name: "ping", description: "Ping", parameters: { type: "object" } }],
      {
        fetch: async () => streamed({ choices: [{ delta: { tool_calls: [{
          index: 0,
          id: "call_1",
          function: { name: "ping", arguments: "{}" },
          extra_content: { google: { thought_signature: signature } }
        }] } }] })
      }
    ));
    const calls = assembleToolCalls(first.map((delta) => delta.toolCallParts));

    await Array.fromAsync(completeStream(
      { ...echoProvider, id: "gemini" },
      [
        { role: "user", content: "Use the tool" },
        { role: "assistant", content: "", tool_calls: calls },
        { role: "tool", content: "pong", tool_call_id: "call_1" }
      ],
      undefined,
      {
        fetch: async (_input, init) => {
          posted = JSON.parse(String(init?.body));
          return streamed();
        }
      }
    ));

    expect(posted?.messages[1].tool_calls?.[0].extra_content?.google?.thought_signature)
      .toBe(signature);
  });
});

describe("Writes answer with what they did", () => {
  const card = () =>
    createDocumentTools(makeDoc(
      frame("card", 350, 200, [
        { type: "text", id: "t1", content: "Juniper watches the room, then chooses your lap.", fontSize: 14, width: "fill_container" } as any
      ], { name: "Card", layout: "vertical", gap: 8, padding: 16 })
    ));

  it("reports the resolved box after a size change instead of echoing the value", async () => {
    // The run this comes from spent 28 of 96 tool calls on measure, against
    // three distinct ids, because set_property only ever replied with the
    // declared subtree it had just been handed.
    const session = card();
    const result = await session.execute("set_property", { id: "card", property: "height", value: "fit_content" });
    expect(result).toContain("measured:");
    expect(result).toMatch(/is now \d+x\d+px/);
  });

  it("says so when a write changes nothing", async () => {
    // The same frame took height := fit_content twice in a row, four minutes
    // apart, and both calls answered ok.
    const session = card();
    await session.execute("set_property", { id: "card", property: "height", value: "fit_content" });
    const again = await session.execute("set_property", { id: "card", property: "height", value: "fit_content" });
    expect(again).toContain("no change");
    expect(again).toContain("already");
  });

  it("names an oscillation instead of letting it run", async () => {
    // Straight from a review pass: frame_qcdz6z.height went 450, 250, 450, 250
    // and frame_ju30uo.height went fit_content, 188, 188, fit_content — four
    // writes to land back on the starting value. Alternating between two
    // guesses is not converging, and nothing in the loop said so.
    const session = card();
    await session.execute("set_property", { id: "card", property: "height", value: 250 });
    await session.execute("set_property", { id: "card", property: "height", value: 450 });
    const third = await session.execute("set_property", { id: "card", property: "height", value: 250 });
    expect(third).toContain("back to one it already had");
    expect(third).toContain("The value is not what decides this box");
  });

  it("does not cry loop over an ordinary second attempt", async () => {
    const session = card();
    await session.execute("set_property", { id: "card", property: "height", value: 250 });
    const second = await session.execute("set_property", { id: "card", property: "height", value: 300 });
    expect(second).not.toContain("back to one it already had");
  });

  it("leaves non-geometry writes alone", async () => {
    const session = card();
    const result = await session.execute("set_property", { id: "card", property: "fill", value: "$surface-primary" });
    expect(result).not.toContain("measured:");
  });

  it("measures every geometry target of a batch", async () => {
    const session = card();
    const result = await session.execute("batch_set_properties", {
      updates: [
        { id: "card", property: "height", value: 90 },
        { id: "t1", property: "fontSize", value: 16 }
      ]
    });
    expect(result).toContain("ok: updated 2 properties");
    expect(result.match(/measured:/g)?.length).toBe(2);
    expect(result).toContain('inside "Card"');
  });
});

describe("Ids one tool hands out, another accepts", () => {
  async function listWithInstance() {
    const session = createDocumentTools(makeDoc(
      frame("list", 350, 400, [
        frame("row", "fill_container", 64, [
          { type: "text", id: "row_name", content: "Miso", fontSize: 16 } as any
        ], { name: "Row", layout: "horizontal", gap: 8 })
      ], { name: "Matches", layout: "vertical", gap: 8 })
    ));
    await session.execute("place_instances", {
      componentId: "row", parentId: "list", items: [{ row_name: { content: "Pepper" } }]
    });
    return session;
  }

  it("writes through the synthetic id that measure reports", async () => {
    // resolveInstances names instance descendants "<refId>:<originalId>", and
    // measure reports those because it measures the resolved tree. A run read
    // ref_9322:frame_vi6l6f out of a measure result and got "node not found"
    // three times over — one tool handing out an identifier another refuses.
    const session = await listWithInstance();
    const measured = await session.execute("measure", { id: "list" });
    const synthetic = measured.match(/ref_\d+:[a-z_0-9]+/)?.[0];
    expect(synthetic).toBeTruthy();

    const result = await session.execute("set_property", { id: synthetic, property: "height", value: 96 });
    expect(result).toContain("inside instance");
    expect(result).toContain("Only this instance changed");
  });

  it("keeps the overrides the instance already had", async () => {
    const session = await listWithInstance();
    await session.execute("set_property", { id: "ref_1:row_name", property: "height", value: 96 });
    const ref = (session.doc.children[0] as any).children[1];
    expect(ref.descendants.row_name.content).toBe("Pepper");
    expect(ref.descendants.row_name.height).toBe(96);
  });

  it("still refuses an id that names nothing", async () => {
    const session = await listWithInstance();
    expect(await session.execute("set_property", { id: "ref_1:nope_nope", property: "height", value: 96 }))
      .toContain("not found");
    expect(await session.execute("set_property", { id: "list:row_name", property: "height", value: 96 }))
      .toContain("not found");
  });
});

describe("Icon resolution does not depend on where the process started", () => {
  it("resolves names outside the browser core map", () => {
    for (const name of ["bookmark", "paw-print", "info", "calendar-heart"]) {
      expect(getLucideIconPath(name)).toBeTruthy();
    }
  });

  it("resolves them from a different working directory too", () => {
    // The real regression, and the reason it went unnoticed: run from the repo
    // root everything worked, so this had to leave the repo root to see it. The
    // catalog was resolved against process.cwd(), every miss fell into a
    // swallowed catch, and getAllLucideIconNames quietly returned the 28 core
    // names. A run asked for bookmark, paw-print, info and calendar-heart and
    // the canvas drew four copies of the painter's fallback glyph while every
    // tool answered ok. Run in a subprocess because the lookup memoizes.
    // Goes through the agent's own entry point, not icons.ts directly: the
    // catalog is only there because something registered it, and the thing
    // that has to register it is the module the server actually loads.
    const script = [
      `await import(${JSON.stringify(join(process.cwd(), "src/agent/tools.ts"))});`,
      `const { getLucideIconPath, searchLucideIcons, iconCatalogAvailable } = await import(${JSON.stringify(join(process.cwd(), "src/model/icons.ts"))});`,
      `const { rules } = await import(${JSON.stringify(join(process.cwd(), "src/agent/rules.ts"))});`,
      `const names = ["bookmark", "paw-print", "info", "calendar-heart", "clock", "star"];`,
      `console.log(JSON.stringify({`,
      `  available: iconCatalogAvailable(),`,
      `  resolved: names.every((n) => !!getLucideIconPath(n)),`,
      `  search: searchLucideIcons("cat paw", 4),`,
      `  rules: rules("craft-rules").split("\\n")[0]`,
      `}));`
    ].join("\n");
    const proc = spawnSync("bun", ["-e", script], { cwd: tmpdir(), encoding: "utf-8" });
    expect(proc.status).toBe(0);
    const out = JSON.parse(proc.stdout.trim().split("\n").pop()!);
    expect(out.available).toBe(true);
    expect(out.resolved).toBe(true);
    expect(out.search).toContain("paw-print");
    // rules.md is found the same way, and would fail the same way.
    expect(out.rules).toBe("RULES");
  });

  it("refuses to answer from the 28-icon core map", () => {
    // What the running server was actually doing: search_icons("star") replied
    // "Found 1", info/bookmark/calendar found nothing, and insert_icon rejected
    // `clock` with an empty suggestion list — every one of them a real Lucide
    // name. The core map is a browser fallback, never an answer to a search.
    expect(iconCatalogAvailable()).toBe(true);
    expect(getAllLucideIconNames().length).toBeGreaterThan(1500);
    for (const name of ["clock", "info", "bookmark", "calendar", "help-circle"].slice(0, 4)) {
      expect(searchLucideIcons(name, 3).length).toBeGreaterThan(0);
    }
    expect(searchLucideIcons("star", 5).length).toBeGreaterThan(1);
  });

  it("matches a multi-word query per word", () => {
    // "cat paw" returned nothing while both cat and paw-print were installed,
    // and "message circle" returned nothing for message-circle. Every
    // multi-word query failed, and the model settled for a worse icon.
    expect(searchLucideIcons("cat paw", 6)).toContain("cat");
    expect(searchLucideIcons("cat paw", 6)).toContain("paw-print");
    expect(searchLucideIcons("message circle", 4)[0]).toBe("message-circle");
    expect(searchLucideIcons("cat", 4)[0]).toBe("cat");
  });
});
