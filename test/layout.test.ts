import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { Document } from "../src/model/types";
import { parseDocument } from "../src/model/parse";
import type { LayoutNode } from "../src/layout/types";
import { normalisePadding } from "../src/layout/padding";
import { computeMainAxisPositions, computeCrossAxisPosition } from "../src/layout/arrange";
import { layoutDocument } from "../src/layout/layout";
import { measureTextNode } from "../src/layout/text";


describe("Layout - Padding Normalisation (B1)", () => {
  it("normalises a single number to all 4 sides", () => {
    expect(normalisePadding(20)).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });
  });

  it("normalises [v, h] to [top/bottom, right/left]", () => {
    expect(normalisePadding([10, 40])).toEqual({ top: 10, right: 40, bottom: 10, left: 40 });
  });

  it("normalises [t, r, b, l] to each respective side", () => {
    expect(normalisePadding([5, 10, 15, 20])).toEqual({ top: 5, right: 10, bottom: 15, left: 20 });
  });

  it("normalises undefined or missing values to 0", () => {
    expect(normalisePadding(undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("Layout - Main Axis Positioning (B2)", () => {
  it("computes basicH (start alignment)", () => {
    const pos = computeMainAxisPositions({
      frameMain: 300,
      padStart: 20,
      padEnd: 20,
      gap: 10,
      justifyContent: "start",
      childMainSizes: [60, 60, 60]
    });
    expect(pos).toEqual([20, 90, 160]);
  });

  it("computes jEnd (end alignment)", () => {
    const pos = computeMainAxisPositions({
      frameMain: 300,
      padStart: 20,
      padEnd: 20,
      gap: 10,
      justifyContent: "end",
      childMainSizes: [60, 60]
    });
    expect(pos).toEqual([150, 220]);
  });

  it("computes jCenter (center alignment)", () => {
    const pos = computeMainAxisPositions({
      frameMain: 300,
      padStart: 20,
      padEnd: 20,
      gap: 10,
      justifyContent: "center",
      childMainSizes: [60, 60]
    });
    expect(pos).toEqual([85, 155]);
  });

  it("computes jBetween (space_between alignment)", () => {
    const pos = computeMainAxisPositions({
      frameMain: 300,
      padStart: 20,
      padEnd: 20,
      gap: 10,
      justifyContent: "space_between",
      childMainSizes: [60, 60, 60]
    });
    expect(pos).toEqual([20, 120, 220]);
  });

  it("computes jAround (space_around alignment)", () => {
    const pos = computeMainAxisPositions({
      frameMain: 300,
      padStart: 20,
      padEnd: 20,
      gap: 10,
      justifyContent: "space_around",
      childMainSizes: [60, 60]
    });
    expect(pos).toEqual([55, 185]);
  });

  it("computes vertBasic (vertical layout main axis Y)", () => {
    const pos = computeMainAxisPositions({
      frameMain: 117,
      padStart: 15,
      padEnd: 15,
      gap: 6,
      justifyContent: "start",
      childMainSizes: [25, 25, 25]
    });
    expect(pos).toEqual([15, 46, 77]);
  });
});

describe("Layout - Cross Axis Alignment (B3)", () => {
  it("aligns center (alignCenter probe)", () => {
    const y1 = computeCrossAxisPosition({ frameCross: 120, padStartCross: 20, padEndCross: 20, alignItems: "center", childCrossSize: 20 });
    const y2 = computeCrossAxisPosition({ frameCross: 120, padStartCross: 20, padEndCross: 20, alignItems: "center", childCrossSize: 60 });
    expect(y1).toBe(50);
    expect(y2).toBe(30);
  });

  it("aligns end (alignEnd probe)", () => {
    const y1 = computeCrossAxisPosition({ frameCross: 120, padStartCross: 20, padEndCross: 20, alignItems: "end", childCrossSize: 20 });
    const y2 = computeCrossAxisPosition({ frameCross: 120, padStartCross: 20, padEndCross: 20, alignItems: "end", childCrossSize: 60 });
    expect(y1).toBe(80);
    expect(y2).toBe(40);
  });

  it("throws an error for unsupported stretch or baseline", () => {
    expect(() =>
      computeCrossAxisPosition({ frameCross: 120, padStartCross: 20, padEndCross: 20, alignItems: "stretch" as any, childCrossSize: 20 })
    ).toThrow();
  });
});

describe("Layout - Intrinsic Sizing & Two Stages (B4)", () => {
  it("computes fitH (fit_content on both axes)", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "frame",
        id: "fitH",
        width: "fit_content",
        height: "fit_content",
        layout: "horizontal",
        padding: 20,
        gap: 10,
        children: [
          { type: "rectangle", id: "r1", width: 60, height: 40 },
          { type: "rectangle", id: "r2", width: 60, height: 40 },
          { type: "rectangle", id: "r3", width: 60, height: 40 }
        ]
      }]
    };
    const [tree] = layoutDocument(doc);
    expect(tree.box.width).toBe(240);
    expect(tree.box.height).toBe(80);
  });

  it("computes fillOne (one fixed + one fill_container)", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "frame",
        id: "fillOne",
        width: 300,
        height: 100,
        layout: "horizontal",
        padding: 20,
        gap: 10,
        children: [
          { type: "rectangle", id: "r1", width: 60, height: 40 },
          { type: "rectangle", id: "r2", width: "fill_container", height: 40 }
        ]
      }]
    };
    const [tree] = layoutDocument(doc);
    expect(tree.children[0].box.width).toBe(60);
    expect(tree.children[1].box.width).toBe(190);
  });

  it("computes fillTwo (two fill_container children)", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "frame",
        id: "fillTwo",
        width: 300,
        height: 100,
        layout: "horizontal",
        padding: 20,
        gap: 10,
        children: [
          { type: "rectangle", id: "r1", width: "fill_container", height: 40 },
          { type: "rectangle", id: "r2", width: "fill_container", height: 40 }
        ]
      }]
    };
    const [tree] = layoutDocument(doc);
    expect(tree.children[0].box.width).toBe(125);
    expect(tree.children[1].box.width).toBe(125);
  });

  it("resolves circular dependency to frame w=0, child w=1", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "frame",
        id: "circular",
        width: "fit_content",
        height: 100,
        layout: "horizontal",
        padding: 20,
        gap: 10,
        children: [
          { type: "rectangle", id: "r1", width: "fill_container", height: 40 },
          { type: "rectangle", id: "r2", width: "fill_container", height: 40 }
        ]
      }]
    };
    const [tree] = layoutDocument(doc);
    expect(tree.box.width).toBe(0);
    expect(tree.children[0].box.width).toBe(1);
    expect(tree.children[0].box.x).toBe(20);
    expect(tree.children[1].box.width).toBe(1);
    expect(tree.children[1].box.x).toBe(31);
  });

  it("ignores fallback value in circular dependency", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "frame",
        id: "fallback",
        width: "fit_content",
        height: 100,
        layout: "horizontal",
        padding: 20,
        gap: 10,
        children: [
          { type: "rectangle", id: "r1", width: "fill_container(150)", height: 40 }
        ]
      }]
    };
    const [tree] = layoutDocument(doc);
    expect(tree.box.width).toBe(0);
    expect(tree.children[0].box.width).toBe(1);
  });

  it("computes nestFit (nested fit_content frames)", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "frame",
        id: "outer",
        width: "fit_content",
        height: "fit_content",
        layout: "horizontal",
        padding: 10,
        children: [{
          type: "frame",
          id: "inner",
          width: "fit_content",
          height: "fit_content",
          layout: "horizontal",
          padding: 8,
          gap: 4,
          children: [
            { type: "rectangle", id: "r1", width: 50, height: 30 },
            { type: "rectangle", id: "r2", width: 50, height: 30 }
          ]
        }]
      }]
    };
    const [tree] = layoutDocument(doc);
    const inner = tree.children[0];
    expect(inner.box.width).toBe(120);
    expect(inner.box.height).toBe(46);
    expect(tree.box.width).toBe(140);
    expect(tree.box.height).toBe(66);
  });
});

