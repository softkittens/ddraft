import { describe, it, expect } from "bun:test";
import { decideAgentDocument } from "../src/ui/agentDocument";
import { makeDoc, frame, rect } from "./harness";
import { findNode } from "../src/model/tree";
import { layoutResolvedDocument, flattenLayoutTree } from "../src/layout/layout";
import { resolveInstances } from "../src/model/instance";
import { setProperty } from "../src/model/edit";
import { createDocumentTools } from "../src/agent/tools";
import { parseDocument } from "../src/model/parse";

describe("stale agent snapshots must not overwrite user edits", () => {
  it("accepts the first agent document against the request snapshot", () => {
    const sent = makeDoc(frame("f", 100, 100));
    const next = setProperty(sent, "f", "width", 200);
    expect(decideAgentDocument(sent, sent, next)).toEqual({ action: "accept", expected: next });
  });

  it("skips a duplicate document so history is not extended", () => {
    const sent = makeDoc(frame("f", 100, 100));
    expect(decideAgentDocument(sent, sent, sent)).toEqual({ action: "skip" });
  });

  it("accepts a deserialized clone of the last document (SSE cannot reuse identity)", () => {
    const sent = makeDoc(frame("f", 100, 100));
    const clone = JSON.parse(JSON.stringify(sent));
    expect(decideAgentDocument(sent, sent, clone)).toEqual({ action: "accept", expected: clone });
  });

  it("aborts when the canvas moved off the expected document", () => {
    const sent = makeDoc(frame("f", 100, 100));
    const userEdit = setProperty(sent, "f", "width", 80);
    const agentDoc = setProperty(sent, "f", "height", 200);
    expect(decideAgentDocument(userEdit, sent, agentDoc)).toEqual({ action: "abort" });
  });

  it("accepts a later tool document after the previous one was applied", () => {
    const sent = makeDoc(frame("f", 100, 100, [rect("r", 10, 10)]));
    const first = setProperty(sent, "f", "width", 200);
    const second = setProperty(first, "r", "width", 20);
    expect(decideAgentDocument(first, first, second)).toEqual({ action: "accept", expected: second });
  });
});

describe("insert_node normalizes what the model wrote", () => {
  it("renames a known alias and says that it did", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: { type: "frame", id: "f", name: "F", width: 100, height: 100, children: [], direction: "horizontal" }
    });
    expect(result).toContain("renamed 1 property");
    expect((session.doc.children[0] as any).layout).toBe("horizontal");
  });

  it("drops a property the engine does not have, and warns", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: { type: "frame", id: "f", name: "F", width: 100, height: 100, children: [], zIndex: 3 }
    });
    expect(result).toContain("dropped 1 property");
    expect((session.doc.children[0] as any).zIndex).toBeUndefined();
  });

  it("leaves a valid tree untouched", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: { type: "frame", id: "f", name: "F", width: 100, height: 100, layout: "vertical", children: [] }
    });
    expect(result).not.toContain("renamed");
    expect(result).not.toContain("dropped");
  });

  it("defaults centering on icon buttons and action frames", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: {
        type: "frame",
        id: "btn",
        name: "Action Button",
        width: 48,
        height: 48,
        cornerRadius: 24,
        children: [{ type: "icon", id: "ico", icon: "heart", width: 24, height: 24 }]
      }
    });
    expect(result).toContain("filled in 2 values");
    const frameNode = session.doc.children[0] as any;
    expect(frameNode.justifyContent).toBe("center");
    expect(frameNode.alignItems).toBe("center");
  });

  it("defaults centering on a status chip with a dot and a label", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: {
        type: "frame",
        id: "pill",
        name: "Status",
        width: 96,
        height: 36,
        cornerRadius: 99,
        layout: "none",
        children: [
          { type: "rectangle", id: "dot", width: 6, height: 6, fill: "$status-ok" },
          { type: "text", id: "state", content: "RUNNING", fontSize: 11 }
        ]
      }
    });
    expect(result).toContain("filled in");
    const frameNode = session.doc.children[0] as any;
    expect(frameNode.layout).toBe("horizontal");
    expect(frameNode.justifyContent).toBe("center");
    expect(frameNode.alignItems).toBe("center");
  });

  it("parses pen.dev files with forward-compatible shadowType and offset effect properties", () => {
    const raw = JSON.stringify({
      version: "2.17",
      children: [
        {
          type: "frame",
          id: "card",
          width: 300,
          height: 200,
          effect: [
            {
              type: "shadow",
              shadowType: "outer",
              offset: { x: 0, y: 4 },
              blur: 12,
              color: "#00000033",
              enabled: true
            }
          ]
        }
      ]
    });
    const parsed = parseDocument(raw);
    expect(parsed.children).toHaveLength(1);
    expect((parsed.children[0] as any).effect[0].shadowType).toBe("outer");
  });
});

