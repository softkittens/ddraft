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
import { callsSse, saysSse, streamed, runTestSequence } from "./agent-harness";
import { digest } from "../src/digest/digest";
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

describe("H1 provider client & streaming protocol", () => {
  it("routes provider HTTP requests with headers, URLs and models", async () => {
    const seen: { url: string; model: string; auth: string }[] = [];
    const fakeFetch: FetchFn = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body));
      seen.push({ url, model: body.model, auth: headers.get("Authorization") || "" });
      return jsonResponse({ choices: [{ message: { role: "assistant", content: "ok" } }] });
    };

    const a: Provider = { id: "a", baseUrl: "https://a.test/v1", model: "model-a", apiKey: "key-a" };
    const b: Provider = { id: "b", baseUrl: "https://b.test/v1", model: "model-b", apiKey: "key-b" };
    const resA = await complete(a, [{ role: "user", content: "hi" }], { fetch: fakeFetch });
    const resB = await complete(b, [{ role: "user", content: "hi" }], { fetch: fakeFetch });

    expect(seen[0]).toEqual({ url: "https://a.test/v1/chat/completions", model: "model-a", auth: "Bearer key-a" });
    expect(seen[1]).toEqual({ url: "https://b.test/v1/chat/completions", model: "model-b", auth: "Bearer key-b" });
    expect(resA.content).toBe("ok");
    expect(resB.content).toBe("ok");
  });

  it("handles vision payloads and Responses streaming API", async () => {
    let visionPosted: any;
    const visionProvider: Provider = { id: "opencode-go", baseUrl: "https://example.test/v1", model: "kimi-k3", apiKey: "k", vision: true };
    const content = [{ type: "text" as const, text: "reference" }, { type: "image_url" as const, image_url: { url: "data:image/png;base64,xx" } }];
    for await (const _ of completeStream(visionProvider, [{ role: "user", content }], undefined, { fetch: async (_i, init) => { visionPosted = JSON.parse(String(init?.body)); return streamed(); } })) {}
    expect(visionPosted?.messages[0].content).toEqual(content);

    // Responses streaming API
    let responsesUrl = "";
    let responsesPosted: any;
    const history: Message[] = [
      { role: "user", content: "design" },
      { role: "assistant", content: "planning", tool_calls: [{ id: "call_style", type: "function", function: { name: "set_style", arguments: '{"palette":"Minimal Ink"}' } }] },
      { role: "tool", content: "ok", tool_call_id: "call_style" }
    ];
    const groups = [];
    for await (const delta of completeStream(
      { ...echoProvider, api: "responses" },
      history,
      [{ name: "insert_node", description: "Insert", parameters: { type: "object" } }],
      {
        fetch: async (input, init) => {
          responsesUrl = String(input);
          responsesPosted = JSON.parse(String(init?.body));
          return streamed(
            { type: "response.output_item.added", output_index: 0, item: { id: "fc_next", type: "function_call", call_id: "call_next", name: "insert_node", arguments: "" } },
            { type: "response.function_call_arguments.delta", item_id: "fc_next", output_index: 0, delta: '{"parentId":"n1"}' },
            { type: "response.output_item.done", output_index: 0, item: { id: "fc_next", type: "function_call", call_id: "call_next", name: "insert_node", arguments: '{"parentId":"n1"}' } }
          );
        }
      }
    )) groups.push(delta.toolCallParts);

    expect(responsesUrl).toBe("https://example.test/v1/responses");
    expect(responsesPosted.stream).toBe(true);
    expect(responsesPosted.input).toContainEqual({ type: "function_call", call_id: "call_style", name: "set_style", arguments: '{"palette":"Minimal Ink"}' });
    expect(assembleToolCalls(groups)[0]).toEqual({ id: "call_next", type: "function", function: { name: "insert_node", arguments: '{"parentId":"n1"}' } });
  });

  it("handles reasoning stream separation and message type mapping in Responses", async () => {
    const deltas = [];
    for await (const delta of completeStream(
      { ...echoProvider, api: "responses" },
      [{ role: "user", content: "inspect" }],
      undefined,
      { fetch: async () => streamed({ type: "response.reasoning_summary_text.delta", delta: "Thinking." }, { type: "response.output_text.delta", delta: "Done." }) }
    )) deltas.push(delta);

    expect(deltas.map((d) => d.reasoning).filter(Boolean)).toEqual(["Thinking."]);
    expect(deltas.map((d) => d.content).filter(Boolean)).toEqual(["Done."]);

    let posted: any;
    await complete({ ...echoProvider, api: "responses" }, [{ role: "user", content: "q" }, { role: "assistant", content: "a" }], {
      fetch: async (_i, init) => { posted = JSON.parse(String(init?.body)); return jsonResponse({ output: [] }); }
    });
    expect(posted?.input[0].content[0].type).toBe("input_text");
    expect(posted?.input[1].content[0].type).toBe("output_text");
  });
});

