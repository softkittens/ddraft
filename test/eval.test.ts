import { describe, it, expect } from "bun:test";
import { craftMetrics } from "../eval/metrics";
import { stat, summarize, compare } from "../eval/report";
import type { RunFile, RunRow } from "../eval/run";
import { briefSetHash } from "../eval/run";
import { BRIEFS } from "../eval/briefs";
import { makeDoc, frame, txt, rect } from "./harness";

/* Every metric gets a document that should move it and one that should not.
 * A metric that cannot change is not measuring anything. */

describe("craft metrics", () => {
  it("counts a screen only when it carries a status bar", () => {
    const withBar = makeDoc(
      frame("s1", 390, 844, [frame("sb", 390, 62, [], { name: "Status Bar" })], { name: "Home" })
    );
    const without = makeDoc(frame("s1", 390, 844, [rect("r", 10, 10)], { name: "Home" }));
    expect(craftMetrics(withBar).screens).toBe(1);
    expect(craftMetrics(without).screens).toBe(0);
  });

  it("counts distinct spacing values and flags the ones off a 4px grid", () => {
    const doc = makeDoc(
      frame("a", 100, 100, [
        frame("b", 100, 100, [], { gap: 12, padding: 16 }),
        frame("c", 100, 100, [], { gap: 12, padding: [10, 6] })
      ], { gap: 24 })
    );
    const m = craftMetrics(doc);
    expect(m.spacingValues).toBe(5); // 12, 16, 24, 10, 6
    expect(m.spacingOffGrid).toBe(2); // 10 and 6
  });

  it("reports type range as the ratio of the largest size to the smallest", () => {
    const flat = makeDoc(frame("a", 100, 100, [txt("t1", "a", 16), txt("t2", "b", 16)]));
    const ranged = makeDoc(frame("a", 100, 100, [txt("t1", "a", 11), txt("t2", "b", 44)]));
    expect(craftMetrics(flat).typeRange).toBe(1);
    expect(craftMetrics(flat).typeSizes).toBe(1);
    expect(craftMetrics(ranged).typeRange).toBe(4);
  });

  it("counts the accent only where it paints a background", () => {
    // An icon stroked in the accent is emphasis, not a second primary action.
    // Counting those put a compliant three-screen document at eight.
    const doc = makeDoc(
      frame("cta", 100, 44, [], { fill: "$accent-primary" }),
      { type: "icon", id: "i1", icon: "heart", stroke: "$accent-primary" } as any,
      txt("t1", "Save", 14, { fill: "$accent-primary" })
    );
    expect(craftMetrics(doc).accentFills).toBe(1);
  });

  it("does not call a frame empty when it holds a photograph", () => {
    const photo = makeDoc(frame("hero", 300, 200, [], { fill: { type: "image", url: "x" } }));
    const bare = makeDoc(frame("hero", 300, 200));
    expect(craftMetrics(photo).emptyFrames).toBe(0);
    expect(craftMetrics(bare).emptyFrames).toBe(1);
  });

  it("separates token colours from literal ones", () => {
    const doc = makeDoc(
      frame("a", 100, 100, [
        rect("r1", 10, 10, { fill: "$accent-primary" }),
        rect("r2", 10, 10, { fill: "$surface-primary" }),
        rect("r3", 10, 10, { fill: "#ff00aa" })
      ])
    );
    const m = craftMetrics(doc);
    expect(m.tokenCoverage).toBeCloseTo(2 / 3, 2);
    expect(m.accentFills).toBe(1);
  });

  it("reads a colour out of an object fill, not only a string", () => {
    const doc = makeDoc(rect("r", 10, 10, { fill: { type: "color", color: "$accent-primary" } }));
    expect(craftMetrics(doc).accentFills).toBe(1);
    expect(craftMetrics(doc).tokenCoverage).toBe(1);
  });

  it("counts components and instances", () => {
    const doc = makeDoc(
      frame("row", 100, 40, [], { reusable: true }),
      frame("list", 100, 200, [
        { type: "ref", id: "i1", ref: "row" } as any,
        { type: "ref", id: "i2", ref: "row" } as any
      ])
    );
    const m = craftMetrics(doc);
    expect(m.components).toBe(1);
    expect(m.reuseRatio).toBeCloseTo(2 / 4, 2);
  });

  it("flags prose that never set a wrapping mode, and clears it when set", () => {
    const long = "A sentence comfortably longer than forty characters lives here.";
    expect(craftMetrics(makeDoc(txt("t", long, 14))).unwrappedProse).toBe(1);
    expect(
      craftMetrics(makeDoc(txt("t", long, 14, { textGrowth: "fixed-width" }))).unwrappedProse
    ).toBe(0);
    expect(craftMetrics(makeDoc(txt("t", "Short label", 14))).unwrappedProse).toBe(0);
  });

  it("counts an empty unfilled frame but not an empty filled one", () => {
    expect(craftMetrics(makeDoc(frame("spacer", 100, 24))).emptyFrames).toBe(1);
    expect(craftMetrics(makeDoc(frame("divider", 100, 1, [], { fill: "$border-subtle" }))).emptyFrames).toBe(0);
  });

  it("measures depth through nesting", () => {
    const shallow = makeDoc(frame("a", 100, 100, [rect("r", 10, 10)]));
    const deep = makeDoc(frame("a", 100, 100, [frame("b", 90, 90, [frame("c", 80, 80, [rect("r", 10, 10)])])]));
    expect(craftMetrics(shallow).depth).toBe(2);
    expect(craftMetrics(deep).depth).toBe(4);
  });

  it("returns zeroes for an empty document rather than dividing by zero", () => {
    const m = craftMetrics(makeDoc());
    expect(m.nodes).toBe(0);
    expect(m.tokenCoverage).toBe(0);
    expect(m.reuseRatio).toBe(0);
    expect(m.typeRange).toBe(0);
    expect(Number.isFinite(m.typeRange)).toBe(true);
  });
});

