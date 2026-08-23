import { describe, it, expect } from "bun:test";
import { craftMetrics } from "../eval/metrics";
import { stat, summarize, compare } from "../eval/report";
import type { RunFile, RunRow } from "../eval/run";
import { briefSetHash } from "../eval/run";
import { BRIEFS } from "../eval/briefs";
import { makeDoc, frame, txt, rect } from "./harness";
import { runSession } from "../src/agent/session";
import { childrenOf, isNode } from "../src/model/tree";
import type { Provider, FetchFn } from "../src/agent/provider";
import type { Document } from "../src/model/types";
import { streamed, saysSse, callsSse } from "./agent-harness";

const testProvider: Provider = {
  id: "vercel",
  baseUrl: "https://example.test/v1",
  model: "test",
  apiKey: "k"
};

function roundSse(calls: Array<[string, unknown]>, seed = 0): Response {
  return streamed({
    choices: [{
      delta: {
        tool_calls: calls.map(([name, args], index) => ({
          index,
          id: `c${seed}_${index}`,
          function: { name, arguments: JSON.stringify(args) }
        }))
      }
    }]
  });
}

function scriptedFetch(responses: Array<() => Response | Promise<Response>>): FetchFn {
  let i = 0;
  return async () => {
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return next();
  };
}

async function collect(gen: AsyncGenerator<{ type: string }>) {
  const events: { type: string }[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe("craft metrics specification", () => {
  it("evaluates layout, spacing, screens, and empty containers", () => {
    // Screen status bar detection
    const withBar = makeDoc(frame("s1", 390, 844, [frame("sb", 390, 62, [], { name: "Status Bar" })], { name: "Home" }));
    const without = makeDoc(frame("s1", 390, 844, [rect("r", 10, 10)], { name: "Home" }));
    expect(craftMetrics(withBar).screens).toBe(1);
    expect(craftMetrics(without).screens).toBe(0);

    // Spacing on/off 4px grid
    const spacingDoc = makeDoc(
      frame("a", 100, 100, [
        frame("b", 100, 100, [], { gap: 12, padding: 16 }),
        frame("c", 100, 100, [], { gap: 12, padding: [10, 6] })
      ], { gap: 24 })
    );
    const mSpacing = craftMetrics(spacingDoc);
    expect(mSpacing.spacingValues).toBe(5);
    expect(mSpacing.spacingOffGrid).toBe(2);

    // Empty vs filled / photographic frames
    expect(craftMetrics(makeDoc(frame("hero", 300, 200, [], { fill: { type: "image", url: "x" } }))).emptyFrames).toBe(0);
    expect(craftMetrics(makeDoc(frame("spacer", 100, 24))).emptyFrames).toBe(1);
    expect(craftMetrics(makeDoc(frame("divider", 100, 1, [], { fill: "$border-subtle" }))).emptyFrames).toBe(0);
  });

  it("evaluates typography range, tokens, and prose unwrapping", () => {
    // Type sizes and scale range
    const flat = makeDoc(frame("a", 100, 100, [txt("t1", "a", 16), txt("t2", "b", 16)]));
    const ranged = makeDoc(frame("a", 100, 100, [txt("t1", "a", 11), txt("t2", "b", 44)]));
    expect(craftMetrics(flat).typeRange).toBe(1);
    expect(craftMetrics(flat).typeSizes).toBe(1);
    expect(craftMetrics(ranged).typeRange).toBe(4);

    // Accent fills & token coverage
    const colorDoc = makeDoc(
      frame("cta", 100, 44, [
        rect("r1", 10, 10, { fill: "$accent-primary" }),
        rect("r2", 10, 10, { fill: "$surface-primary" }),
        rect("r3", 10, 10, { fill: "#ff00aa" }),
        rect("r4", 10, 10, { fill: { type: "color", color: "$accent-primary" } })
      ], { fill: "$accent-primary" }),
      { type: "icon", id: "i1", icon: "heart", stroke: "$accent-primary" } as any,
      txt("t1", "Save", 14, { fill: "$accent-primary" })
    );
    const mColor = craftMetrics(colorDoc);
    expect(mColor.accentFills).toBe(3);
    expect(mColor.tokenCoverage).toBeGreaterThan(0.5);

    // Prose wrapping
    const long = "A sentence comfortably longer than forty characters lives here.";
    expect(craftMetrics(makeDoc(txt("t", long, 14))).unwrappedProse).toBe(1);
    expect(craftMetrics(makeDoc(txt("t", long, 14, { textGrowth: "fixed-width" }))).unwrappedProse).toBe(0);
    expect(craftMetrics(makeDoc(txt("t", "Short label", 14))).unwrappedProse).toBe(0);
  });

  it("evaluates component reuse, nesting depth, and empty document bounds", () => {
    const compDoc = makeDoc(
      frame("row", 100, 40, [], { reusable: true }),
      frame("list", 100, 200, [
        { type: "ref", id: "i1", ref: "row" } as any,
        { type: "ref", id: "i2", ref: "row" } as any
      ])
    );
    expect(craftMetrics(compDoc).components).toBe(1);
    expect(craftMetrics(compDoc).reuseRatio).toBeCloseTo(0.5, 2);

    const deep = makeDoc(frame("a", 100, 100, [frame("b", 90, 90, [frame("c", 80, 80, [rect("r", 10, 10)])])]));
    expect(craftMetrics(deep).depth).toBe(4);

    const empty = craftMetrics(makeDoc());
    expect(empty.nodes).toBe(0);
    expect(empty.tokenCoverage).toBe(0);
    expect(empty.reuseRatio).toBe(0);
    expect(empty.typeRange).toBe(0);
    expect(Number.isFinite(empty.typeRange)).toBe(true);
  });
});

describe("eval reporting & cohort comparisons", () => {
  function row(over: Partial<RunRow> = {}): RunRow {
    return {
      brief: "horses",
      surface: "mobile",
      attempt: 1,
      ok: true,
      seconds: 30,
      turns: 6,
      calls: {},
      toolErrors: 0,
      blockers: 0,
      warnings: 0,
      byRule: {},
      metrics: craftMetrics(makeDoc()),
      ...over
    };
  }

  function file(rows: RunRow[], over: Partial<RunFile> = {}): RunFile {
    return {
      provider: "vercel",
      model: "test",
      briefHash: "abc",
      at: "t",
      rows,
      ...over
    };
  }

  it("computes statistics and formats summary reports", () => {
    expect(stat([1, 1, 1, 1, 96]).median).toBe(1);
    expect(stat([1, 1, 1, 1, 96]).max).toBe(96);
    expect(stat([2, 4]).median).toBe(3);
    expect(stat([]).median).toBe(0);

    const outSummary = summarize([
      row({ blockers: 2, byRule: { text_clipped: 2 } }),
      row({ attempt: 2, ok: false, error: "turn budget spent", metrics: { ...craftMetrics(makeDoc()), screens: 4 } })
    ]);
    expect(outSummary).toContain("text_clipped");
    expect(outSummary).toContain("Blockers by rule");
    expect(outSummary).toContain("did not finish");
    expect(outSummary).toContain("turn budget spent");
  });

  it("compares valid cohorts and reports regressions/improvements", () => {
    const before = file([row({ blockers: 10, metrics: { ...craftMetrics(makeDoc()), components: 3, screens: 1 } })]);
    const after = file([row({ blockers: 2, metrics: { ...craftMetrics(makeDoc()), components: 0, screens: 4 } })]);
    const out = compare(after, before);
    expect(out).toMatch(/blockers.*-8.*better/);
    expect(out).toMatch(/components.*-3.*worse/);

    const samePair = compare(
      file([row({ blockers: 1 }), row({ attempt: 2, blockers: 3 })]),
      file([row({ blockers: 4 }), row({ attempt: 2, blockers: 6 })])
    );
    expect(samePair).toContain("Comparing 2 completed pairs");
    expect(samePair).toMatch(/blockers.*-3.*better/);
  });

  it("handles failed pair exclusions and rejects invalid comparisons", () => {
    const failedBefore = file([row({ blockers: 10 }), row({ attempt: 2, ok: false, error: "budget", blockers: 99 })]);
    const failedAfter = file([row({ blockers: 2 }), row({ attempt: 2, ok: false, error: "budget", blockers: 0 })]);
    const outFailed = compare(failedAfter, failedBefore);
    expect(outFailed).toContain("failed");
    expect(outFailed).toContain("horses #2");
    expect(outFailed).toMatch(/blockers.*-8.*better/);
    expect(outFailed).not.toContain("99");

    const rows = [row()];
    expect(compare(file(rows), file([row(), row({ attempt: 2 })]))).toMatch(/row keys differ/);
    expect(compare(file([row({ brief: "horses" }), row({ brief: "horses" })]), file([row({ brief: "horses" }), row({ brief: "horses" })]))).toMatch(/duplicate row key/);
    expect(compare(file(rows, { briefHash: briefSetHash([{ id: "horses", text: "a" }]) }), file(rows, { briefHash: briefSetHash([{ id: "horses", text: "b" }]) }))).toMatch(/brief set changed/);
    expect(compare(file(rows, { provider: "a" }), file(rows, { provider: "b" }))).toMatch(/provider/);
    expect(compare(file(rows, { model: "a" }), file(rows, { model: "b" }))).toMatch(/model/);
    expect(compare(file(rows, { provider: "" }), file(rows))).toMatch(/missing provider/);
    expect(compare(file(rows, { briefHash: "" }), file(rows))).toMatch(/missing brief/);
  });
});

describe("brief set integrity", () => {
  it("guarantees unique IDs and surface diversity without prescriptive keywords", () => {
    expect(new Set(BRIEFS.map((b) => b.id)).size).toBe(BRIEFS.length);
    expect(BRIEFS.some((b) => b.surface === "mobile")).toBe(true);
    expect(BRIEFS.some((b) => b.surface === "desktop")).toBe(true);

    for (const b of BRIEFS) {
      expect(b.text.length).toBeLessThan(90);
      expect(b.text).not.toMatch(/status bar|tab bar|padding|column|px\b|header|sidebar/i);
    }
  });
});

describe("agent session lifecycle & stall detection", () => {
  it("handles provider failure codes and completion signals", async () => {
    const failing: FetchFn = async () => new Response("upstream is down", { status: 502 });
    const errEvents = await collect(runSession(testProvider, [{ role: "user", content: "build" }], { version: "1.0", children: [] } as Document, { fetch: failing }));
    expect(errEvents.some((e) => e.type === "error" && (e as any).code === "provider")).toBe(true);
    expect(errEvents.filter((e) => e.type === "done")).toHaveLength(0);

    const cleanEvents = await collect(runSession(testProvider, [{ role: "user", content: "hi" }], makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])), { fetch: async () => saysSse("All done") }));
    expect(cleanEvents.filter((e) => e.type === "done")).toHaveLength(1);
    expect(cleanEvents.filter((e) => e.type === "error")).toHaveLength(0);
  });

  it("detects no-progress and oscillating property stalls", async () => {
    // 1. Rejected edit stall
    let calls = 0;
    const stallEvents = await collect(runSession(
      testProvider,
      [{ role: "user", content: "edit" }],
      makeDoc(frame("f", 100, 100)),
      {
        maxTurns: 10,
        fetch: async () => {
          calls += 1;
          return callsSse("set_property", { id: "ghost", property: "x", value: calls }, `c${calls}`);
        }
      }
    ));
    const errors = stallEvents.filter((e) => e.type === "error") as any[];
    expect(calls).toBe(4);
    expect(errors[0].code).toBe("budget");
    expect(errors[0].message).toContain("no canvas progress");

    // 2. Oscillation stall
    let oscCalls = 0;
    const oscPosted: string[] = [];
    const oscEvents = await collect(runSession(
      testProvider,
      [{ role: "user", content: "fix" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 20,
        fetch: async (_in, init) => {
          oscPosted.push(String(init?.body));
          oscCalls += 1;
          const value = oscCalls % 2 === 1 ? "none" : "vertical";
          return callsSse("set_property", { id: "f", property: "layout", value }, `c${oscCalls}`);
        }
      }
    ));
    const oscErrors = oscEvents.filter((e) => e.type === "error") as any[];
    expect(oscCalls).toBe(6);
    expect(oscErrors[0].message).toContain("undoing its own edits");

    const sent = JSON.parse(oscPosted.at(-1)!) as { messages: Array<{ role: string; content: unknown }> };
    const note = JSON.stringify(sent.messages.filter((m) => m.role === "user"));
    expect(note).toContain("back to values they already held");
  });

  it("differentiates active construction and research sequences from stalls", async () => {
    // Constructing while adjusting
    let mixCalls = 0;
    const mixEvents = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 12,
        fetch: async () => {
          mixCalls += 1;
          if (mixCalls > 8) return saysSse("built it");
          return roundSse([
            ["set_property", { id: "f", property: "layout", value: mixCalls % 2 === 1 ? "none" : "vertical" }],
            ["insert_node", { parentId: "f", node: { type: "rectangle", id: `n${mixCalls}`, width: 10, height: 10 } }]
          ], mixCalls);
        }
      }
    ));
    expect(mixEvents.filter((e) => e.type === "done")).toHaveLength(1);

    // Read-measure-search sequence
    const readEvents = await collect(runSession(
      testProvider,
      [{ role: "user", content: "edit" }],
      makeDoc(frame("f", 100, 100)),
      {
        fetch: scriptedFetch([
          () => callsSse("read_digest", {}),
          () => callsSse("measure", { id: "f" }),
          () => callsSse("search_icons", { query: "heart" }),
          () => saysSse("done")
        ])
      }
    ));
    expect(readEvents.filter((e) => e.type === "done")).toHaveLength(1);
  });


  it("running out of rounds on a clean document finishes instead of erroring", async () => {
    /*
     * A logged run built a 144-node dashboard, one screen, zero blockers, and
     * ended on a budget error, because the loop reported why it stopped rather
     * than what it made.
     */
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 3,
        fetch: async () => {
          calls += 1;
          return callsSse("set_property", { id: "r", property: "width", value: 40 + calls }, `c${calls}`);
        }
      }
    ));
    const last = events.at(-1)!;
    expect(last.type).toBe("done");
  });

  it("running out of rounds on active document completes gracefully", async () => {
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build" }],
      makeDoc(frame("f", 200, 200, [txt("t", "")])),
      {
        maxTurns: 3,
        fetch: async () => {
          calls += 1;
          return callsSse("set_property", { id: "f", property: "width", value: 200 + calls }, `c${calls}`);
        }
      }
    ));
    const last = events.at(-1) as { type: string };
    expect(last.type).toBe("done");
  });

  it("manages round budget ceilings, warnings, and cancellation signals", async () => {
    // Budget warning insertion
    const posted: string[] = [];
    let warnCalls = 0;
    await collect(runSession(
      testProvider,
      [{ role: "user", content: "build" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 5,
        fetch: async (_in, init) => {
          posted.push(String(init?.body));
          warnCalls += 1;
          return callsSse("insert_node", { parentId: "f", node: { type: "rectangle", id: `n${warnCalls}`, width: 10, height: 10 } }, `c${warnCalls}`);
        }
      }
    ));
    const sent = JSON.parse(posted.at(-1)!) as { messages: Array<{ content: unknown }> };
    const warnings = sent.messages.filter((m) => JSON.stringify(m.content).includes("rounds left"));
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings[0].content)).toContain("3 rounds left");
    // The wrap-up has to push density up, not caution up: counting down at the
    // model measurably cost 21% of the tool calls per round in the logged runs.
    expect(JSON.stringify(warnings[0].content)).toContain("one tool call or twenty");
    expect(JSON.stringify(warnings[0].content)).toContain("batch_set_properties");

    // Abort controller propagation
    const ac = new AbortController();
    let abortCalls = 0;
    const abortEvents = await collect(runSession(
      testProvider,
      [{ role: "user", content: "edit" }],
      makeDoc(frame("f", 100, 100, [rect("r", 10, 10)])),
      {
        fetch: async (_in) => {
          abortCalls += 1;
          if (abortCalls === 1) return callsSse("read_digest", {});
          ac.abort();
          throw new DOMException("aborted", "AbortError");
        },
        signal: ac.signal
      }
    ));
    expect(abortEvents.some((e) => e.type === "error" && (e as any).code === "aborted")).toBe(true);
    expect(abortEvents.filter((e) => e.type === "done")).toHaveLength(0);
  });
});

