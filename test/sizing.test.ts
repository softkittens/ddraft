import { describe, it, expect } from "bun:test";
import {
  canFill,
  canHug,
  readSizeMode,
  sizeFallback,
  sizeModes,
  sizeWrites,
  type SizeMode
} from "../src/model/sizing";
import { layoutDocument } from "../src/layout/layout";
import { findNodeWorldBox } from "../src/interaction/hittest";
import type { Document, PenNode } from "../src/model/types";

const rect = (id: string, width: any, height: any, extra: any = {}): any => ({
  type: "rectangle", id, width, height, ...extra
});
const text = (id: string, extra: any = {}): any => ({
  type: "text", id, content: "The quick brown fox jumps over the lazy dog", fontSize: 16, ...extra
});
const wrap = (kids: any[], frame: any = {}): Document => ({
  version: "1.0", variables: {},
  children: [{ type: "frame", id: "parent", x: 0, y: 0, width: 400, height: 200,
    layout: "horizontal", gap: 10, padding: 20, ...frame, children: kids }]
} as any);

/** The laid-out size of a node, straight from the engine. */
const sizeOf = (doc: Document, id: string): { w: number; h: number } => {
  const box = findNodeWorldBox(layoutDocument(doc), id)!;
  return { w: Math.round(box.width), h: Math.round(box.height) };
};

describe("Which modes a node may use", () => {
  it("lets a frame hug, because it has children to measure", () => {
    expect(canHug({ type: "frame", id: "f" } as PenNode, "width")).toBe(true);
    expect(canHug({ type: "group", id: "g" } as PenNode, "width")).toBe(true);
  });

  it("does not let a leaf shape hug", () => {
    for (const type of ["rectangle", "ellipse", "polygon", "path", "icon"]) {
      expect(canHug({ type, id: "x" } as PenNode, "width")).toBe(false);
    }
  });

  it("needs a flow parent to fill", () => {
    const node = rect("k", "fill_container", 40);
    expect(canFill(node, { type: "frame", id: "p", layout: "horizontal" } as any)).toBe(true);
    expect(canFill(node, { type: "frame", id: "p", layout: "none" } as any)).toBe(false);
    expect(canFill(node, { type: "group", id: "p" } as any)).toBe(false);
    expect(canFill(node, null)).toBe(false);
  });

  it("does not let an absolutely positioned child fill", () => {
    const parent = { type: "frame", id: "p", layout: "horizontal" } as any;
    expect(canFill(rect("k", 10, 10, { layoutPosition: "absolute" }), parent)).toBe(false);
  });

  it("offers a frame in flow all three", () => {
    expect(sizeModes({ type: "frame", id: "f" } as PenNode,
      { type: "frame", id: "p", layout: "vertical" } as any, "width"))
      .toEqual(["fixed", "hug", "fill"]);
  });

  it("offers a root frame everything but fill", () => {
    expect(sizeModes({ type: "frame", id: "f" } as PenNode, null, "width"))
      .toEqual(["fixed", "hug"]);
  });

  it("offers a leaf in flow everything but hug", () => {
    expect(sizeModes(rect("r", 10, 10), { type: "frame", id: "p", layout: "horizontal" } as any, "width"))
      .toEqual(["fixed", "fill"]);
  });

  it("offers text height nothing to choose, because the engine derives it", () => {
    expect(sizeModes(text("t"), { type: "frame", id: "p", layout: "vertical" } as any, "height"))
      .toEqual(["hug"]);
  });
});

/*
 * The two traps, measured against the real layout pass rather than argued.
 * These are the reason sizeModes hides anything at all.
 */