describe("eval reporting", () => {
  it("takes the median, not the mean, so one outlier cannot carry the result", () => {
    expect(stat([1, 1, 1, 1, 96]).median).toBe(1);
    expect(stat([1, 1, 1, 1, 96]).max).toBe(96);
    expect(stat([2, 4]).median).toBe(3);
    expect(stat([]).median).toBe(0);
  });

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

  it("names the rule behind a regression instead of only the total", () => {
    const out = summarize([row({ blockers: 2, byRule: { text_clipped: 2 } })]);
    expect(out).toContain("text_clipped");
    expect(out).toContain("Blockers by rule");
  });

  it("reports the screen range per brief, because variance is the finding", () => {
    const out = summarize([
      row({ metrics: { ...craftMetrics(makeDoc()), screens: 1 } }),
      row({ attempt: 2, metrics: { ...craftMetrics(makeDoc()), screens: 4 } })
    ]);
    expect(out).toContain("screens 1-4");
  });

  function file(rows: RunRow[], over: Partial<RunFile> = {}): RunFile {
    return {
      provider: "openai",
      model: "test",
      briefHash: "abc",
      at: "t",
      rows,
      ...over
    };
  }

  it("calls fewer blockers better and fewer components worse", () => {
    const before = file([row({ blockers: 10, metrics: { ...craftMetrics(makeDoc()), components: 3 } })]);
    const after = file([row({ blockers: 2, metrics: { ...craftMetrics(makeDoc()), components: 0 } })]);
    const out = compare(after, before);
    expect(out).toMatch(/blockers.*-8.*better/);
    expect(out).toMatch(/components.*-3.*worse/);
  });

  it("gives no verdict on a metric with no better direction", () => {
    const before = file([row({ metrics: { ...craftMetrics(makeDoc()), screens: 1 } })]);
    const after = file([row({ metrics: { ...craftMetrics(makeDoc()), screens: 4 } })]);
    const line = compare(after, before).split("\n").find((l) => l.startsWith("screens"))!;
    expect(line).toContain("+3");
    expect(line).not.toContain("better");
    expect(line).not.toContain("worse");
  });

  it("says which run did not finish", () => {
    const out = summarize([row({ ok: false, error: "turn budget spent" })]);
    expect(out).toContain("did not finish");
    expect(out).toContain("turn budget spent");
  });

  it("refuses comparison when attempt counts differ", () => {
    const before = file([row(), row({ attempt: 2 })]);
    const after = file([row()]);
    expect(compare(after, before)).toMatch(/row keys differ/);
  });

  it("refuses comparison when a brief+attempt key is duplicated", () => {
    const before = file([row({ brief: "horses" }), row({ brief: "horses" })]);
    const after = file([row({ brief: "horses" }), row({ brief: "horses" })]);
    expect(compare(after, before)).toMatch(/duplicate row key/);
  });

  it("refuses comparison when a brief is missing", () => {
    const before = file([row({ brief: "horses" }), row({ brief: "cafe" })]);
    const after = file([row({ brief: "horses" }), row({ brief: "cafe", attempt: 2 })]);
    expect(compare(after, before)).toMatch(/row keys differ/);
  });

  it("refuses comparison when the brief set hash changes", () => {
    const rows = [row()];
    const before = file(rows, { briefHash: briefSetHash([{ id: "horses", text: "old" }]) });
    const after = file(rows, { briefHash: briefSetHash([{ id: "horses", text: "new" }]) });
    expect(compare(after, before)).toMatch(/brief set changed/);
  });

  it("refuses comparison when provider or model differ", () => {
    const rows = [row()];
    expect(compare(file(rows, { provider: "openai" }), file(rows, { provider: "qwen" }))).toMatch(/provider/);
    expect(compare(file(rows, { model: "a" }), file(rows, { model: "b" }))).toMatch(/model/);
  });

  it("refuses comparison when provider or brief hash is missing", () => {
    const rows = [row()];
    expect(compare(file(rows, { provider: "" }), file(rows))).toMatch(/missing provider/);
    expect(compare(file(rows, { briefHash: "" }), file(rows))).toMatch(/missing brief/);
  });

  it("reports failed pairs separately and excludes them from quality medians", () => {
    const before = file([
      row({ blockers: 10 }),
      row({ attempt: 2, ok: false, error: "budget", blockers: 99 })
    ]);
    const after = file([
      row({ blockers: 2 }),
      row({ attempt: 2, ok: false, error: "budget", blockers: 0 })
    ]);
    const out = compare(after, before);
    expect(out).toContain("failed");
    expect(out).toContain("horses #2");
    expect(out).toMatch(/blockers.*-8.*better/);
    expect(out).not.toContain("99");
  });

  it("accepts a valid same-cohort comparison", () => {
    const before = file([row({ blockers: 4 }), row({ attempt: 2, blockers: 6 })]);
    const after = file([row({ blockers: 1 }), row({ attempt: 2, blockers: 3 })]);
    const out = compare(after, before);
    expect(out).toContain("Comparing 2 completed pairs");
    expect(out).toMatch(/blockers.*-3.*better/);
  });
});

