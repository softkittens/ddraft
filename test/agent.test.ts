import { describe, it, expect } from "bun:test";
import { complete, type Provider, type Message, type FetchFn } from "../src/agent/provider";
import { loadProvider, listConfiguredProviders, UnknownModelError } from "../src/agent/credentials";
import { runAgent, type Tool } from "../src/agent/loop";
import { createDocumentTools, TOOL_DEFS } from "../src/agent/tools";
import { makeDoc, frame, rect } from "./harness";
import { digest } from "../src/digest/digest";
import { cloneDocument } from "../src/model/tree";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDocument } from "../src/model/parse";
import { agentSystemPrompt } from "../src/agent/prompt";
import { assembleToolCalls } from "../src/agent/stream";

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

const pingTool: Tool = {
  name: "ping",
  description: "ping",
  parameters: { type: "object", properties: { n: { type: "number" } } }
};

describe("H3 tool loop", () => {
  it("ends after one request when the reply has no tool calls", async () => {
    let requests = 0;
    const fakeComplete = async (): Promise<Message> => {
      requests++;
      return { role: "assistant", content: "done" };
    };
    const messages = await runAgent(echoProvider, [{ role: "user", content: "hi" }], [], async () => "ok", 8, fakeComplete);
    expect(requests).toBe(1);
    expect(messages.at(-1)?.content).toBe("done");
    expect(messages.filter((m) => m.role === "tool")).toHaveLength(0);
  });

  it("emits one tool message per call with matching tool_call_id", async () => {
    const fakeComplete = async (): Promise<Message> => ({
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "ping", arguments: "{\"n\":1}" } },
        { id: "call_2", type: "function", function: { name: "ping", arguments: "{\"n\":2}" } }
      ]
    });
    let once = false;
    const gated = async (): Promise<Message> => {
      if (!once) {
        once = true;
        return fakeComplete();
      }
      return { role: "assistant", content: "finished" };
    };
    const messages = await runAgent(echoProvider, [{ role: "user", content: "hi" }], [pingTool], async () => "pong", 8, gated);
    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["call_1", "call_2"]);
    expect(toolMsgs.every((m) => m.content === "pong")).toBe(true);
  });

  it("returns a parse error as a tool result and does not throw", async () => {
    let turn = 0;
    const fakeComplete = async (): Promise<Message> => {
      turn++;
      if (turn === 1) {
        return {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "bad", type: "function", function: { name: "ping", arguments: "{not json" } }]
        };
      }
      return { role: "assistant", content: "recovered" };
    };
    const messages = await runAgent(echoProvider, [{ role: "user", content: "hi" }], [pingTool], async () => "should-not-run", 8, fakeComplete);
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("bad");
    expect(String(toolMsg?.content).toLowerCase()).toContain("json");
    expect(messages.at(-1)?.content).toBe("recovered");
  });

  it("stops at maxTurns when the model keeps calling tools", async () => {
    let requests = 0;
    const fakeComplete = async (): Promise<Message> => {
      requests++;
      return {
        role: "assistant",
        content: "",
        tool_calls: [{ id: `c${requests}`, type: "function", function: { name: "ping", arguments: "{}" } }]
      };
    };
    const messages = await runAgent(echoProvider, [{ role: "user", content: "hi" }], [pingTool], async () => "ok", 3, fakeComplete);
    expect(requests).toBe(3);
    expect(messages.filter((m) => m.role === "tool")).toHaveLength(3);
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
  const doc = parseDocument(readFileSync(join(import.meta.dir, "../fixtures/A_control_r1.pen"), "utf-8"));

  // Regression guard for "look at this selection" -> the model guessing "root".
  it("names the selected node so 'this' has a referent", () => {
    const target = (doc.children[0] as any).children[0];
    const prompt = agentSystemPrompt(doc, [target.id]);
    expect(prompt).toContain(`Selection: ${target.id}`);
    expect(prompt).toContain('"this", "the selection" and "it" mean that node');
  });

  it("says so when nothing is selected", () => {
    expect(agentSystemPrompt(doc, [])).toContain("nothing is selected");
  });

  it("ignores ids that are not in the document", () => {
    expect(agentSystemPrompt(doc, ["ghost"])).toContain("nothing is selected");
  });

  it("lists every node when several are selected", () => {
    const kids = (doc.children[0] as any).children.slice(0, 2);
    const prompt = agentSystemPrompt(doc, kids.map((k: any) => k.id));
    expect(prompt).toContain("Selection: 2 nodes");
    for (const k of kids) expect(prompt).toContain(k.id);
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

