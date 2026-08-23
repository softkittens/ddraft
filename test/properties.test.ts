import { describe, it, expect } from "bun:test";
import { makeDoc, frame, rect, txt } from "./harness";
import { applyProperty } from "../src/model/properties";
import { findNode } from "../src/model/tree";
import type { Document, FrameNode, IconNode, RefNode, TextNode } from "../src/model/types";

const doc = (): Document =>
  makeDoc(
    frame("screen", 390, 844, [
      txt("title", "Hello", 24),
      txt("body", "World", 14),
      rect("box", 40, 40),
      { type: "icon", id: "glyph", icon: "star", width: 24, height: 24 } as IconNode
    ], { layout: "vertical" } as Partial<FrameNode>)
  );

const at = (d: Document, id: string) => findNode(d.children, id) as any;

describe("Writing one property", () => {
  it("sets it on the named node", () => {
    const out = applyProperty(doc(), ["title"], "fontSize", 32);
    expect(out.applied).toEqual(["title"]);
    expect(at(out.doc, "title").fontSize).toBe(32);
  });

  it("hands back the same document when the value is already set", () => {
    const start = doc();
    const out = applyProperty(start, ["title"], "fontSize", 24);
    expect(out.doc).toBe(start);
    expect(out.applied).toEqual([]);
    expect(out.skipped).toEqual(["title"]);
  });

  it("clears a property when the value is undefined", () => {
    const out = applyProperty(doc(), ["title"], "fontSize", undefined);
    expect(out.applied).toEqual(["title"]);
    expect(at(out.doc, "title")).not.toHaveProperty("fontSize");
  });

  it("refuses a property the renderer does not honour, and writes nothing", () => {
    const start = doc();
    const out = applyProperty(start, ["title"], "boxShadow", "0 0 4px red");
    expect(out.doc).toBe(start);
    expect(out.note).toContain("invalid property");
    expect(at(out.doc, "title")).not.toHaveProperty("boxShadow");
  });

  it("skips an id that names nothing rather than throwing", () => {
    const start = doc();
    const out = applyProperty(start, ["no_such_node"], "fontSize", 20);
    expect(out.doc).toBe(start);
    expect(out.skipped).toEqual(["no_such_node"]);
  });
});

describe("Writing across a selection", () => {
  it("fans one value out over every node that carries it", () => {
    const out = applyProperty(doc(), ["title", "body"], "fontSize", 18);
    expect(out.applied).toEqual(["title", "body"]);
    expect(at(out.doc, "title").fontSize).toBe(18);
    expect(at(out.doc, "body").fontSize).toBe(18);
  });

  it("skips the nodes whose type does not carry the property", () => {
    // Two labels and a rectangle: setting the size should set two font sizes,
    // not stamp a meaningless one onto the rectangle.
    const out = applyProperty(doc(), ["title", "box", "body"], "fontSize", 18);
    expect(out.applied).toEqual(["title", "body"]);
    expect(out.skipped).toEqual(["box"]);
    expect(at(out.doc, "box")).not.toHaveProperty("fontSize");
  });

  it("still writes the rest when one id in the selection is unknown", () => {
    const out = applyProperty(doc(), ["title", "ghost"], "fontSize", 18);
    expect(out.applied).toEqual(["title"]);
    expect(out.skipped).toEqual(["ghost"]);
  });

  it("writes properties every type carries onto every type", () => {
    const out = applyProperty(doc(), ["title", "box", "glyph"], "opacity", 0.5);
    expect(out.applied).toEqual(["title", "box", "glyph"]);
  });
});

describe("The value vocabulary", () => {
  it("rewrites a CSS spelling to the one the engine reads", () => {
    const out = applyProperty(doc(), ["screen"], "justifyContent", "space-between");
    expect(at(out.doc, "screen").justifyContent).toBe("space_between");
    expect(out.note).toContain("space_between");
  });

  it("rewrites it once, so a mixed selection cannot end up half in each spelling", () => {
    const start = makeDoc(
      frame("a", 100, 100, [], { layout: "horizontal" } as Partial<FrameNode>),
      frame("b", 100, 100, [], { layout: "horizontal" } as Partial<FrameNode>)
    );
    const out = applyProperty(start, ["a", "b"], "justifyContent", "flex-end");
    expect(at(out.doc, "a").justifyContent).toBe("end");
    expect(at(out.doc, "b").justifyContent).toBe("end");
  });

  it("refuses a value the engine has no equivalent for, and says what to use", () => {
    const start = doc();
    const out = applyProperty(start, ["screen"], "alignItems", "stretch");
    expect(out.doc).toBe(start);
    expect(out.note).toContain("fill_container");
    expect(at(out.doc, "screen")).not.toHaveProperty("alignItems");
  });
});

describe("Writing into a component instance", () => {
  const withInstance = (): Document =>
    makeDoc(
      frame("card", 200, 100, [txt("card_label", "Buy", 14)], { reusable: true } as Partial<FrameNode>),
      frame("screen", 390, 844, [
        { type: "ref", id: "use_1", ref: "card" } as RefNode,
        { type: "ref", id: "use_2", ref: "card" } as RefNode
      ])
    );

  it("stores the change as an override on that instance", () => {
    const out = applyProperty(withInstance(), ["use_1:card_label"], "content", "Subscribe");
    expect(out.applied).toEqual(["use_1:card_label"]);
    expect((at(out.doc, "use_1") as RefNode).descendants?.card_label.content).toBe("Subscribe");
  });

  it("leaves the component and the other instance untouched", () => {
    const out = applyProperty(withInstance(), ["use_1:card_label"], "content", "Subscribe");
    // The component still says what it always said, so use_2 still renders it.
    expect((at(out.doc, "card_label") as TextNode).content).toBe("Buy");
    expect((at(out.doc, "use_2") as RefNode).descendants).toBeUndefined();
  });

  it("checks the descendant's own type before writing", () => {
    const start = makeDoc(
      frame("card", 200, 100, [rect("card_box", 40, 40)], { reusable: true } as Partial<FrameNode>),
      frame("screen", 390, 844, [{ type: "ref", id: "use_1", ref: "card" } as RefNode])
    );
    const out = applyProperty(start, ["use_1:card_box"], "fontSize", 20);
    expect(out.doc).toBe(start);
    expect(out.skipped).toEqual(["use_1:card_box"]);
  });

  it("takes a plain node and an instance descendant in the same call", () => {
    const out = applyProperty(withInstance(), ["card_label", "use_1:card_label"], "fontWeight", "bold");
    expect(out.applied).toEqual(["card_label", "use_1:card_label"]);
  });
});

describe("Swapping an icon", () => {
  it("sets the geometry the renderer draws, not just the name", () => {
    const before = at(doc(), "glyph").geometry;
    const out = applyProperty(doc(), ["glyph"], "icon", "heart");
    const after = at(out.doc, "glyph") as IconNode;
    expect(after.icon).toBe("heart");
    // An icon with a name and no path draws nothing at all.
    expect(after.geometry).toBeTruthy();
    expect(after.geometry).not.toBe(before);
  });

  it("clears the stale path when the name is not in the library", () => {
    const named = applyProperty(doc(), ["glyph"], "icon", "heart").doc;
    const out = applyProperty(named, ["glyph"], "icon", "not-a-real-icon");
    expect(at(out.doc, "glyph")).not.toHaveProperty("geometry");
  });
});