describe("H2 credentials & model catalog discovery", () => {
  it("resolves configured providers, keys, and model validation", () => {
    expect(loadProvider("vercel", {})).toBeNull();
    expect(listConfiguredProviders({})).toEqual([]);

    const configured = listConfiguredProviders({ DASHSCOPE_API_KEY: "sk-qwen", VERCEL_API_KEY: "v-key" });
    expect(configured.map((p) => p.id)).toEqual(["vercel", "qwen-studio"]);
    expect(JSON.stringify(configured)).not.toContain("v-key");

    const pVercel = loadProvider("vercel", { VERCEL_API_KEY: "v-key" }, "gpt-5.6-luna");
    expect(pVercel).toMatchObject({ baseUrl: "https://ai-gateway.vercel.sh/v1", model: "gpt-5.6-luna", apiKey: "v-key", vision: true });

    const pOpenCode = loadProvider("opencode-go", { OPENCODE_API_KEY: "sk-live" }, "glm-5.2");
    expect(pOpenCode).toMatchObject({ baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2", apiKey: "sk-live" });

    expect(() => loadProvider("opencode-go", { OPENCODE_API_KEY: "k" }, "gpt-9-imaginary")).toThrow(UnknownModelError);
    expect(loadProvider("opencode-go", { OPENCODE_API_KEY: "k" })?.model).toBeTruthy();
  });

  it("resolves vision model handoffs across providers (OpenCode, Gemini, xAI, Qwen)", () => {
    expect(visionModelFor("opencode-go")?.id).toBe("gpt-5.6-luna");
    expect(visionModelFor("opencode-go", ["gpt-5.6-luna"])?.id).toBe("grok-4.5");
    expect(visionModelFor("qwen-studio")).toBeUndefined();

    const handoff = loadVisionProvider("opencode-go", { OPENCODE_API_KEY: "k" }, ["deepseek-v4-pro"], "high");
    expect(handoff).toMatchObject({ id: "opencode-go", model: "gpt-5.6-luna", apiKey: "k", vision: true, reasoningEffort: "high" });

    const gemini = loadProvider("gemini", { GEMINI_API_KEY: "gk" }, "gemini-3.7-flash", "high");
    expect(gemini).toMatchObject({ baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.7-flash", vision: true });

    const xai = loadProvider("xai", { XAI_API_KEY: "xk" }, "grok-4.6", "high");
    expect(xai).toMatchObject({ baseUrl: "https://api.x.ai/v1", model: "grok-4.6", api: "responses", vision: true });
  });
});

describe("H3 session tool loop & conversational handling", () => {
  it("emits tool_start before execution and handles conversational questions without empty builds", async () => {
    const { events } = await runTestSequence(
      makeDoc(frame("hero", 390, 300)),
      [["generate_image", { prompt: "A cat in sunlight", nodeId: "hero" }], "Done."],
      { prompt: "add a portrait", provider: echoProvider }
    );

    const start = events.find((e) => e.type === "tool_start");
    expect(start?.type === "tool_start" && start.name).toBe("generate_image");
    expect(start?.type === "tool_start" && start.detail).toBe("A cat in sunlight");

    // Conversational question handling (answer_user)
    const convEvents = await collectSession(async () => callsSse("answer_user", { reply: "I am Pen AI." }));
    const done = convEvents.find((e) => e.type === "done");
    expect(done?.type === "done" && done.messages.at(-1)?.content).toBe("I am Pen AI.");
    expect(convEvents.some((e) => e.type === "tool")).toBe(false);
  });

  it("handles multi-tool streams, unmatched answers, and JSON parse errors gracefully", async () => {
    // Conversational plain-text fallback
    const { events: convEvents } = await runTestSequence(
      makeDoc(),
      [saysSse("Hi!"), callsSse("answer_user", { reply: "Hi!" })],
      { prompt: "hello", provider: echoProvider }
    );
    const convDone = convEvents.find((e) => e.type === "done");
    expect(convDone?.type === "done" && convDone.messages.at(-1)?.content).toBe("Hi!");

    // Multi-tool emission
    let multiReqs = 0;
    const multiEvents = await collectSession(async () => {
      multiReqs++;
      return multiReqs === 1
        ? streamed({
            choices: [{ delta: { tool_calls: [
              { index: 0, id: "c1", function: { name: "read_digest", arguments: "{}" } },
              { index: 1, id: "c2", function: { name: "read_digest", arguments: "{}" } }
            ] } }]
          })
        : saysSse("finished");
    });
    expect(multiEvents.filter((e) => e.type === "tool")).toHaveLength(2);

    // Malformed JSON tool arguments recovery
    let badReqs = 0;
    const badEvents = await collectSession(async () => {
      badReqs++;
      return badReqs === 1
        ? streamed({
            choices: [{ delta: { tool_calls: [{ index: 0, id: "bad", function: { name: "read_digest", arguments: "{not json" } }] } }]
          })
        : saysSse("recovered");
    });
    const toolEv = badEvents.find((e) => e.type === "tool");
    expect(toolEv?.type === "tool" && toolEv.result.toLowerCase()).toContain("json");
  });
});

describe("H4 document tools specification", () => {
  it("provides type-safe execution and digest inspection for all tools", async () => {
    const session = createDocumentTools(makeDoc(frame("f", 200, 100, [rect("r", 40, 40)], { gap: 8 })));
    for (const def of TOOL_DEFS) {
      const result = await session.execute(def.name, {});
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }

    const invalid = await session.execute("set_property", { id: "r", property: "invalid_prop", value: 9 });
    expect(invalid.toLowerCase()).toContain("error");

    const valid = await session.execute("set_property", { id: "f", property: "gap", value: 24 });
    expect(valid).toContain("g24");
    expect(digest(session.doc)).toContain("g24");

    // Document aliases ("root", "document", "canvas")
    const whole = await session.execute("read_digest", {});
    const aliased = await session.execute("read_digest", { id: "root" });
    expect(aliased).toBe(whole);
  });

  it("handles Lucide icon search, insert, and geometry resolution", async () => {
    const session = createDocumentTools(makeDoc(frame("f", 200, 100, [])));

    // Search
    const searchRes = await session.execute("search_icons", { query: "heart" });
    expect(searchRes).toContain("heart");

    // Insert icon with embedded vector geometry
    const insRes = await session.execute("insert_icon", { icon: "star", parentId: "f", size: 28, stroke: "#3B82F6" });
    expect(insRes).toContain("inserted Lucide icon \"star\"");
    const iconNode = session.doc.children[0].children?.[0] as any;
    expect(iconNode.icon).toBe("star");
    expect(typeof iconNode.geometry).toBe("string");

    // Insert icon through insert_node subtree
    await session.execute("insert_node", {
      parentId: "f",
      node: { type: "frame", id: "row", layout: "horizontal", children: [{ type: "icon", id: "bm", icon: "bookmark" }] }
    });
    const subIcon = session.doc.children[0].children?.[1].children?.[0] as any;
    expect(subIcon.geometry).toBe(getLucideIconPath("bookmark"));

    // Icon rename preserves / updates geometry
    await session.execute("set_property", { id: iconNode.id, property: "icon", value: "heart" });
    expect((session.doc.children[0].children?.[0] as any).geometry).toBe(getLucideIconPath("heart"));

    // Compound icons with relative checkmarks (badge-check / verified) correctly normalize absolute start and relative lineto
    const badgeCheckPath = getLucideIconPath("badge-check");
    expect(badgeCheckPath).toContain("M 9 12 l 2 2 4-4");
    expect(getLucideIconPath("verified")).toBe(badgeCheckPath);
  });

  it("resolves image generation across providers (Qwen, Gemini, xAI)", async () => {
    // Qwen Image Generation
    let qwenPosted: any;
    const qwenImg = await generateDesignImage("Stallion sunset", {
      aspectRatio: "portrait",
      env: { QWEN_API_KEY: "sk-test", QWEN_BASE_URL: "https://workspace.test/v1" },
      fetch: async (_i, init) => { qwenPosted = JSON.parse(String(init?.body)); return jsonResponse({ output: { choices: [{ message: { content: [{ image: "https://images.test/horse.png" }] } }] } }); }
    });
    expect(qwenImg).toEqual({ url: "https://images.test/horse.png", provider: "qwen" });
    expect(qwenPosted.parameters.size).toBe("768*1024");

    // Gemini Image Generation
    const geminiSession = createDocumentTools(makeDoc(frame("avatar", 64, 64)), {
      providerId: "gemini",
      apiKey: "k",
      fetch: async () => jsonResponse({ steps: [{ type: "model_output", content: [{ type: "image", data: "aW1hZ2U=", mime_type: "image/png" }] }] })
    });
    const geminiRes = await geminiSession.execute("generate_image", { prompt: "Horse", nodeId: "avatar" });
    expect(geminiRes).toContain("generated image (gemini)");
    expect(geminiSession.doc.children[0].fill).toEqual({ type: "image", url: "data:image/png;base64,aW1hZ2U=" });

    // xAI Image Generation
    const xaiSession = createDocumentTools(makeDoc(frame("hero", 320, 180)), {
      providerId: "xai",
      apiKey: "k",
      fetch: async () => jsonResponse({ data: [{ b64_json: "aW1hZ2U=" }] })
    });
    const xaiRes = await xaiSession.execute("generate_image", { prompt: "Horse", nodeId: "hero" });
    expect(xaiRes).toContain("generated image (xai)");
    expect(xaiSession.doc.children[0].fill).toEqual({ type: "image", url: "data:image/jpeg;base64,aW1hZ2U=" });
  });
});

describe("Selection context & stream tool assembly", () => {
  it("formats selection headers in prompts and handles aliases", () => {
    const doc = makeDoc(frame("screen", 390, 844, [frame("header", 390, 64), frame("body", 390, 400)]));
    expect(agentSystemPrompt(doc, ["header"])).toContain("Selection: header");
    expect(agentSystemPrompt(doc, [])).toContain("nothing is selected");
    expect(agentSystemPrompt(doc, ["header", "body"])).toContain("Selection: 2 nodes");
  });

  it("assembles chunked tool calls and preserves Gemini thought signatures", async () => {
    const calls = assembleToolCalls([
      [{ index: 0, id: "c1", name: "set_property", arguments: "" }],
      [{ index: 0, arguments: '{"id":"f1","property":"fill","value":"#fff"}' }]
    ]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ id: "f1", property: "fill", value: "#fff" });

    // Gemini thought signatures
    const signature = "enc-signature";
    let geminiPosted: any;
    const first = await Array.fromAsync(completeStream(
      { ...echoProvider, id: "gemini" },
      [{ role: "user", content: "tool" }],
      [{ name: "ping", description: "p", parameters: { type: "object" } }],
      { fetch: async () => streamed({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "ping", arguments: "{}" }, extra_content: { google: { thought_signature: signature } } }] } }] }) }
    ));
    const assembled = assembleToolCalls(first.map((d) => d.toolCallParts));
    await Array.fromAsync(completeStream(
      { ...echoProvider, id: "gemini" },
      [{ role: "user", content: "tool" }, { role: "assistant", content: "", tool_calls: assembled }, { role: "tool", content: "pong", tool_call_id: "c1" }],
      undefined,
      { fetch: async (_i, init) => { geminiPosted = JSON.parse(String(init?.body)); return streamed(); } }
    ));
    expect(geminiPosted?.messages[1].tool_calls?.[0].extra_content?.google?.thought_signature).toBe(signature);
  });
});