describe("document mutation payload routing & model verification", () => {
  it("routes document payloads only on actual state mutations", async () => {
    // read_digest -> no doc payload
    const readEvents = await collect(runSession(
      testProvider,
      [{ role: "user", content: "summarise" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      { fetch: scriptedFetch([() => callsSse("read_digest", {}), () => saysSse("ok")]) }
    ));
    const readTool = readEvents.find((e) => e.type === "tool") as { doc?: Document };
    expect(readTool).toBeDefined();
    expect(readTool.doc).toBeUndefined();

    // create_screen -> carries mutated doc
    const createEvents = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build" }],
      { version: "1.0", children: [] } as Document,
      { fetch: scriptedFetch([() => callsSse("create_screen", { name: "Home", kind: "mobile" }), () => saysSse("ok")]) }
    ));
    const createTool = createEvents.find((e) => e.type === "tool") as { name?: string; doc?: Document };
    expect(createTool?.name).toBe("create_screen");
    expect(createTool?.doc?.children.length).toBeGreaterThan(0);

    // place_instances -> carries mutated doc
    const placeEvents = await collect(runSession(
      testProvider,
      [{ role: "user", content: "place" }],
      makeDoc(frame("row", 100, 40, [], { reusable: true }), frame("list", 100, 200)),
      { fetch: scriptedFetch([() => callsSse("place_instances", { componentId: "row", parentId: "list", items: [{}] }), () => saysSse("ok")]) }
    ));
    const placeTool = placeEvents.find((e) => e.type === "tool") as { name?: string; doc?: Document };
    expect(placeTool?.name).toBe("place_instances");
    expect(placeTool?.doc).toBeDefined();

    // failed mutation -> omits doc and reports error
    const failEvents = await collect(runSession(
      testProvider,
      [{ role: "user", content: "edit" }],
      makeDoc(frame("f", 100, 100)),
      { fetch: scriptedFetch([() => callsSse("set_property", { id: "missing", property: "width", value: 40 }), () => saysSse("ok")]) }
    ));
    const failTool = failEvents.find((e) => e.type === "tool") as { doc?: Document; result?: string };
    expect(failTool?.result).toMatch(/^error:/);
    expect(failTool?.doc).toBeUndefined();
  });

  it("checks screen completion verification and tree traversal safety", async () => {
    // Prompted back on premature empty completion
    let empCalls = 0;
    const empEvents = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build" }],
      makeDoc(),
      {
        maxTurns: 3,
        fetch: async () => {
          empCalls += 1;
          return empCalls === 1 ? saysSse("All done!") : callsSse("create_screen", { name: "Home", kind: "mobile" });
        }
      }
    ));
    expect(empCalls).toBeGreaterThan(1);
    expect(empEvents.some((e) => e.type === "tool")).toBe(true);

    // Tree traversal handles invalid non-node entries safely
    const broken = { type: "frame", id: "f", children: [null, "oops", { type: "text", id: "t" }] } as any;
    expect(() => childrenOf(broken)).not.toThrow();
    expect(childrenOf(broken).length).toBe(1);
    expect(isNode(null)).toBe(false);
    expect(childrenOf({ type: "frame", id: "f", children: [{ type: "text", id: "t" }] } as any)).toHaveLength(1);
  });

  it("records incremental trace deltas and session outcomes", async () => {
    const events: Record<string, unknown>[] = [];
    const gen = runSession(
      testProvider,
      [{ role: "user", content: "build a cat app" }],
      { version: "1.0", children: [] } as Document,
      {
        fetch: scriptedFetch([
          () => callsSse("insert_node", { node: { type: "frame", id: "f1", name: "Card", width: 200, height: 100, children: [] } }),
          () => saysSse("done")
        ]),
        trace: (e) => events.push(e)
      }
    );
    for await (const _ of gen) { /* drain */ }

    const requests = events.filter((e) => e.type === "model_request");
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every((r) => !("messages" in r))).toBe(true);

    const outcome = events.find((e) => e.type === "outcome");
    expect(outcome).toBeDefined();
    expect(outcome!.reason).toBe("model finished");
    expect(outcome!.nodes).toBe(1);
    expect(outcome!.toolCalls).toEqual({ insert_node: 1 });
  });
});