describe("brief set", () => {
  it("has unique ids and covers both surfaces", () => {
    expect(new Set(BRIEFS.map((b) => b.id)).size).toBe(BRIEFS.length);
    expect(BRIEFS.some((b) => b.surface === "mobile")).toBe(true);
    expect(BRIEFS.some((b) => b.surface === "desktop")).toBe(true);
  });

  it("keeps every brief short and free of layout instructions", () => {
    for (const b of BRIEFS) {
      expect(b.text.length).toBeLessThan(90);
      expect(b.text).not.toMatch(/status bar|tab bar|padding|column|px\b|header|sidebar/i);
    }
  });
});

/* The bugs the first eval batch found. Each of these reported success while
 * producing nothing, which is the only failure mode that cannot be noticed by
 * looking at the numbers afterwards. */

import { runSession } from "../src/agent/session";
import { childrenOf, isNode } from "../src/model/tree";
import type { Provider, FetchFn } from "../src/agent/provider";
import type { Document } from "../src/model/types";

function sse(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
      c.close();
    }
  });
}

const testProvider: Provider = {
  id: "openai",
  baseUrl: "https://example.test/v1",
  model: "test",
  apiKey: "k"
};

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentSse(text: string): Response {
  return new Response(sse([sseEvent({ choices: [{ delta: { content: text } }] }), "data: [DONE]\n\n"]), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

function toolSse(name: string, args: unknown, id = "c1"): Response {
  return new Response(
    sse([
      sseEvent({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id,
              function: { name, arguments: JSON.stringify(args) }
            }]
          }
        }]
      }),
      "data: [DONE]\n\n"
    ]),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

