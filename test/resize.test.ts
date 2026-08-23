import { describe, it, expect } from "bun:test";
import { makeDoc, frame, rect, txt } from "./harness";
import {
  handleAtScreenPoint,
  resizeBox,
  applyResize,
  cursorForHandle,
  type ResizeHandle
} from "../src/interaction/resize";
import { findNode } from "../src/model/tree";
import type { Box } from "../src/layout/types";
import type { FrameNode, TextNode } from "../src/model/types";

const box: Box = { x: 100, y: 100, width: 200, height: 100 };

describe("Grabbing a handle", () => {
  const at = (x: number, y: number) => handleAtScreenPoint(box, { x, y });

  it("finds each corner", () => {
    expect(at(100, 100)).toBe("nw");
    expect(at(300, 100)).toBe("ne");
    expect(at(300, 200)).toBe("se");
    expect(at(100, 200)).toBe("sw");
  });

  it("finds an edge anywhere along it, not just at its middle", () => {
    // No handle is painted on the edges, so the whole band has to be live.
    expect(at(150, 100)).toBe("n");
    expect(at(250, 100)).toBe("n");
    expect(at(200, 200)).toBe("s");
    expect(at(100, 150)).toBe("w");
    expect(at(300, 160)).toBe("e");
  });

  it("gives a corner to the corner, not to the edge crossing it", () => {
    // Both bands cover this point; the corner is the smaller target and the
    // one that changes two axes.
    expect(at(102, 102)).toBe("nw");
  });

  it("finds nothing well inside or well outside the box", () => {
    expect(at(200, 150)).toBeNull();
    expect(at(400, 400)).toBeNull();
    expect(at(200, 130)).toBeNull();
  });

  it("reaches a little past the edge, so the target is not a hairline", () => {
    expect(at(200, 97)).toBe("n");
    expect(at(303, 150)).toBe("e");
  });

  it("names a cursor for every handle", () => {
    const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
    for (const handle of handles) expect(cursorForHandle(handle)).toMatch(/-resize$/);
    expect(cursorForHandle("nw")).toBe(cursorForHandle("se"));
    expect(cursorForHandle("n")).toBe("ns-resize");
  });
});

describe("Dragging an edge", () => {
  it("moves the edge and leaves the opposite one anchored", () => {
    expect(resizeBox(box, "e", 50, 0)).toEqual({ x: 100, y: 100, width: 250, height: 100 });
    expect(resizeBox(box, "s", 0, 40)).toEqual({ x: 100, y: 100, width: 200, height: 140 });
  });

  it("moves the origin when the west or north edge is the one dragged", () => {
    expect(resizeBox(box, "w", 40, 0)).toEqual({ x: 140, y: 100, width: 160, height: 100 });
    expect(resizeBox(box, "n", 0, 30)).toEqual({ x: 100, y: 130, width: 200, height: 70 });
  });

  it("changes only the axis the edge belongs to", () => {
    const out = resizeBox(box, "e", 50, 999);
    expect(out.height).toBe(100);
    expect(out.y).toBe(100);
  });

  it("changes both axes from a corner", () => {
    expect(resizeBox(box, "se", 50, 40)).toEqual({ x: 100, y: 100, width: 250, height: 140 });
    expect(resizeBox(box, "nw", 20, 10)).toEqual({ x: 120, y: 110, width: 180, height: 90 });
  });
});

describe("Dragging past the far edge", () => {
  it("stops at the minimum rather than turning the box inside out", () => {
    const out = resizeBox(box, "e", -400, 0, { min: 1 });
    expect(out.width).toBe(1);
    expect(out.x).toBe(100);
  });

  it("keeps the anchored edge in place while clamping", () => {
    const out = resizeBox(box, "w", 400, 0, { min: 1 });
    expect(out.width).toBe(1);
    // The east edge was the anchor and it has not moved.
    expect(out.x + out.width).toBe(300);
  });
});

describe("Holding alt", () => {
  it("resizes about the centre, so the opposite edge moves too", () => {
    const out = resizeBox(box, "e", 25, 0, { fromCenter: true });
    expect(out.width).toBe(250);
    expect(out.x).toBe(75);
    // The centre is where it started.
    expect(out.x + out.width / 2).toBe(box.x + box.width / 2);
  });

  it("holds the centre from a corner too", () => {
    const out = resizeBox(box, "nw", -10, -5, { fromCenter: true });
    expect(out.x + out.width / 2).toBe(200);
    expect(out.y + out.height / 2).toBe(150);
  });
});

describe("Holding shift", () => {
  it("keeps the starting proportions from a corner", () => {
    const out = resizeBox(box, "se", 100, 0, { aspect: true });
    expect(out.width / out.height).toBeCloseTo(box.width / box.height, 5);
  });

  it("follows whichever axis moved further", () => {
    // Dragging mostly downward should still widen to match.
    const out = resizeBox(box, "se", 0, 100, { aspect: true });
    expect(out.height).toBe(200);
    expect(out.width).toBe(400);
  });

  it("keeps the anchor corner pinned", () => {
    const out = resizeBox(box, "nw", -50, 0, { aspect: true });
    expect(out.x + out.width).toBeCloseTo(300, 5);
    expect(out.y + out.height).toBeCloseTo(200, 5);
  });

  it("is ignored on an edge, which has only one axis to scale", () => {
    expect(resizeBox(box, "e", 50, 0, { aspect: true }).height).toBe(100);
  });
});