describe("Property measurement, oscillation detection & synthetic instances", () => {
  const cardSession = () => createDocumentTools(makeDoc(
    frame("card", 350, 200, [{ type: "text", id: "t1", content: "Content", fontSize: 14, width: "fill_container" } as any], { name: "Card", layout: "vertical", gap: 8, padding: 16 })
  ));

  it("reports resolved geometry and detects oscillations", async () => {
    const s = cardSession();
    const res = await s.execute("set_property", { id: "card", property: "height", value: "fit_content" });
    expect(res).toContain("measured:");

    const noChange = await s.execute("set_property", { id: "card", property: "height", value: "fit_content" });
    expect(noChange).toContain("no change");

    await s.execute("set_property", { id: "card", property: "height", value: 250 });
    await s.execute("set_property", { id: "card", property: "height", value: 450 });
    const osc = await s.execute("set_property", { id: "card", property: "height", value: 250 });
    expect(osc).toContain("back to one it already had");

    const batchRes = await s.execute("batch_set_properties", {
      updates: [{ id: "card", property: "height", value: 90 }, { id: "t1", property: "fontSize", value: 16 }]
    });
    expect(batchRes).toContain("ok: updated 2 properties");
  });

  it("writes through synthetic instance IDs handed by measure", async () => {
    const session = createDocumentTools(makeDoc(
      frame("list", 350, 400, [frame("row", "fill_container", 64, [{ type: "text", id: "row_name", content: "Miso", fontSize: 16 } as any], { name: "Row" })], { name: "Matches" })
    ));
    await session.execute("place_instances", { componentId: "row", parentId: "list", items: [{ row_name: { content: "Pepper" } }] });

    const measured = await session.execute("measure", { id: "list" });
    const synthetic = measured.match(/ref_\d+:[a-z_0-9]+/)?.[0]!;
    expect(synthetic).toBeTruthy();

    const writeRes = await session.execute("set_property", { id: synthetic, property: "height", value: 96 });
    expect(writeRes).toContain("inside instance");
    expect((session.doc.children[0] as any).children[1].descendants.row_name.content).toBe("Pepper");
  });
});