/** One round carrying several tool calls, which toolSse cannot express. */
function roundSse(calls: Array<[string, unknown]>, seed = 0): Response {
  return new Response(
    sse([
      sseEvent({
        choices: [{
          delta: {
            tool_calls: calls.map(([name, args], index) => ({
              index,
              id: `c${seed}_${index}`,
              function: { name, arguments: JSON.stringify(args) }
            }))
          }
        }]
      }),
      "data: [DONE]\n\n"
    ]),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
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

describe("failures that used to read as success", () => {
  it("does not report done after the provider fails", async () => {
    const failing: FetchFn = async () => new Response("upstream is down", { status: 502 });
    const events: string[] = [];
    for await (const ev of runSession(testProvider, [{ role: "user", content: "build it" }],
      { version: "1.0", children: [] } as Document, { fetch: failing })) {
      events.push(ev.type);
    }
    expect(events).toContain("error");
    expect(events).not.toContain("done");
  });

  it("tags a provider failure with code provider", async () => {
    const failing: FetchFn = async () => new Response("upstream is down", { status: 502 });
    const events = [];
    for await (const ev of runSession(testProvider, [{ role: "user", content: "build it" }],
      { version: "1.0", children: [] } as Document, { fetch: failing })) {
      events.push(ev);
    }
    const err = events.find((e) => e.type === "error");
    expect(err).toEqual(expect.objectContaining({ type: "error", code: "provider" }));
    expect(events.filter((e) => e.type === "done")).toHaveLength(0);
  });

  it("emits one done on a clean completion", async () => {
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "hi" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      { fetch: async () => contentSse("All done") }
    ));
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });

  it("stops after tool rounds try to change the canvas and change nothing", async () => {
    // The real stall: edits that are rejected every round. This case used to
    // be indistinguishable from reading, because both leave the document
    // untouched — see the read-only test below for the half that was wrong.
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "edit the canvas" }],
      makeDoc(frame("f", 100, 100)),
      {
        maxTurns: 10,
        fetch: async () => {
          calls += 1;
          return toolSse("set_property", { id: "ghost", property: "x", value: calls }, `c${calls}`);
        }
      }
    ));
    const errors = events.filter((e) => e.type === "error") as Array<{ code?: string; message?: string }>;
    expect(calls).toBe(4);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("budget");
    expect(errors[0].message).toContain("no canvas progress");
    expect(events.filter((e) => e.type === "done")).toHaveLength(0);
  });

  it("puts an unfinished screen back to the model, not only a broken one", async () => {
    // Across twelve logged runs the audit reported missing_display five times,
    // empty_tail and cloned_content three each, and the correction pass — which
    // filtered for blockers — discarded every one. They shipped in the design
    // each time. A 32px screen and a list showing the same row three times are
    // not matters of taste; they are the screen not being built yet.
    const screen = {
      type: "frame", id: "s1", name: "Home", width: 390, height: 844, clip: true,
      layout: "vertical", metadata: { screenKind: "mobile" },
      children: [
        { type: "frame", id: "sb", name: "Status Bar", width: 390, height: 62, children: [] },
        { type: "text", id: "t1", name: "Title", content: "Today", fontSize: 24, width: 200, height: 30 },
        { type: "frame", id: "tabs", name: "Tab Bar", width: 390, height: 60, y: 784, children: [] }
      ]
    };
    let calls = 0;
    const posted: string[] = [];
    await collect(runSession(
      testProvider,
      [{ role: "user", content: "build a home screen" }],
      makeDoc(screen as any),
      {
        maxTurns: 6,
        fetch: async (_input, init) => {
          posted.push(String(init?.body));
          calls += 1;
          // Build once — an untouched canvas is never audited — then finish.
          return calls === 1
            ? toolSse("insert_node", {
                parentId: "s1",
                node: { type: "text", id: "t2", content: "Nothing due", fontSize: 15, width: 200, height: 20 }
              })
            : contentSse("Done.");
        }
      }
    ));
    // Round 2 said it was finished and was sent back to work.
    expect(calls).toBeGreaterThan(2);
    const sent = JSON.parse(posted.at(-1)!) as { messages: Array<{ content: unknown }> };
    const told = JSON.stringify(sent.messages);
    expect(told).toContain("missing_display");
    expect(told).toContain("Measured before you finish");
  });

  it("counts a round that puts a value back as a stall, not as progress", async () => {
    // Observed on "create mobile app tinder for cats": four screens were built
    // in fourteen rounds, and the last sixteen went on one hero frame — layout
    // "none" → "vertical" → "none", the same two children moved between the
    // same two parents. Every one of those rounds changed the document, which
    // is the only question the stall check used to ask, so the run sailed past
    // the stall budget and was killed by the round ceiling with the screen it
    // had been repairing collapsed to nothing.
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "fix the hero" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 20,
        fetch: async () => {
          calls += 1;
          const value = calls % 2 === 1 ? "none" : "vertical";
          return toolSse("set_property", { id: "f", property: "layout", value }, `c${calls}`);
        }
      }
    ));
    const errors = events.filter((e) => e.type === "error") as Array<{ code?: string; message?: string }>;
    // Two rounds to establish both values, then four that only restore one.
    expect(calls).toBe(6);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("budget");
    expect(errors[0].message).toContain("undoing its own edits");
  });

  it("names the values a slot has cycled through, because the model cannot see the loop from inside it", async () => {
    const posted: string[] = [];
    let calls = 0;
    await collect(runSession(
      testProvider,
      [{ role: "user", content: "fix the hero" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 20,
        fetch: async (_input, init) => {
          posted.push(String(init?.body));
          calls += 1;
          const value = calls % 2 === 1 ? "none" : "vertical";
          return toolSse("set_property", { id: "f", property: "layout", value }, `c${calls}`);
        }
      }
    ));
    const sent = JSON.parse(posted.at(-1)!) as { messages: Array<{ role: string; content: unknown }> };
    const note = JSON.stringify(sent.messages.filter((m) => m.role === "user"));
    expect(note).toContain("back to values they already held");
    expect(note).toContain("f.layout");
    expect(note).toContain('\\"none\\" → \\"vertical\\" → \\"none\\"');
  });

  it("does not call a round a stall when it built something as well as adjusting", async () => {
    // A round that inserts a node and also resets one property is designing.
    // Reading any repeated write as thrash would punish the ordinary move of
    // putting a container back the way it was and then filling it.
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build it" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 12,
        fetch: async () => {
          calls += 1;
          if (calls > 8) return contentSse("built it");
          return roundSse([
            ["set_property", { id: "f", property: "layout", value: calls % 2 === 1 ? "none" : "vertical" }],
            ["insert_node", { parentId: "f", node: { type: "rectangle", id: `n${calls}`, width: 10, height: 10 } }]
          ], calls);
        }
      }
    ));
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("warns before the ceiling instead of cutting the run off mid-change", async () => {
    // The ceiling used to fall one call into a three-call rearrangement and
    // keep the half of it that had landed, leaving the screen worse than
    // before the model started on it.
    const posted: string[] = [];
    let calls = 0;
    await collect(runSession(
      testProvider,
      [{ role: "user", content: "build it" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 5,
        fetch: async (_input, init) => {
          posted.push(String(init?.body));
          calls += 1;
          return toolSse(
            "insert_node",
            { parentId: "f", node: { type: "rectangle", id: `n${calls}`, width: 10, height: 10 } },
            `c${calls}`
          );
        }
      }
    ));
    // Said once. It stays in the transcript from then on, so count the message
    // rather than the requests that carry it — a warning re-pushed every round
    // would be noise the model learns to skip.
    const sent = JSON.parse(posted.at(-1)!) as { messages: Array<{ content: unknown }> };
    const warnings = sent.messages.filter((m) =>
      JSON.stringify(m.content).includes("Land what is on the canvas")
    );
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings[0].content)).toContain("3 rounds left");
    // Two rounds of work happened before it, out of five.
    expect(posted.filter((body) => body.includes("Land what is on the canvas"))).toHaveLength(3);
  });

  it("keeps its own prompting out of the transcript it hands back", async () => {
    // These are written by the loop and addressed to the model. A saved session
    // that replayed them showed the user telling themselves to stop looking
    // things up — and the research nudge was never filtered at all, because the
    // filter matched the opening words of a list that had drifted.
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build it" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 12,
        fetch: async () => {
          calls += 1;
          return calls <= 7
            ? toolSse("search_icons", { query: `q${calls}` }, `c${calls}`)
            : contentSse("built it");
        }
      }
    ));
    const done = events.find((e) => e.type === "done") as { messages?: Array<{ content: unknown }> } | undefined;
    const text = JSON.stringify(done?.messages ?? []);
    expect(text).not.toContain("enough looking things up");
  });

  it("does not count reading as stalling", async () => {
    // Observed on "build a mobile app tinder for cats": set_style, then four
    // search_icons rounds, then the run was killed with nothing on the canvas.
    // Looking an icon up is work. Every read-only round left the document
    // untouched, which the stall check read as no progress.
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build it" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 12,
        fetch: async () => {
          calls += 1;
          if (calls <= 5) return toolSse("search_icons", { query: `q${calls}` }, `c${calls}`);
          if (calls === 6) return toolSse("set_property", { id: "r", property: "x", value: 8 }, "c6");
          return contentSse("built it");
        }
      }
    ));
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("sends the model back to work when it only reads, instead of killing the run", async () => {
    // Research still has to end, but ending it by aborting throws away every
    // answer the model just went and got.
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build it" }],
      makeDoc(frame("f", 100, 100)),
      {
        maxTurns: 9,
        fetch: async () => {
          calls += 1;
          return toolSse("search_icons", { query: `q${calls}` }, `c${calls}`);
        }
      }
    ));
    const errors = events.filter((e) => e.type === "error") as Array<{ code?: string; message?: string }>;
    expect(calls).toBe(9);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("round budget is spent");
    expect(errors[0].message).not.toContain("no canvas progress");
  });

  it("allows a short read-measure-search discovery sequence", async () => {
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "edit the canvas" }],
      makeDoc(frame("f", 100, 100)),
      {
        fetch: scriptedFetch([
          () => toolSse("read_digest", {}),
          () => toolSse("measure", { id: "f" }),
          () => toolSse("search_icons", { query: "heart" }),
          () => contentSse("done")
        ])
      }
    ));

    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    expect(events.filter((event) => event.type === "error")).toHaveLength(0);
  });

  it("allows a productive design to continue beyond the old ten-round limit", async () => {
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "edit the canvas" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        fetch: async () => {
          calls += 1;
          return calls <= 10
            ? toolSse("set_property", { id: "r", property: "x", value: calls }, `c${calls}`)
            : contentSse("done");
        }
      }
    ));
    expect(calls).toBe(11);
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(events.filter((e) => e.type === "error")).toHaveLength(0);
  });

  it("keeps an emergency ceiling for a model that makes endless changes", async () => {
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "edit the canvas" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      {
        maxTurns: 3,
        fetch: async () => {
          calls += 1;
          return toolSse("set_property", { id: "r", property: "x", value: calls }, `c${calls}`);
        }
      }
    ));
    const error = events.find((e) => e.type === "error") as { code?: string; message?: string };
    expect(calls).toBe(3);
    expect(error.code).toBe("budget");
    expect(error.message).toContain("round budget is spent");
  });

  it("emits aborted, never done, when the run is cancelled", async () => {
    const ac = new AbortController();
    let calls = 0;
    const fetchImpl: FetchFn = async (_input, init) => {
      calls += 1;
      if (calls === 1) return toolSse("read_digest", {});
      ac.abort();
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      throw new DOMException("aborted", "AbortError");
    };
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "edit the canvas" }],
      makeDoc(frame("f", 100, 100, [rect("r", 10, 10)])),
      { fetch: fetchImpl, signal: ac.signal }
    ));
    const errors = events.filter((e) => e.type === "error") as Array<{ code?: string }>;
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("aborted");
    expect(events.filter((e) => e.type === "done")).toHaveLength(0);
  });
});

