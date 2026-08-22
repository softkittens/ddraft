import { describe, it, expect } from "bun:test";
import { decideAgentDocument } from "../src/ui/agentDocument";
import { makeDoc, frame, rect } from "./harness";
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