/* ------------------------------------------------------------------ *
 * A reply the provider cut off is not a reply
 * ------------------------------------------------------------------ */

/** A stream that thinks, then stops because the output cap was reached. */
const truncatedSse = (reasoning: string) =>
  streamed(
    { choices: [{ delta: { reasoning_content: reasoning } }] },
    { choices: [{ delta: {}, finish_reason: "length" }] }
  );

describe("a truncated reply is not a finished one", () => {
  it("asks again instead of shipping what the model was cut off part-way through", async () => {
    // The run this is taken from: set_style, then four create_screen calls and
    // "I'll place real content into each", then 20,291 characters of reasoning
    // cut off mid-word with no tool call. The loop read that as "finished" and
    // shipped four screens holding a status bar and a tab bar.
    const responses = [
      () => callsSse("insert_node", { node: { type: "frame", name: "Home", width: 390, height: 844, children: [] } }),
      () => truncatedSse("Let me reconsider whether to change it.\n\nGiven"),
      () => callsSse("insert_node", { parentId: undefined, node: { type: "text", content: "Tonight", fontSize: 28 } }),
      () => saysSse("Done.")
    ];
    const events = await collect(
      runSession(testProvider, [{ role: "user", content: "build it" }], makeDoc(), {
        fetch: scriptedFetch(responses),
        maxTurns: 8
      })
    );

    // It carried on rather than stopping at the cut-off round.
    expect(events.filter((e) => e.type === "tool")).toHaveLength(2);
    expect(events.at(-1)!.type).toBe("done");
  });

  it("tells the model where its tokens went, since it cannot see the cap from inside", async () => {
    const sent: any[] = [];
    const fetchFn = (() => {
      let i = 0;
      return async (_url: any, init: any) => {
        sent.push(JSON.parse(String(init.body)));
        i += 1;
        return i === 1 ? truncatedSse("thinking and thinking") : saysSse("ok");
      };
    })();

    await collect(
      runSession(testProvider, [{ role: "user", content: "hi" }], makeDoc(frame("s", 390, 844)), {
        fetch: fetchFn as any,
        maxTurns: 4
      })
    );

    const nudge = JSON.stringify(sent.at(-1).messages);
    expect(nudge).toContain("cut off before any tool call");
    expect(nudge).toContain("ran out of output tokens");
  });

  it("gives up after two cut-off replies rather than burning the budget on them", async () => {
    const events = await collect(
      runSession(testProvider, [{ role: "user", content: "build" }], makeDoc(), {
        fetch: scriptedFetch([() => truncatedSse("thinking")]),
        maxTurns: 20
      })
    );

    const last = events.at(-1) as any;
    expect(last.type).toBe("error");
    expect(last.code).toBe("budget");
    expect(last.message).toContain("ran out of room to reply");
    // Three attempts: the first two are nudged, the third gives up.
    expect(events.filter((e) => e.type === "status")).toHaveLength(3);
  });

  it("sends an explicit output cap so the ceiling is ours, not the endpoint's", async () => {
    const sent: any[] = [];
    await collect(
      runSession(testProvider, [{ role: "user", content: "hi" }], makeDoc(frame("s", 390, 844)), {
        fetch: (async (_u: any, init: any) => {
          sent.push(JSON.parse(String(init.body)));
          return saysSse("ok");
        }) as any,
        maxTurns: 2
      })
    );
    expect(sent[0].max_completion_tokens ?? sent[0].max_tokens).toBe(16000);
  });
});