describe("Icon catalog standalone resolution & subprocess verification", () => {
  it("resolves catalog icons across processes and multi-word queries", () => {
    expect(iconCatalogAvailable()).toBe(true);
    expect(getAllLucideIconNames().length).toBeGreaterThan(1500);
    expect(searchLucideIcons("cat paw", 6)).toContain("cat");
    expect(searchLucideIcons("cat paw", 6)).toContain("paw-print");

    // Subprocess execution verification from external working directory
    const script = [
      `await import(${JSON.stringify(join(process.cwd(), "src/agent/tools.ts"))});`,
      `const { getLucideIconPath, searchLucideIcons, iconCatalogAvailable } = await import(${JSON.stringify(join(process.cwd(), "src/model/icons.ts"))});`,
      `console.log(JSON.stringify({ available: iconCatalogAvailable(), resolved: !!getLucideIconPath("paw-print"), search: searchLucideIcons("cat paw", 4) }));`
    ].join("\n");
    const proc = spawnSync("bun", ["-e", script], { cwd: tmpdir(), encoding: "utf-8" });
    expect(proc.status).toBe(0);
    const out = JSON.parse(proc.stdout.trim().split("\n").pop()!);
    expect(out.available).toBe(true);
    expect(out.resolved).toBe(true);
    expect(out.search).toContain("paw-print");
  });
});