describe("tool events carry a document only when the document changed", () => {
  it("omits doc from read_digest", async () => {
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "summarise" }],
      makeDoc(frame("f", 100, 100, [rect("r", 40, 40)])),
      { fetch: scriptedFetch([() => toolSse("read_digest", {}), () => contentSse("ok")]) }
    ));
    const tool = events.find((e) => e.type === "tool") as { doc?: Document };
    expect(tool).toBeDefined();
    expect(tool.doc).toBeUndefined();
  });

  it("includes doc from create_screen", async () => {
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build" }],
      { version: "1.0", children: [] } as Document,
      { fetch: scriptedFetch([() => toolSse("create_screen", { name: "Home", kind: "mobile" }), () => contentSse("ok")]) }
    ));
    const tool = events.find((e) => e.type === "tool") as { name?: string; doc?: Document };
    expect(tool?.name).toBe("create_screen");
    expect(tool?.doc).toBeDefined();
    expect(tool?.doc?.children.length).toBeGreaterThan(0);
  });

  it("includes doc from place_instances", async () => {
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "place" }],
      makeDoc(
        frame("row", 100, 40, [], { reusable: true }),
        frame("list", 100, 200)
      ),
      {
        fetch: scriptedFetch([
          () => toolSse("place_instances", { componentId: "row", parentId: "list", items: [{}] }),
          () => contentSse("ok")
        ])
      }
    ));
    const tool = events.find((e) => e.type === "tool") as { name?: string; doc?: Document };
    expect(tool?.name).toBe("place_instances");
    expect(tool?.doc).toBeDefined();
  });

  it("omits doc from a failed mutation", async () => {
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "edit" }],
      makeDoc(frame("f", 100, 100)),
      {
        fetch: scriptedFetch([
          () => toolSse("set_property", { id: "missing", property: "width", value: 40 }),
          () => contentSse("ok")
        ])
      }
    ));
    const tool = events.find((e) => e.type === "tool") as { doc?: Document; result?: string };
    expect(tool?.result).toMatch(/^error:/);
    expect(tool?.doc).toBeUndefined();
  });
});

