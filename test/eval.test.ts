import { describe, it, expect } from "bun:test";
import { craftMetrics } from "../eval/metrics";
import { stat, summarize, compare } from "../eval/report";
import type { RunRow } from "../eval/run";
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

  it("calls fewer blockers better and fewer components worse", () => {
    const before = [row({ blockers: 10, metrics: { ...craftMetrics(makeDoc()), components: 3 } })];
    const after = [row({ blockers: 2, metrics: { ...craftMetrics(makeDoc()), components: 0 } })];
    const out = compare(after, before);
    expect(out).toMatch(/blockers.*-8.*better/);
    expect(out).toMatch(/components.*-3.*worse/);
  });

  it("gives no verdict on a metric with no better direction", () => {
    const before = [row({ metrics: { ...craftMetrics(makeDoc()), screens: 1 } })];
    const after = [row({ metrics: { ...craftMetrics(makeDoc()), screens: 4 } })];
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

  it("sends the model back when it stops with an empty canvas", async () => {
    let calls = 0;
    const silent: FetchFn = async () => {
      calls += 1;
      return new Response(sse(['data: {"choices":[{"delta":{"content":"All done!"}}]}\n\n', "data: [DONE]\n\n"]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      });
    };
    for await (const _ of runSession(testProvider, [{ role: "user", content: "build it" }],
      { version: "1.0", children: [] } as Document, { fetch: silent, maxTurns: 6 })) {
      // drain
    }
    // One call would mean the empty canvas was accepted as finished.
    expect(calls).toBeGreaterThan(1);
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
