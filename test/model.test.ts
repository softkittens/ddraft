import { describe, it, expect } from "bun:test";
import { parseDocument, parseSizing } from "../src/model/parse";
import { layoutDocument } from "../src/layout/layout";
import { setProperty, insertChild, replaceNode, removeNode, moveNode, duplicateNode, reorderChild } from "../src/model/edit";
import {
  resolveInstances,
  resolveInstancesWithDiagnostics,
  setInstanceProperty,
  splitInstanceId
} from "../src/model/instance";
import { digest } from "../src/digest/digest";
import { evaluateLayoutConstraints, auditDocument } from "../src/design/evaluator";
import { makeDoc, frame, rect, txt } from "./harness";

describe("Model & Design Subsystem", () => {
  it("parses documents and sizing expressions", () => {
    const parsed = parseDocument(JSON.stringify(makeDoc(frame("root", 100, 100))));
    expect(parsed.version).toBe("2.17");
    expect(parsed.children.length).toBe(1);
    expect(parseSizing(100)).toEqual({ mode: "fixed", value: 100 });
    expect(parseSizing("fit_content")).toEqual({ mode: "fit_content", fallback: undefined });
    expect(parseSizing("fill_container(200)")).toEqual({ mode: "fill_container", fallback: 200 });
    expect(parseSizing("auto")).toEqual({ mode: "auto" });
    expect(parseSizing(undefined)).toEqual({ mode: "auto" });
    expect(parseSizing("invalid_typo")).toEqual({ mode: "fixed", value: 0 });

    // Parses extended Pen format features without schema errors
    const extendedPen = JSON.stringify({
      version: "2.17",
      metadata: { source: "figma_export", tags: ["ui", "v2"] },
      children: [
        {
          id: "card",
          type: "frame",
          width: 300,
          height: 400,
          fill: { type: "image", enabled: true, url: "https://cdn.example.com/asset.png", mode: "fill" },
          effect: { type: "shadow", blur: 12, color: "rgba(0,0,0,0.2)" },
          metadata: { component: "HeroCard" },
          children: [
            {
              id: "title",
              type: "text",
              content: "Dashboard Overview",
              textAlign: "center",
              fontSize: 18
            },
            {
              id: "pie_slice",
              type: "ellipse",
              width: 80,
              height: 80,
              innerRadius: 0.6,
              startAngle: 0,
              sweepAngle: 120,
              fill: "#0d99ff"
            }
          ]
        }
      ]
    });

    const extended = parseDocument(extendedPen);
    expect(extended.children.length).toBe(1);
    expect((extended.children[0] as any).fill.type).toBe("image");
    expect((extended.children[0] as any).fill.url).toBe("https://cdn.example.com/asset.png");
    expect((extended.children[0] as any).children[0].textAlign).toBe("center");
    expect((extended.children[0] as any).children[1].innerRadius).toBe(0.6);

    const withUnknown = parseDocument(JSON.stringify({
      version: "2.17",
      children: [{ id: "r", type: "rectangle", pluginData: { source: "pen" } }]
    }));
    expect((withUnknown.children[0] as any).pluginData).toEqual({ source: "pen" });

    expect(() => parseDocument(JSON.stringify({
      version: "2.17",
      children: [{ id: "r", type: "rectangle", effect: { type: "shadow", blur: 4, unknown: true } }]
    }))).toThrow();
  });



  it("edits document tree immutably and safely", () => {
    const doc = makeDoc(frame("f1", 100, 100, [
      frame("f2", 80, 80, [rect("r1", 50, 50)]),
      rect("shape", 40, 40)
    ]));

    // 1. Moving a node into its own descendant leaves document byte-identical
    const cyclicMove = moveNode(doc, "f1", "f2");
    expect(cyclicMove).toEqual(doc);

    // 2. insertChild into a non-container shape returns document unchanged (no children key added)
    const invalidInsert = insertChild(doc, "shape", rect("child", 10, 10));
    expect(invalidInsert).toEqual(doc);
    const shapeNode = (invalidInsert.children[0] as any).children[1];
    expect(shapeNode.children).toBeUndefined();

    // 3. duplicateNode is deterministic and monotonic
    const dup1 = duplicateNode(doc, "r1");
    const dup2 = duplicateNode(doc, "r1");
    expect(dup1!.newId).toBe(dup2!.newId);
    expect(dup1!.newId).toBe("rectangle_3");


    // 4. Mutating move result does not touch input
    const mod = setProperty(doc, "r1", "width", 80);
    expect((mod.children[0] as any).children[0].children[0].width).toBe(80);
    expect((doc.children[0] as any).children[0].children[0].width).toBe(50);
    const removed = removeNode(mod, "r1");
    expect((removed.children[0] as any).children[0].children.length).toBe(0);
  });

  it("generates a digest shorter than the source document", () => {
    const doc = makeDoc(frame("screen", 390, 844, [
      txt("title", "Hello", 20, { fontWeight: "bold" }),
      rect("card", 200, 80, { fill: "#ffffff" })
    ], { name: "Home", layout: "vertical", gap: 12, padding: 16 }));
    const digestText = digest(doc);
    expect(digestText.length).toBeLessThan(JSON.stringify(doc).length);
    expect(digestText).toContain("screen");
    expect(digestText).toContain("title");
  });

  it("evaluates layout constraints", () => {
    const okDoc = makeDoc(frame("ok", 200, 200, [
      rect("r1", 40, 40, { x: 10, y: 10 } as any)
    ], { layout: "none" }));
    expect(evaluateLayoutConstraints(layoutDocument(okDoc), okDoc)).toEqual([]);

    const badDoc = makeDoc(frame("canvas", 200, 200, [
      rect("r1", 50, 50, { x: 10, y: 10 } as any),
      rect("r2", 50, 50, { x: 20, y: 20 } as any),
      txt("t1", "Tiny", 6)
    ], { layout: "none" }));
    const badTree = layoutDocument(badDoc);
    const badFindings = evaluateLayoutConstraints(badTree, badDoc);
    expect(badFindings.some((f) => f.rule === "collision")).toBe(true);
    expect(badFindings.some((f) => f.rule === "unreadable_size")).toBe(true);
  });

  it("handles circular component references safely and expands deep non-cyclic instances", () => {
    // Circular ref: A -> B -> A
    const circularDoc = makeDoc(
      {
        id: "compA",
        type: "frame",
        reusable: true,
        children: [{ id: "refB", type: "ref", ref: "compB" } as any]
      } as any,
      {
        id: "compB",
        type: "frame",
        reusable: true,
        children: [{ id: "refA", type: "ref", ref: "compA" } as any]
      } as any,
      {
        id: "rootInstance",
        type: "ref",
        ref: "compA"
      } as any
    );

    const { doc: resolved, cycles } = resolveInstancesWithDiagnostics(circularDoc);
    expect(cycles.length).toBeGreaterThan(0);
    expect(resolved.children.length).toBe(3);

    // Depth-5 non-cyclic nesting expands fully
    const c1: any = { id: "c1", type: "frame", reusable: true, children: [rect("r1", 10, 10)] };
    const c2: any = { id: "c2", type: "frame", reusable: true, children: [{ id: "r_c1", type: "ref", ref: "c1" }] };
    const c3: any = { id: "c3", type: "frame", reusable: true, children: [{ id: "r_c2", type: "ref", ref: "c2" }] };
    const c4: any = { id: "c4", type: "frame", reusable: true, children: [{ id: "r_c3", type: "ref", ref: "c3" }] };
    const c5: any = { id: "c5", type: "frame", reusable: true, children: [{ id: "r_c4", type: "ref", ref: "c4" }] };
    const deepDoc = makeDoc(c1, c2, c3, c4, c5, { id: "root", type: "ref", ref: "c5" } as any);
    const deepResolved = resolveInstances(deepDoc);
    const rootInst = deepResolved.children.find((c) => c.id === "root");
    expect(rootInst).toBeDefined();
    expect(JSON.stringify(rootInst)).toContain("rectangle");
  });

  it("stores synthetic instance-descendant edits as overrides", () => {
    const component = frame("card", 200, 100, [txt("label", "Original", 16)], { reusable: true });
    const source = makeDoc(component, { id: "card_one", type: "ref", ref: "card" } as any);
    const target = splitInstanceId(source, "card_one:label");

    expect(target).toEqual({ refId: "card_one", descendantId: "label" });
    const edited = setInstanceProperty(source, target!, "content", "Override");
    expect((edited.children[1] as any).descendants.label.content).toBe("Override");
    expect((component.children?.[0] as any).content).toBe("Original");
    expect((resolveInstances(edited).children[1] as any).children[0].content).toBe("Override");
  });
});

