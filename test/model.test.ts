import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDocument, parseSizing } from "../src/model/parse";
import { layoutDocument } from "../src/layout/layout";
import { setProperty, insertChild, removeNode, moveNode, duplicateNode } from "../src/model/edit";
import { resolveInstances, resolveInstancesWithDiagnostics } from "../src/model/instance";
import { computeBlastRadius, computeEditLocality } from "../src/design/metrics";
import { extractDigest } from "../src/digest/digest";


import { extract, distance, createMoodboard, addMoodboardItem } from "../src/design/style";
import { evaluateLayoutConstraints, evaluateB } from "../src/design/evaluator";
import { makeDoc, frame, rect, txt } from "./harness";

describe("Model & Design Subsystem", () => {
  const fileA = readFileSync(join(import.meta.dir, "../fixtures/A_control_r1.pen"), "utf-8");
  const docA = parseDocument(fileA);
  const treeA = layoutDocument(docA);

  it("parses documents and sizing expressions", () => {
    expect(docA.version).toBe("2.17");
    expect(docA.children.length).toBeGreaterThan(0);
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

    const parsed = parseDocument(extendedPen);
    expect(parsed.children.length).toBe(1);
    expect((parsed.children[0] as any).fill.type).toBe("image");
    expect((parsed.children[0] as any).fill.url).toBe("https://cdn.example.com/asset.png");
    expect((parsed.children[0] as any).children[0].textAlign).toBe("center");
    expect((parsed.children[0] as any).children[1].innerRadius).toBe(0.6);
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


    // 5. Blast radius and edit locality calculations
    const locality = computeEditLocality(doc, mod);
    expect(locality).toBe(1.0);
    const blast = computeBlastRadius(doc, mod, "r1");
    expect(blast).toBeGreaterThanOrEqual(0);
  });



  it("generates concise document digest (<15% token budget)", () => {
    const digestA = extractDigest(docA);
    const rawTokens = fileA.length / 4;
    const digestTokens = digestA.length / 4;
    expect(digestTokens / rawTokens).toBeLessThan(0.15);
    expect(digestA).toContain(docA.children[0].id);
  });

  it("extracts style records and computes taste distances", () => {
    const recordA = extract(treeA, docA, "dashboard");
    expect(recordA.gapOverPadding.mean).toBeGreaterThan(0.2);
    expect(recordA.spacingSteps.length).toBeGreaterThan(5);
    expect(distance(recordA, recordA)).toBe(0);

    const mb = addMoodboardItem(createMoodboard("My Board"), recordA, true);
    expect(mb.items.length).toBe(1);
    expect(mb.items[0].liked).toBe(true);
  });

  it("evaluates layout constraints and Evaluator B metrics", () => {
    const findings = evaluateLayoutConstraints(treeA, docA);
    expect(findings).toEqual([]);

    const badDoc = makeDoc(frame("canvas", 200, 200, [
      rect("r1", 50, 50, { x: 10, y: 10 } as any),
      rect("r2", 50, 50, { x: 20, y: 20 } as any),
      txt("t1", "Tiny", 6)
    ], { layout: "none" }));
    const badTree = layoutDocument(badDoc);
    const badFindings = evaluateLayoutConstraints(badTree, badDoc);
    expect(badFindings.some((f) => f.rule === "collision")).toBe(true);
    expect(badFindings.some((f) => f.rule === "unreadable_size")).toBe(true);

    const metricsB = evaluateB(treeA, docA);
    expect(metricsB.deadSpaceRatio).toBeGreaterThanOrEqual(0);
    expect(metricsB.contrastRatioMin).toBeGreaterThan(0);
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
});