describe("The modes that would zero a node", () => {
  it("collapses a leaf to nothing under fit_content", () => {
    expect(sizeOf(wrap([rect("r", "fit_content", 50)]), "r")).toEqual({ w: 0, h: 50 });
    expect(sizeOf(wrap([rect("r", 100, 50)]), "r")).toEqual({ w: 100, h: 50 });
  });

  it("collapses a fill child of a layout:none parent to nothing", () => {
    const doc = wrap([rect("r", "fill_container", 40)], { layout: "none" });
    expect(sizeOf(doc, "r").w).toBe(0);
  });

  it("collapses an absolutely positioned fill child to nothing", () => {
    const doc = wrap([rect("r", "fill_container", 40, { layoutPosition: "absolute" })]);
    expect(sizeOf(doc, "r").w).toBe(0);
  });

  it("fills correctly when the parent really is distributing space", () => {
    // 400 wide, padding 20 each side -> 360 of content.
    expect(sizeOf(wrap([rect("r", "fill_container", 40)]), "r").w).toBe(360);
    const two = wrap([rect("a", "fill_container", 40), rect("b", 80, 40)]);
    expect(sizeOf(two, "a").w).toBe(270); // 360 - 80 - 10 gap
  });

  it("hides exactly the modes those cases would break", () => {
    const flowParent = { type: "frame", id: "p", layout: "horizontal" } as any;
    expect(sizeModes(rect("r", 10, 10), flowParent, "width")).not.toContain("hug");
    expect(sizeModes(rect("r", 10, 10), { ...flowParent, layout: "none" }, "width")).not.toContain("fill");
  });
});

describe("Reading the mode a node is in", () => {
  it("reads a number as fixed and a keyword as itself", () => {
    expect(readSizeMode(rect("r", 100, 50), "width")).toBe("fixed");
    expect(readSizeMode(rect("r", "fill_container", 50), "width")).toBe("fill");
    expect(readSizeMode({ type: "frame", id: "f", width: "fit_content" } as any, "width")).toBe("hug");
  });

  it("reads an unset size as hug, which is what the engine does", () => {
    expect(readSizeMode({ type: "frame", id: "f" } as any, "width")).toBe("hug");
    expect(readSizeMode({ type: "frame", id: "f", width: "auto" } as any, "width")).toBe("hug");
  });

  it("keeps the fallback in fit_content(n) readable", () => {
    expect(sizeFallback({ type: "frame", id: "f", height: "fit_content(844)" } as any, "height")).toBe(844);
    expect(sizeFallback({ type: "frame", id: "f", height: 100 } as any, "height")).toBeUndefined();
  });

  it("reads text from textGrowth, not from its width", () => {
    // A number on a text node does nothing unless growth says to look at it,
    // so a control reading the number would report Fixed for a hugging node.
    expect(readSizeMode(text("t", { width: 120 }), "width")).toBe("hug");
    expect(readSizeMode(text("t", { width: 120, textGrowth: "fixed-width" }), "width")).toBe("fixed");
    expect(readSizeMode(text("t", { textGrowth: "fixed-width-height" }), "width")).toBe("fixed");
  });

  it("proves that reading, for a text node with a width the engine ignores", () => {
    const ignored = wrap([text("t", { width: 120 })], { layout: "vertical", width: 600 });
    const honoured = wrap([text("t", { width: 120, textGrowth: "fixed-width" })], { layout: "vertical", width: 600 });
    expect(sizeOf(ignored, "t").w).not.toBe(120);
    expect(sizeOf(honoured, "t").w).toBe(120);
  });

  it("reads fill on text from the width, since fill applies either way", () => {
    expect(readSizeMode(text("t", { width: "fill_container" }), "width")).toBe("fill");
  });

  it("always reads text height as hug", () => {
    expect(readSizeMode(text("t", { height: 40, textGrowth: "fixed-width-height" }), "height")).toBe("hug");
  });
});