describe("failures that used to read as success — remaining", () => {
  it("sends the model back when it claims an empty design is finished", async () => {
    let calls = 0;
    const events = await collect(runSession(
      testProvider,
      [{ role: "user", content: "build it" }],
      makeDoc(),
      {
        maxTurns: 3,
        fetch: async () => {
          calls += 1;
          return calls === 1
            ? contentSse("All done!")
            : toolSse("create_screen", { name: "Home", kind: "mobile" });
        }
      }
    ));

    expect(calls).toBeGreaterThan(1);
    expect(events.some((event) => event.type === "tool")).toBe(true);
  });

  it("walks a children array holding something that is not a node", () => {
    const broken = { type: "frame", id: "f", children: [null, "oops", { type: "text", id: "t" }] } as any;
    expect(() => childrenOf(broken)).not.toThrow();
    expect(childrenOf(broken).length).toBe(1);
    expect(isNode(null)).toBe(false);
  });

  it("hands back the live children array so an edit to it lands", () => {
    const node = { type: "frame", id: "f", children: [{ type: "text", id: "t" }] } as any;
    expect(childrenOf(node)).toBe(node.children);
  });
});

describe("The trace records the run rather than repeating it", () => {
  async function traced(responses: Array<() => Response>) {
    const events: Record<string, unknown>[] = [];
    const gen = runSession(
      testProvider,
      [{ role: "user", content: "build a cat app" }],
      { version: "1.0", children: [] } as Document,
      { fetch: scriptedFetch(responses), trace: (e) => events.push(e) }
    );
    for await (const _ of gen) { /* drain */ }
    return events;
  }

  it("logs only the messages added since the previous turn", async () => {
    // model_request used to carry the whole array every turn, so one three-run
    // log came to 7.1MB with 6.7MB of it — 92.6% — being the same text written
    // again. The full array is still reconstructible by concatenation.
    const events = await traced([
      () => toolSse("insert_node", { node: { type: "frame", id: "f1", name: "Card", width: 200, height: 100, children: [] } }),
      () => contentSse("done")
    ]);
    const requests = events.filter((e) => e.type === "model_request");
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every((r) => !("messages" in r))).toBe(true);
    // The first turn appends nothing new: the prompt event already carried it.
    expect((requests[0].appended as unknown[]).length).toBe(0);
    expect(requests[1].totalMessages).toBeGreaterThan(requests[0].totalMessages as number);
    const later = requests[1].appended as unknown[];
    expect(later.length).toBeLessThan(requests[1].totalMessages as number);
  });

  it("ends with what the run produced, not just a timestamp", async () => {
    // session_done and session_end carried an ISO string and an elapsed count
    // and nothing else, so the most useful moment in a trace — what was on the
    // canvas when the model stopped — could not be read back at all.
    const events = await traced([
      () => toolSse("insert_node", { node: { type: "frame", id: "f1", name: "Card", width: 200, height: 100, children: [] } }),
      () => contentSse("done")
    ]);
    const outcome = events.find((e) => e.type === "outcome");
    expect(outcome).toBeDefined();
    expect(outcome!.reason).toBe("model finished");
    expect(outcome!.nodes).toBe(1);
    expect(outcome!.toolCalls).toEqual({ insert_node: 1 });
    expect(typeof outcome!.blockers).toBe("number");
    expect(Array.isArray(outcome!.rules)).toBe(true);
  });

  it("records an outcome when the run is cut off, not only when it succeeds", async () => {
    // A run that stalls is exactly the one worth reading back.
    const events = await traced([() => toolSse("set_property", { id: "nope", property: "width", value: 10 })]);
    const outcome = events.find((e) => e.type === "outcome");
    expect(outcome).toBeDefined();
    expect(outcome!.reason).toBe("stalled");
  });
});
