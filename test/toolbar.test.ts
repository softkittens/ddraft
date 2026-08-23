import { describe, it, expect } from "bun:test";
import { makeDoc, frame, rect, txt } from "./harness";
import { layoutDocument } from "../src/layout/layout";
import { placeToolbar, unionWorldBox } from "../src/ui/canvas/toolbarAnchor";
import { sharedValue, fillOf, fillKey } from "../src/ui/canvas/controls/values";
import { compactPadding, normalisePadding } from "../src/layout/padding";
import type { FrameNode, PenNode } from "../src/model/types";

const viewport = { width: 1440, height: 900 };
const base = {
  toolbarWidth: 200,
  toolbarHeight: 36,
  viewport,
  topInset: 60,
  leftInset: 0,
  margin: 12,
  gap: 10
};

describe("Where the toolbar sits", () => {
  it("centres above the selection", () => {
    const at = placeToolbar({ ...base, box: { x: 500, y: 400, width: 200, height: 100 } });
    expect(at.placement).toBe("above");
    expect(at.left).toBe(600); // centre of the box
    expect(at.top).toBe(400 - 10 - 36);
  });

  it("flips below when there is no room above it", () => {
    const at = placeToolbar({ ...base, box: { x: 500, y: 70, width: 200, height: 100 } });
    expect(at.placement).toBe("below");
    expect(at.top).toBe(70 + 100 + 10);
  });

  it("stays clear of the top chrome even when the selection starts above it", () => {
    const at = placeToolbar({ ...base, box: { x: 500, y: -400, width: 200, height: 100 } });
    expect(at.top).toBeGreaterThanOrEqual(60);
  });

  it("stops at the right edge rather than hanging off it", () => {
    const at = placeToolbar({ ...base, box: { x: 1380, y: 400, width: 200, height: 100 } });
    // Centre minus half the bar has to leave the margin intact.
    expect(at.left - base.toolbarWidth / 2).toBeGreaterThanOrEqual(12);
    expect(at.left + base.toolbarWidth / 2).toBeLessThanOrEqual(viewport.width - 12);
  });

  it("stops at the left edge too", () => {
    const at = placeToolbar({ ...base, box: { x: -300, y: 400, width: 100, height: 100 } });
    expect(at.left - base.toolbarWidth / 2).toBeGreaterThanOrEqual(12);
  });

  it("keeps clear of the chat panel, which would swallow a click", () => {
    const at = placeToolbar({
      ...base,
      leftInset: 410,
      box: { x: 0, y: 400, width: 200, height: 100 }
    });
    expect(at.left - base.toolbarWidth / 2).toBeGreaterThanOrEqual(410 + 12);
  });

  it("stays reachable when the window is narrower than the bar", () => {
    const at = placeToolbar({
      ...base,
      viewport: { width: 180, height: 900 },
      box: { x: 20, y: 400, width: 100, height: 100 }
    });
    // Off the right is recoverable by scrolling the canvas; off the left is not.
    expect(at.left - base.toolbarWidth / 2).toBeGreaterThanOrEqual(12);
  });

  it("does not fall off the bottom when the selection is at the foot of the page", () => {
    const at = placeToolbar({ ...base, box: { x: 500, y: 40, width: 200, height: 1000 } });
    expect(at.top + base.toolbarHeight).toBeLessThanOrEqual(viewport.height - 12);
  });

  it("has no width to clamp against before the first paint", () => {
    const at = placeToolbar({ ...base, toolbarWidth: 0, box: { x: 500, y: 400, width: 200, height: 100 } });
    expect(at.left).toBe(600);
  });
});

describe("The box the toolbar anchors to", () => {
  const doc = makeDoc(
    // layout: "none" so the children keep the x/y the test gives them; a
    // flowing frame would place them itself and the union would prove nothing.
    frame("screen", 390, 844, [rect("a", 40, 40, { x: 10, y: 20 }), rect("b", 60, 30, { x: 100, y: 200 })], {
      x: 0,
      y: 0,
      layout: "none"
    } as Partial<FrameNode>)
  );
  const tree = () => layoutDocument(doc);

  it("is the node's own box for a single selection", () => {
    expect(unionWorldBox(tree(), ["a"])).toEqual({ x: 10, y: 20, width: 40, height: 40 });
  });

  it("spans every selected node", () => {
    // a covers 10..50 x 20..60, b covers 100..160 x 200..230.
    expect(unionWorldBox(tree(), ["a", "b"])).toEqual({ x: 10, y: 20, width: 150, height: 210 });
  });

  it("ignores ids the layout does not have", () => {
    expect(unionWorldBox(tree(), ["a", "ghost"])).toEqual({ x: 10, y: 20, width: 40, height: 40 });
  });

  it("is nothing when nothing is selected", () => {
    expect(unionWorldBox(tree(), [])).toBeNull();
    expect(unionWorldBox(tree(), ["ghost"])).toBeNull();
  });
});