describe("a conversational reply written as prose", () => {
  it("is accepted after one push-back instead of being asked for three times", async () => {
    // "hello" cost four round-trips and two minutes: the model answered in
    // prose every time because it never reached for answer_user, and the loop
    // asked again until its correction budget ran out.
    const events = await collect(
      runSession(testProvider, [{ role: "user", content: "hello" }], makeDoc(), {
        fetch: scriptedFetch([() => saysSse("Hello! Tell me what you'd like to design.")]),
        maxTurns: 10
      })
    );

    expect(events.at(-1)!.type).toBe("done");
    // One ask, one re-ask, done — not four.
    expect(events.filter((e) => e.type === "status")).toHaveLength(2);
  });

  it("still presses a model that goes silent on an empty canvas", async () => {
    // No prose and no tool calls is not an answer, and it keeps the full budget.
    const events = await collect(
      runSession(testProvider, [{ role: "user", content: "design a cat app" }], makeDoc(), {
        fetch: scriptedFetch([() => streamed({ choices: [{ delta: {} }] })]),
        maxTurns: 10
      })
    );
    expect(events.filter((e) => e.type === "status").length).toBeGreaterThan(2);
  });
});

describe("what a truncated run changes about the next attempt", () => {
  it("asks for less deliberation, not just more politely", async () => {
    // The nudge is advice and advice is refusable: the run this came from had
    // already been told to act and spent another 17,914 characters thinking.
    const sent: any[] = [];
    let i = 0;
    const fetchFn = (async (_u: any, init: any) => {
      sent.push(JSON.parse(String(init.body)));
      i += 1;
      return i <= 2 ? truncatedSse("deliberating") : saysSse("ok");
    }) as any;

    await collect(
      runSession(
        { ...testProvider, reasoningEffort: "high" },
        [{ role: "user", content: "hi" }],
        makeDoc(frame("s", 390, 844)),
        { fetch: fetchFn, maxTurns: 6 }
      )
    );

    expect(sent.map((b) => b.reasoning_effort)).toEqual(["high", "medium", "low"]);
  });

  it("stops stepping down at low, because none is a different model", async () => {
    const sent: any[] = [];
    const fetchFn = (async (_u: any, init: any) => {
      sent.push(JSON.parse(String(init.body)));
      return truncatedSse("still deliberating");
    }) as any;

    await collect(
      runSession(
        { ...testProvider, reasoningEffort: "low" },
        [{ role: "user", content: "hi" }],
        makeDoc(frame("s", 390, 844)),
        { fetch: fetchFn, maxTurns: 6 }
      )
    );

    expect(new Set(sent.map((b) => b.reasoning_effort))).toEqual(new Set(["low"]));
  });

  it("leaves the effort alone on a run that was never cut off", async () => {
    const sent: any[] = [];
    await collect(
      runSession(
        { ...testProvider, reasoningEffort: "high" },
        [{ role: "user", content: "hi" }],
        makeDoc(frame("s", 390, 844)),
        {
          fetch: (async (_u: any, init: any) => {
            sent.push(JSON.parse(String(init.body)));
            return saysSse("ok");
          }) as any,
          maxTurns: 3
        }
      )
    );
    expect(sent.every((b) => b.reasoning_effort === "high")).toBe(true);
  });

  it("honours a provider that caps output lower than the default", async () => {
    // A ceiling above what an endpoint accepts is a 400 on every request, not
    // a shorter reply, so the catalog can state a lower one per provider.
    const sent: any[] = [];
    await collect(
      runSession(
        { ...testProvider, maxOutputTokens: 4096 },
        [{ role: "user", content: "hi" }],
        makeDoc(frame("s", 390, 844)),
        {
          fetch: (async (_u: any, init: any) => {
            sent.push(JSON.parse(String(init.body)));
            return saysSse("ok");
          }) as any,
          maxTurns: 2
        }
      )
    );
    expect(sent[0].max_completion_tokens ?? sent[0].max_tokens).toBe(4096);
  });
});