describe("Writing the resize onto the document", () => {
  const doc = () =>
    makeDoc(
      frame("screen", 390, 844, [
        rect("box", 100, 60, { x: 10, y: 20 }),
        txt("label", "Hello", 14)
      ], { layout: "none" } as Partial<FrameNode>)
    );

  it("writes rounded numbers, not fractions of a pixel", () => {
    const out = applyResize(doc(), "box", "se", { x: 10, y: 20, width: 133.7, height: 60.2 });
    const node = findNode(out.children, "box")!;
    expect(node.width).toBe(134);
    expect(node.height).toBe(60);
  });

  it("writes the origin only for the handles that move it", () => {
    const east = findNode(applyResize(doc(), "box", "e", { x: 999, y: 999, width: 150, height: 60 }).children, "box")!;
    // An `e` drag anchors the west edge; writing x would fight that anchor.
    expect(east.x).toBe(10);

    const west = findNode(applyResize(doc(), "box", "w", { x: 40, y: 999, width: 70, height: 60 }).children, "box")!;
    expect(west.x).toBe(40);
    expect(west.y).toBe(20);
  });

  it("leaves the axis the handle does not touch alone", () => {
    const node = findNode(applyResize(doc(), "box", "e", { x: 10, y: 20, width: 150, height: 999 }).children, "box")!;
    expect(node.height).toBe(60);
  });

  it("hands back the same document for an id it cannot find", () => {
    const start = doc();
    expect(applyResize(start, "ghost", "se", box)).toBe(start);
  });
});

describe("Resizing text that hugs its content", () => {
  const doc = () => makeDoc(frame("screen", 390, 844, [txt("label", "Hello there", 14)]));

  it("converts it to a fixed width, or the width would be ignored", () => {
    // measureText returns the natural width whenever textGrowth is "auto", so
    // a width written without this does nothing at all on screen.
    const node = findNode(applyResize(doc(), "label", "e", { x: 0, y: 0, width: 120, height: 20 }).children, "label") as TextNode;
    expect(node.width).toBe(120);
    expect(node.textGrowth).toBe("fixed-width");
  });

  it("fixes both axes when the height is dragged", () => {
    const node = findNode(applyResize(doc(), "label", "s", { x: 0, y: 0, width: 100, height: 48 }).children, "label") as TextNode;
    expect(node.textGrowth).toBe("fixed-width-height");
  });

  it("leaves an already fixed-width label alone when only the width moves", () => {
    const start = makeDoc(
      frame("screen", 390, 844, [txt("label", "Hello", 14, { textGrowth: "fixed-width-height" })])
    );
    const node = findNode(applyResize(start, "label", "e", { x: 0, y: 0, width: 120, height: 20 }).children, "label") as TextNode;
    expect(node.textGrowth).toBe("fixed-width-height");
  });

  it("leaves other node types' growth alone", () => {
    const node = findNode(
      applyResize(makeDoc(rect("box", 10, 10)), "box", "e", { x: 0, y: 0, width: 50, height: 10 }).children,
      "box"
    )!;
    expect(node).not.toHaveProperty("textGrowth");
  });
});

describe("Writing an alt-resize", () => {
  const doc = () =>
    makeDoc(
      frame("screen", 390, 844, [rect("box", 100, 60, { x: 50, y: 40 })], {
        layout: "none"
      } as Partial<FrameNode>)
    );

  it("writes the origin for every handle, since no edge is anchored", () => {
    const start: Box = { x: 50, y: 40, width: 100, height: 60 };
    const next = resizeBox(start, "e", 20, 0, { fromCenter: true });
    const node = findNode(applyResize(doc(), "box", "e", next, { fromCenter: true }).children, "box")!;
    // An east drag normally leaves x alone; from the centre the west edge
    // moves too, and without writing x the box would grow one-sided.
    expect(node.x).toBe(30);
    expect(node.width).toBe(140);
    expect((node.x as number) + (node.width as number) / 2).toBe(100);
  });

  it("still leaves the untouched axis alone", () => {
    const next = resizeBox({ x: 50, y: 40, width: 100, height: 60 }, "e", 20, 0, { fromCenter: true });
    const node = findNode(applyResize(doc(), "box", "e", next, { fromCenter: true }).children, "box")!;
    expect(node.y).toBe(40);
    expect(node.height).toBe(60);
  });

  it("writes no origin without the modifier", () => {
    const next = resizeBox({ x: 50, y: 40, width: 100, height: 60 }, "e", 20, 0);
    const node = findNode(applyResize(doc(), "box", "e", next).children, "box")!;
    expect(node.x).toBe(50);
  });
});
