import { describe, it, expect } from "bun:test";
import { normalisePadding } from "../src/layout/padding";
import { computeMainAxisPositions, computeCrossAxisPosition } from "../src/layout/arrange";
import { layoutDocument } from "../src/layout/layout";
import { measureTextNode, dynamicRatioCache } from "../src/layout/text";
import { makeDoc, frame, rect, txt, assertBoxes, flattenBoxes } from "./harness";
import { auditDesign } from "../src/design/evaluator";

dynamicRatioCache.set("Inter", 1.2113);
dynamicRatioCache.set("Geist Mono", 1.3); // measured in Chrome, see probes/text-metrics.json

describe("Layout Subsystem (Unit B)", () => {
  it("normalises padding formats (single, pair, 4-tuple, undefined)", () => {
    expect(normalisePadding(20)).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });
    expect(normalisePadding([10, 40])).toEqual({ top: 10, right: 40, bottom: 10, left: 40 });
    expect(normalisePadding([5, 10, 15, 20])).toEqual({ top: 5, right: 10, bottom: 15, left: 20 });
    expect(normalisePadding(undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("computes main-axis and cross-axis alignment positions", () => {
    const opts = { frameMain: 300, padStart: 20, padEnd: 20, gap: 10, childMainSizes: [60, 60] };
    expect(computeMainAxisPositions({ ...opts, justifyContent: "start" })).toEqual([20, 90]);
    expect(computeMainAxisPositions({ ...opts, justifyContent: "center" })).toEqual([85, 155]);
    expect(computeMainAxisPositions({ ...opts, justifyContent: "end" })).toEqual([150, 220]);
    expect(computeMainAxisPositions({ ...opts, childMainSizes: [60, 60, 60], justifyContent: "space_between" })).toEqual([20, 120, 220]);
    expect(computeMainAxisPositions({ ...opts, justifyContent: "space_around" })).toEqual([55, 185]);

    expect(computeCrossAxisPosition({ frameCross: 100, padStartCross: 10, padEndCross: 10, childCrossSize: 40, alignItems: "center" })).toBe(30);
    expect(computeCrossAxisPosition({ frameCross: 100, padStartCross: 10, padEndCross: 10, childCrossSize: 40, alignItems: "end" })).toBe(50);

  });

  it("resolves two-stage sizing (fit_content, fill_container, circular dependency)", () => {
    // 1. fit_content shrinks to content + padding
    const fitDoc = makeDoc(frame("f", "fit_content", "fit_content", [rect("c1", 80, 40), rect("c2", 60, 30)], { padding: 15, gap: 10, layout: "horizontal" }));
    assertBoxes(layoutDocument(fitDoc), { f: [0, 0, 180, 70], c1: [15, 15, 80, 40], c2: [105, 15, 60, 30] });

    // 2. fill_container fills remaining available space
    const fillDoc = makeDoc(frame("f", 300, 100, [rect("c1", 100, 50), rect("c2", "fill_container" as any, 50)], { padding: 10, gap: 10, layout: "horizontal" }));
    assertBoxes(layoutDocument(fillDoc), { f: [0, 0, 300, 100], c1: [10, 10, 100, 50], c2: [120, 10, 170, 50] });

    // 3. Circular dependency: parent fit_content containing fill_container child resolves safely (frame w=0, child w=1)
    const circDoc = makeDoc(frame("f", "fit_content", 100, [rect("c1", "fill_container" as any, 50)], { padding: 0, gap: 0, layout: "horizontal" }));
    assertBoxes(layoutDocument(circDoc), { f: [0, 0, 0, 100], c1: [0, 0, 1, 50] });
  });

  it("measures text growth modes accurately", () => {
    const autoNode = txt("t1", "Single line text", 16, { textGrowth: "auto" } as any);
    const mAuto = measureTextNode(autoNode, 50);
    expect(mAuto.width).toBeGreaterThan(100);

    const fixedNode = txt("t2", "A very long line of text that wraps into multiple lines", 16, { textGrowth: "fixed-width", width: 100 } as any);
    const mFixed = measureTextNode(fixedNode, 100);
    expect(mFixed.width).toBe(100);
    expect(mFixed.lines.length).toBeGreaterThan(1);
  });

  it("positions absolute children, groups, and rotated nodes", () => {
    const doc = makeDoc(frame("f", 200, 200, [
      rect("free", 50, 50, { x: 30, y: 40 } as any),
      rect("abs", 40, 40, { layoutPosition: "absolute", x: 80, y: 90 } as any)
    ], { layout: "none" }));

    assertBoxes(layoutDocument(doc), {
      f: [0, 0, 200, 200],
      free: [30, 40, 50, 50],
      abs: [80, 90, 40, 40]
    });
  });

  it("lays out vertical wrapping text without sibling overlap", () => {
    const longText = "This is a very long text paragraph designed to wrap onto multiple lines in a container.";
    // 1. fill_container width vertical wrapping
    const fillDoc = makeDoc(frame("col", 100, 200, [
      rect("top", "fill_container" as any, 20),
      txt("mid", longText, 14, { textGrowth: "fixed-width", width: "fill_container" as any }),
      rect("bot", "fill_container" as any, 20)
    ], { layout: "vertical", gap: 10 }));

    const fillTree = layoutDocument(fillDoc);
    const midBox = fillTree[0].children[1].box;
    const botBox = fillTree[0].children[2].box;

    expect(midBox.height).toBeGreaterThan(20);
    expect(midBox.y + midBox.height).toBeLessThanOrEqual(botBox.y);
    expect(botBox.y).toBe(midBox.y + midBox.height + 10);



    // 2. Numeric-width vertical wrapping
    const numDoc = makeDoc(frame("col2", 200, 300, [
      rect("top2", 100, 20),
      txt("mid2", longText, 14, { textGrowth: "fixed-width", width: 100 }),
      rect("bot2", 100, 20)
    ], { layout: "vertical", gap: 10 }));

    const numTree = layoutDocument(numDoc);
    const midBox2 = numTree[0].children[1].box;
    const botBox2 = numTree[0].children[2].box;
    expect(midBox2.y + midBox2.height).toBeLessThanOrEqual(botBox2.y);
  });
});


/* Widths resolve downward, heights upward. Without the first half a text node
 * set to fill its container had no width to wrap against during measure, so it
 * reported one line, its parent sized to one line, and the arrange pass then
 * wrapped it to three — two of them outside the box. */
describe("available width reaches text during measure", () => {
  const prose =
    "A long paragraph that has to wrap onto several lines before it fits inside a narrow column.";

  function doc(frameHeight?: number | string) {
    return makeDoc(
      frame("screen", 320, 600, [
        frame("card", "fill_container", frameHeight as any, [
          txt("body", prose, 14, { width: "fill_container", textGrowth: "fixed-width" })
        ], { layout: "vertical", padding: 10, clip: true })
      ], { layout: "vertical", padding: 20 })
    );
  }

  it("sizes a fit_content parent to the wrapped height, not one line", () => {
    const boxes = flattenBoxes(layoutDocument(doc()));
    const text = boxes.get("body")!;
    const card = boxes.get("card")!;
    expect(text.height).toBeGreaterThan(20); // more than a single line
    expect(card.height).toBeGreaterThanOrEqual(text.height + 20); // plus its padding
  });

  it("leaves the text inside its parent, which is what the auditor checks", () => {
    const d = doc();
    const clipped = auditDesign(layoutDocument(d), d).filter((f) => f.rule === "clipped");
    expect(clipped).toEqual([]);
  });

  it("still reports a clip when the parent height really is too small", () => {
    // The rule has to stay able to fail. A 24px box cannot hold three lines.
    const d = doc(24);
    const clipped = auditDesign(layoutDocument(d), d).filter((f) => f.rule === "clipped");
    expect(clipped.length).toBeGreaterThan(0);
  });

  it("does not wrap text in a horizontal row, where the split is not known yet", () => {
    const d = makeDoc(
      frame("row", 320, 60, [
        txt("a", "left", 14),
        txt("b", "right", 14)
      ], { layout: "horizontal", gap: 8 })
    );
    const boxes = flattenBoxes(layoutDocument(d));
    expect(boxes.get("a")!.height).toBeLessThan(30);
  });
});