describe("The writes that change a mode", () => {
  const frameNode = { type: "frame", id: "f" } as PenNode;

  it("writes one property for a frame", () => {
    expect(sizeWrites(frameNode, "width", "hug", 100)).toEqual([{ property: "width", value: "fit_content" }]);
    expect(sizeWrites(frameNode, "height", "fill", 100)).toEqual([{ property: "height", value: "fill_container" }]);
  });

  it("freezes the measured size when switching to fixed", () => {
    expect(sizeWrites(frameNode, "width", "fixed", 237.4)).toEqual([{ property: "width", value: 237 }]);
  });

  it("never writes a size below one pixel", () => {
    expect(sizeWrites(frameNode, "width", "fixed", 0)).toEqual([{ property: "width", value: 1 }]);
    expect(sizeWrites(frameNode, "width", "fixed", -8)).toEqual([{ property: "width", value: 1 }]);
  });

  it("writes textGrowth alongside every text width, never the width alone", () => {
    for (const mode of ["fixed", "hug", "fill"] as SizeMode[]) {
      const writes = sizeWrites(text("t"), "width", mode, 120);
      expect(writes.map((w) => w.property).sort()).toEqual(["textGrowth", "width"]);
    }
  });

  it("gives text its hug back", () => {
    expect(sizeWrites(text("t", { width: 120, textGrowth: "fixed-width" }), "width", "hug", 120))
      .toEqual([{ property: "width", value: "auto" }, { property: "textGrowth", value: "auto" }]);
  });

  it("keeps fixed-width-height when it is already set, since height is inert either way", () => {
    const writes = sizeWrites(text("t", { textGrowth: "fixed-width-height" }), "width", "fixed", 120);
    expect(writes).toContainEqual({ property: "textGrowth", value: "fixed-width-height" });
  });

  it("makes a filling text wrap, rather than overflow its box", () => {
    expect(sizeWrites(text("t"), "width", "fill", 0))
      .toEqual([{ property: "width", value: "fill_container" }, { property: "textGrowth", value: "fixed-width" }]);
  });

  it("writes nothing for a text height", () => {
    expect(sizeWrites(text("t"), "height", "fixed", 40)).toEqual([]);
  });
});

/* Applying the writes and running the engine: the modes do what they claim. */
describe("Round trip through the layout engine", () => {
  const apply = (node: any, axis: "width" | "height", mode: SizeMode, measured: number): any => {
    const next = { ...node };
    for (const { property, value } of sizeWrites(node, axis, mode, measured)) next[property] = value;
    return next;
  };

  it("takes a hugging frame to fixed without moving it", () => {
    const card = { type: "frame", id: "card", layout: "horizontal", padding: 10, gap: 8,
      children: [rect("i1", 30, 30), rect("i2", 30, 30)] };
    const hugged = sizeOf(wrap([card]), "card");
    expect(hugged.w).toBe(88);
    const fixedDoc = wrap([apply(card, "width", "fixed", hugged.w)]);
    expect(sizeOf(fixedDoc, "card").w).toBe(88);
  });

  it("takes a fixed frame back to hug", () => {
    const card = { type: "frame", id: "card", width: 300, layout: "horizontal", padding: 10, gap: 8,
      children: [rect("i1", 30, 30), rect("i2", 30, 30)] };
    expect(sizeOf(wrap([card]), "card").w).toBe(300);
    expect(sizeOf(wrap([apply(card, "width", "hug", 300)]), "card").w).toBe(88);
  });

  it("takes a fixed text back to hug and restores its natural width", () => {
    const narrow = { layout: "vertical", width: 200 };
    const fixed = text("t", { width: 120, textGrowth: "fixed-width" });
    const wrapped = sizeOf(wrap([fixed], narrow), "t");
    expect(wrapped.w).toBe(120);
    expect(wrapped.h).toBeGreaterThan(30); // it wrapped onto several lines

    const hugged = sizeOf(wrap([apply(fixed, "width", "hug", 120)], narrow), "t");
    expect(hugged.w).toBeGreaterThan(300); // back to one natural line
    expect(hugged.h).toBeLessThan(30);
  });

  it("makes a filled text actually wrap to the space it was given", () => {
    const narrow = { layout: "vertical", width: 200 };
    const filled = apply(text("t"), "width", "fill", 0);
    const size = sizeOf(wrap([filled], narrow), "t");
    expect(size.w).toBe(160); // 200 less 20 padding each side
    expect(size.h).toBeGreaterThan(30); // and it wrapped, rather than overflowing
  });

  it("leaves a filled text one line tall if growth is omitted — the case the pairing prevents", () => {
    const narrow = { layout: "vertical", width: 200 };
    const half = sizeOf(wrap([text("t", { width: "fill_container" })], narrow), "t");
    expect(half.w).toBe(160);
    expect(half.h).toBeLessThan(30); // box filled, glyphs still on one 337px line
  });
});