describe("Layout - Text Measurement (B5)", () => {
  it("auto growth ignores width property", () => {
    const res = measureTextNode({
      type: "text",
      id: "t1",
      content: "Hello world",
      fontSize: 16,
      textGrowth: "auto",
      width: 500
    });
    expect(res.width).toBeLessThan(150);
    expect(res.height).toBe(19);
  });

  it("fixed-width text wraps into multiple line heights", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "frame",
        id: "f1",
        width: 300,
        height: 100,
        padding: 20,
        children: [{
          type: "text",
          id: "tFixed",
          content: "A much longer line of text that definitely wraps into multiple lines",
          fontSize: 16,
          textGrowth: "fixed-width",
          width: "fill_container"
        }]
      }]
    };
    const [tree] = layoutDocument(doc);
    const textNode = tree.children[0];
    expect(textNode.box.width).toBe(260);
    expect(textNode.box.height % 19).toBe(0);
    expect(textNode.box.height).toBeGreaterThanOrEqual(38);
  });
});

describe("Layout - Absolute Position, Groups & Rotation (B6)", () => {
  it("positions children with layout: 'none' (noneLayout probe)", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "frame",
        id: "noneFrame",
        layout: "none",
        width: 300,
        height: 200,
        children: [
          { type: "rectangle", id: "n1", x: 33, y: 44, width: 50, height: 50 },
          { type: "rectangle", id: "n2", x: 150, y: 70, width: 50, height: 50 }
        ]
      }]
    };
    const [tree] = layoutDocument(doc);
    expect(tree.children[0].box.x).toBe(33);
    expect(tree.children[0].box.y).toBe(44);
    expect(tree.children[1].box.x).toBe(150);
    expect(tree.children[1].box.y).toBe(70);
  });

  it("leaves flow for layoutPosition: 'absolute' (absChild probe)", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "frame",
        id: "fAbs",
        layout: "horizontal",
        width: 300,
        height: 100,
        padding: 20,
        gap: 10,
        children: [
          { type: "rectangle", id: "ab1", width: 60, height: 40 },
          { type: "rectangle", id: "ab2", width: 60, height: 40, layoutPosition: "absolute", x: 200, y: 5 },
          { type: "rectangle", id: "ab3", width: 60, height: 40 }
        ]
      }]
    };
    const [tree] = layoutDocument(doc);
    expect(tree.children[0].box.x).toBe(20);
    expect(tree.children[1].box.x).toBe(200);
    expect(tree.children[1].box.y).toBe(5);
    // ab3 takes the next flow slot at 20 + 60 + 10 = 90
    expect(tree.children[2].box.x).toBe(90);
  });

  it("positions children inside group nodes", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "group",
        id: "g1",
        children: [
          { type: "rectangle", id: "gr1", x: 10, y: 15, width: 40, height: 40 },
          { type: "rectangle", id: "gr2", x: 60, y: 25, width: 40, height: 40 }
        ]
      }]
    };
    const [tree] = layoutDocument(doc);
    expect(tree.children[0].box.x).toBe(10);
    expect(tree.children[0].box.y).toBe(15);
    expect(tree.children[1].box.x).toBe(60);
    expect(tree.children[1].box.y).toBe(25);
  });

  it("preserves counter-clockwise rotation", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "rectangle",
        id: "rRot",
        width: 100,
        height: 50,
        rotation: 45
      }]
    };
    const [tree] = layoutDocument(doc);
    expect(tree.rotation).toBe(45);
  });
});

describe("Layout - Full Fixture Agreement (B7)", () => {
  it("resolves valid layout trees for all 12 fixtures", () => {
    const fixtureDir = join(import.meta.dir, "../fixtures");
    const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".pen"));
    expect(files.length).toBe(12);

    for (const file of files) {
      const content = readFileSync(join(fixtureDir, file), "utf-8");
      const doc = parseDocument(content);
      const layoutNodes = layoutDocument(doc);
      expect(layoutNodes.length).toBeGreaterThan(0);

      function assertValidBoxes(node: LayoutNode) {
        expect(Number.isNaN(node.box.x)).toBe(false);
        expect(Number.isNaN(node.box.y)).toBe(false);
        expect(node.box.width).toBeGreaterThanOrEqual(0);
        expect(node.box.height).toBeGreaterThanOrEqual(0);
        for (const child of node.children) assertValidBoxes(child);
      }

      for (const root of layoutNodes) assertValidBoxes(root);
    }
  });
});