describe("Reading one value out of a selection", () => {
  const size = (node: PenNode) => (node as any).fontSize as number | undefined;

  it("reports the value when they agree", () => {
    const out = sharedValue([txt("a", "x", 14), txt("b", "y", 14)], size, String);
    expect(out).toEqual({ value: 14, mixed: false });
  });

  it("reports mixed when they disagree, and no value to overwrite them with", () => {
    const out = sharedValue([txt("a", "x", 14), txt("b", "y", 20)], size, String);
    expect(out).toEqual({ value: undefined, mixed: true });
  });

  it("ignores the nodes that have no opinion", () => {
    const out = sharedValue([txt("a", "x", 14), rect("box")], size, String);
    expect(out).toEqual({ value: 14, mixed: false });
  });

  it("reports nothing when nobody has an opinion", () => {
    expect(sharedValue([rect("box")], size, String)).toEqual({ value: undefined, mixed: false });
  });
});

describe("Reading what a node is painted with", () => {
  it("reads a plain colour and a token alike", () => {
    expect(fillOf(rect("a", 10, 10, { fill: "#FF0000" }))).toEqual({ kind: "solid", value: "#FF0000" });
    expect(fillOf(rect("b", 10, 10, { fill: "$accent-primary" }))).toEqual({
      kind: "solid",
      value: "$accent-primary"
    });
  });

  it("reads the object form", () => {
    expect(fillOf(rect("a", 10, 10, { fill: { type: "color", color: "#00FF00" } }))).toEqual({
      kind: "solid",
      value: "#00FF00"
    });
  });

  it("calls a gradient other, because there is no one colour to show", () => {
    const node = rect("a", 10, 10, { fill: { type: "gradient", stops: [] } });
    expect(fillOf(node).kind).toBe("other");
  });

  it("calls a stack of fills other rather than picking one of them", () => {
    const node = rect("a", 10, 10, { fill: ["#FF0000", "#00FF00"] });
    expect(fillOf(node).kind).toBe("other");
    expect(fillOf(rect("b", 10, 10, { fill: ["#FF0000"] }))).toEqual({ kind: "solid", value: "#FF0000" });
  });

  it("reads a disabled fill as none", () => {
    const node = rect("a", 10, 10, { fill: { type: "color", color: "#FF0000", enabled: false } });
    expect(fillOf(node).kind).toBe("none");
  });

  it("reads an unpainted node as none", () => {
    expect(fillOf(rect("a", 10, 10)).kind).toBe("none");
  });

  it("compares case-insensitively, so #FFF and #fff are one colour", () => {
    expect(fillKey(fillOf(rect("a", 10, 10, { fill: "#FFFFFF" })))).toBe(
      fillKey(fillOf(rect("b", 10, 10, { fill: "#ffffff" })))
    );
  });

  it("tells a mixed selection from an agreeing one", () => {
    const agree = [rect("a", 10, 10, { fill: "#FFF" }), rect("b", 10, 10, { fill: "#fff" })];
    const differ = [rect("a", 10, 10, { fill: "#FFF" }), rect("b", 10, 10, { fill: "#000" })];
    expect(sharedValue(agree, fillOf, fillKey).mixed).toBe(false);
    expect(sharedValue(differ, fillOf, fillKey).mixed).toBe(true);
  });
});

describe("Writing padding back in the shortest form that means it", () => {
  it("writes one number when every edge agrees", () => {
    expect(compactPadding({ top: 16, right: 16, bottom: 16, left: 16 })).toBe(16);
  });

  it("writes the vertical/horizontal pair when the axes agree", () => {
    expect(compactPadding({ top: 24, right: 16, bottom: 24, left: 16 })).toEqual([24, 16]);
  });

  it("writes all four only when it has to", () => {
    expect(compactPadding({ top: 1, right: 2, bottom: 3, left: 4 })).toEqual([1, 2, 3, 4]);
  });

  it("round-trips through the layout engine's reader", () => {
    for (const sides of [
      { top: 8, right: 8, bottom: 8, left: 8 },
      { top: 24, right: 16, bottom: 24, left: 16 },
      { top: 1, right: 2, bottom: 3, left: 4 }
    ]) {
      expect(normalisePadding(compactPadding(sides))).toEqual(sides);
    }
  });
});