describe("document identity is the change signal", () => {
  const doc = () => makeDoc(frame("f1", 100, 100, [
    rect("r1", 50, 50),
    rect("r2", 40, 40)
  ]));

  it("setProperty returns the same document when the target is missing", () => {
    const original = doc();
    expect(setProperty(original, "missing", "width", 80)).toBe(original);
  });

  it("setProperty returns the same document when the value is already equal", () => {
    const original = doc();
    expect(setProperty(original, "r1", "width", 50)).toBe(original);
  });

  it("setProperty treats structurally equal property values as unchanged", () => {
    const original = makeDoc(frame("f1", 100, 100, [], {
      padding: [0, 16],
      effect: { type: "shadow", blur: 12, color: "#0000001A" }
    } as any));
    expect(setProperty(original, "f1", "padding", [0, 16])).toBe(original);
    expect(setProperty(original, "f1", "effect", {
      type: "shadow", blur: 12, color: "#0000001A"
    })).toBe(original);
  });

  it("setProperty returns a new document and leaves the original untouched", () => {
    const original = doc();
    const next = setProperty(original, "r1", "width", 80);
    expect(next).not.toBe(original);
    expect((next.children[0] as any).children[0].width).toBe(80);
    expect((original.children[0] as any).children[0].width).toBe(50);
  });

  it("removeNode returns the same document when nothing was removed", () => {
    const original = doc();
    expect(removeNode(original, "missing")).toBe(original);
  });

  it("removeNode returns a new document and leaves the original untouched", () => {
    const original = doc();
    const next = removeNode(original, "r1");
    expect(next).not.toBe(original);
    expect((next.children[0] as any).children.map((c: { id: string }) => c.id)).toEqual(["r2"]);
    expect((original.children[0] as any).children.map((c: { id: string }) => c.id)).toEqual(["r1", "r2"]);
  });

  it("reorderChild returns the same document for missing parent, invalid indices, or the same index", () => {
    const original = doc();
    expect(reorderChild(original, "missing", 0, 1)).toBe(original);
    expect(reorderChild(original, "f1", -1, 0)).toBe(original);
    expect(reorderChild(original, "f1", 0, 2)).toBe(original);
    expect(reorderChild(original, "f1", 0, 0)).toBe(original);
  });

  it("reorderChild returns a new document and leaves the original order untouched", () => {
    const original = doc();
    const next = reorderChild(original, "f1", 0, 1);
    expect(next).not.toBe(original);
    expect((next.children[0] as any).children.map((c: { id: string }) => c.id)).toEqual(["r2", "r1"]);
    expect((original.children[0] as any).children.map((c: { id: string }) => c.id)).toEqual(["r1", "r2"]);
  });

  it("replaceNode recursively generates IDs for all replacement descendants and produces audit findings with valid node IDs", () => {
    const original = doc();
    // Replacement node with nested children that lack `id`
    const replacement = {
      type: "frame",
      width: 390,
      height: 200,
      layout: "vertical",
      children: [
        {
          type: "frame",
          layout: "horizontal",
          children: [
            {
              type: "text",
              content: "Tiny unreadable label",
              fontSize: 6 // will trigger text_too_small audit
            }
          ]
        }
      ]
    } as any;

    const next = replaceNode(original, "r1", replacement);
    expect(next).not.toBe(original);

    // Recursively collect all descendant IDs in the replaced subtree
    const replaced = (next.children[0] as any).children.find((c: any) => c.children && c.children.length > 0);
    expect(replaced).toBeDefined();
    expect(typeof replaced.id).toBe("string");
    expect(replaced.id.length).toBeGreaterThan(0);

    const childFrame = replaced.children[0];
    expect(typeof childFrame.id).toBe("string");
    expect(childFrame.id.length).toBeGreaterThan(0);

    const textNode = childFrame.children[0];
    expect(typeof textNode.id).toBe("string");
    expect(textNode.id.length).toBeGreaterThan(0);

    // Ensure audit findings reference real, defined node IDs
    const findings = auditDocument(next);
    const textFindings = findings.filter((f) => f.rule === "text_too_small");
    expect(textFindings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.nodeId).toBeDefined();
      expect(f.nodeId).not.toBe("undefined");
      expect(typeof f.nodeId).toBe("string");
      expect(f.nodeId.length).toBeGreaterThan(0);
    }
  });
});