describe("values the engine reads, not the CSS the model knows", () => {
  it("stands bar charts on their baseline instead of hanging them from the top", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: {
        type: "frame", id: "plot", name: "Plot", layout: "horizontal",
        width: 400, height: 120, gap: 10, alignItems: "flex_end",
        children: [
          { type: "frame", id: "b1", name: "Bar 1", width: 40, height: 40, fill: "#0af" },
          { type: "frame", id: "b2", name: "Bar 2", width: 40, height: 90, fill: "#0af" }
        ]
      }
    });
    /*
     * computeCrossAxisPosition falls through its `default` to 'start', so
     * 'flex_end' put every bar at the top of the plot with its varied height
     * hanging downward — the exact look of a chart that reads as broken. Our
     * own bar-chart rule asked for 'flex_end' until this landed.
     */
    expect(result).toContain("'flex_end' -> 'end'");
    const flat = flattenLayoutTree(layoutResolvedDocument(resolveInstances(session.doc)));
    const bottom = (id: string) => {
      const box = flat.get(id)!.box;
      return Math.round(box.y + box.height);
    };
    expect(bottom("b1")).toBe(bottom("b2"));
    expect(bottom("b1")).toBe(120);
  });

  it("reads the hyphenated spelling of space-between", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: {
        type: "frame", id: "row", name: "Row", layout: "horizontal", width: 300, height: 24,
        justifyContent: "space-between",
        children: [
          { type: "text", id: "k", content: "Battery" },
          { type: "text", id: "v", content: "78%" }
        ]
      }
    });
    // 256 writes in the logs, every one left-packing a row meant to be justified.
    expect(result).toContain("'space-between' -> 'space_between'");
    const flat = flattenLayoutTree(layoutResolvedDocument(resolveInstances(session.doc)));
    expect(Math.round(flat.get("v")!.box.x + flat.get("v")!.box.width)).toBe(300);
  });

  it("normalizes the same vocabulary on the single-property path", async () => {
    const session = createDocumentTools(makeDoc(
      frame("r", 300, 40, [], { layout: "horizontal" })
    ));
    const result = await session.execute("set_property", {
      id: "r", property: "justifyContent", value: "space-between"
    });
    expect(result).toContain("applied as 'space_between'");
    expect((findNode(session.doc.children, "r") as any).justifyContent).toBe("space_between");
  });

  it("says what to write instead of a value the engine does not have", async () => {
    const session = createDocumentTools(makeDoc(frame("r", 300, 40, [], { layout: "horizontal" })));
    const result = await session.execute("set_property", { id: "r", property: "alignItems", value: "stretch" });
    // Renaming this would be guessing: stretch is a child-side decision here.
    expect(result).toContain("no 'stretch'");
    expect(result).toContain("fill_container");
    expect((findNode(session.doc.children, "r") as any).alignItems).toBeUndefined();
  });

  it("maps the textGrowth spellings that meant something else", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: {
        type: "frame", id: "c", name: "C", width: 300, height: 80, layout: "vertical",
        children: [
          { type: "text", id: "a", content: "x".repeat(60), width: "fill_container", textGrowth: "fixed" },
          { type: "text", id: "b", content: "y".repeat(60), width: "fill_container", textGrowth: "fit_content" }
        ]
      }
    });
    expect(result).toContain("'fixed' -> 'fixed-width'");
    expect(result).toContain("'fit_content' -> 'auto'");
    expect((findNode(session.doc.children, "a") as any).textGrowth).toBe("fixed-width");
    expect((findNode(session.doc.children, "b") as any).textGrowth).toBe("auto");
  });
});

describe("the engine gets what the model meant, not what it typed", () => {
  it("reads size on an icon as a square box and on text as a font size", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: {
        type: "frame", id: "row", name: "Row", layout: "horizontal", gap: 8, width: 200, height: 40,
        children: [
          { type: "icon", id: "i", icon: "search", size: 16, stroke: "#fff" },
          { type: "text", id: "t", content: "Search", size: 13 }
        ]
      }
    });
    // `size` meant fontSize in the alias table, so an icon written this way had
    // its only dimension dropped and rendered 0x0. Two logged runs shipped 39
    // and 11 invisible icons that way.
    expect(result).toContain("icon.size -> width + height");
    const icon: any = findNode(session.doc.children, "i");
    const text: any = findNode(session.doc.children, "t");
    expect([icon.width, icon.height]).toEqual([16, 16]);
    expect(text.fontSize).toBe(13);
    expect(text.width).toBeUndefined();
  });

  it("gives an icon with no size the 24px Lucide draws on", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: { type: "icon", id: "i", icon: "bell", stroke: "#fff", width: undefined }
    });
    expect(result).toContain("on an icon with no size");
    const icon: any = findNode(session.doc.children, "i");
    expect([icon.width, icon.height]).toEqual([24, 24]);
  });

  it("resolves a percentage width into the pixels it meant", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: {
        type: "frame", id: "card", name: "Zone", layout: "vertical", width: 400, height: 120, padding: 16,
        children: [{
          type: "frame", id: "track", name: "Track", layout: "horizontal",
          width: "fill_container", height: 7, fill: "#222",
          children: [{ type: "frame", id: "fill", name: "Fill", width: "82%", height: "fill_container", fill: "#0af" }]
        }]
      }
    });
    // 400 less 16px of padding either side is a 368px track; 82% of it is 302.
    expect(result).toContain("82% of 368px = 302px");
    expect((findNode(session.doc.children, "fill") as any).width).toBe(302);
  });

  it("resolves a percentage written by set_property too", async () => {
    const session = createDocumentTools(makeDoc(
      frame("track", 200, 7, [frame("fill", 10, "fill_container")])
    ));
    const result = await session.execute("set_property", { id: "fill", property: "width", value: "50%" });
    expect(result).toContain("50% of 200px = 100px");
    expect((findNode(session.doc.children, "fill") as any).width).toBe(100);
  });

  it("leaves the percentage in place when the parent has no size to share", async () => {
    // A parent hugging this child has nothing to take a share of yet. Resolving
    // against it would write a real 0, which is worse than the string: the
    // string is what invisible_node reports back as the cause.
    const session = createDocumentTools(makeDoc());
    await session.execute("insert_node", {
      node: {
        type: "frame", id: "hug", name: "Hug", layout: "horizontal", width: "fit_content", height: "fit_content",
        children: [{ type: "frame", id: "f", name: "F", width: "60%", height: 8, fill: "#0af" }]
      }
    });
    expect((findNode(session.doc.children, "f") as any).width).toBe("60%");
  });
});

describe("a property write answers the question the model asks next", () => {
  it("reports the chain up to the screen, not just the immediate parent", async () => {
    const session = createDocumentTools(
      makeDoc(
        frame("screen", 390, 844, [
          frame("content", 350, 700, [frame("card", 318, 52, [rect("r", 40, 40)])])
        ])
      )
    );
    const result = await session.execute("set_property", { id: "card", property: "width", value: 300 });

    // 68 of the 76 follow-up `measure` calls in the logs ask about an ancestor
    // of the node just written, so the ancestor has to come back with the write.
    expect(result).toContain("measured:");
    expect(result).toContain("card");
    expect(result).toContain("content");
    expect(result).toContain("screen");
  });

  it("keeps the two nearest ancestors and the screen when the tree is deep", async () => {
    let node: any = rect("leaf", 10, 10);
    for (const id of ["d", "c", "b", "a"]) node = frame(id, 200, 200, [node]);
    const session = createDocumentTools(makeDoc(frame("screen", 390, 844, [node])));
    const result = await session.execute("set_property", { id: "leaf", property: "width", value: 20 });

    expect(result).toContain("screen");
    expect(result).toContain("d");
    // The middle of the chain is scaffolding the model already knows about.
    expect(result).not.toContain("b 200x200px");
  });
});
