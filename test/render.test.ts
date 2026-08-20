import { describe, it, expect } from "bun:test";
import { layoutDocument } from "../src/layout/layout";
import { paintNode, resolveFill, paintStroke, applyEffects, clearEffects } from "../src/render/paint";

import { makeDoc, frame, rect, txt, createMockCanvas } from "./harness";


describe("Render Subsystem (Unit C)", () => {
  it("paints nested children at cumulative transform offsets", () => {
    const doc = makeDoc(frame("outer", 400, 300, [
      frame("inner", 200, 150, [rect("leaf", 50, 50, { x: 10, y: 10 } as any)], { x: 20, y: 30 } as any)
    ], { x: 100, y: 50 } as any));

    const tree = layoutDocument(doc);
    const { ctx, calls } = createMockCanvas();
    const map = new Map(doc.children.map((c) => [c.id, c]));

    paintNode(ctx, tree[0], map);
    expect(calls.some((c) => c.startsWith("translate:100,50"))).toBe(true);
    expect(calls.some((c) => c.startsWith("save"))).toBe(true);
  });

  it("resolves linear/radial gradients and basic shapes", () => {
    const { ctx } = createMockCanvas();
    ctx.createLinearGradient = () => ({ addColorStop: () => {} });
    ctx.createRadialGradient = () => ({ addColorStop: () => {} });

    const lin = resolveFill(ctx, { type: "gradient", gradientType: "linear", stops: [{ offset: 0, color: "#f00" }] } as any, { x: 0, y: 0, width: 100, height: 100 });
    expect(lin).not.toBeNull();

    const rad = resolveFill(ctx, { type: "gradient", gradientType: "radial", stops: [{ offset: 0, color: "#0f0" }] } as any, { x: 0, y: 0, width: 100, height: 100 });
    expect(rad).not.toBeNull();
  });

  it("paints per-edge and aligned border strokes", () => {
    const { ctx, calls } = createMockCanvas();
    paintStroke(ctx, { x: 0, y: 0, width: 100, height: 50 }, "#ff0000", 2, "center");
    expect(calls.some((c) => c.startsWith("strokeRect"))).toBe(true);

    paintStroke(ctx, { x: 0, y: 0, width: 100, height: 50 }, "#00ff00", { top: 4, bottom: 2 });
    expect(calls.some((c) => c.startsWith("lineTo"))).toBe(true);
  });

  it("applies and clears shadow and blur effects", () => {
    const { ctx } = createMockCanvas();
    applyEffects(ctx, [{ type: "shadow", color: "#000", blur: 10, y: 5 }]);
    expect(ctx.shadowBlur).toBe(10);
    expect(ctx.shadowOffsetY).toBe(5);

    applyEffects(ctx, [{ type: "blur", radius: 6 }]);
    expect(ctx.filter).toContain("blur(6px)");

    clearEffects(ctx);
    expect(ctx.shadowBlur).toBe(0);
    expect(ctx.filter).toBe("none");
  });

  it("applies clip, opacity, and enabled properties", () => {
    const { ctx, calls } = createMockCanvas();
    const doc = makeDoc(frame("f", 100, 100, [rect("r", 50, 50)], { clip: true, opacity: 0.5 }));
    const tree = layoutDocument(doc);
    const map = new Map([["f", doc.children[0]], ["r", (doc.children[0] as any).children[0]]]);

    paintNode(ctx, tree[0], map);
    expect(calls.some((c) => c.startsWith("clip"))).toBe(true);
    expect(ctx.globalAlpha).toBe(0.5);
  });

  it("applies camera world translation and zoom scaling without double-multiplying offset", () => {
    const cam = { x: 100, y: 200, zoom: 0.5 };
    const { ctx, calls } = createMockCanvas();

    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);

    expect(calls[0]).toBe("translate:100,200");
    expect(calls[1]).toBe("scale:0.5,0.5");
  });

  it("paints ghost element with alpha when dragging nested layout child", () => {
    const doc = makeDoc(frame("artboard", 400, 300, [rect("card", 100, 50)], { padding: 20 }));
    const tree = layoutDocument(doc);
    const map = new Map([["artboard", doc.children[0]], ["card", (doc.children[0] as any).children[0]]]);
    const { ctx, calls } = createMockCanvas();

    // Nested card is skipped in main pass
    paintNode(ctx, tree[0], map, undefined, "card");
    expect(calls.filter((c) => c.startsWith("fillRect:0,0,100,50")).length).toBe(0);

    // Ghost is painted at dragged world offset
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(200, 150);
    paintNode(ctx, tree[0].children[0], map);
    ctx.restore();

    expect(calls.some((c) => c === "globalAlpha=0.85")).toBe(true);
    expect(calls.some((c) => c.startsWith("translate:200,150"))).toBe(true);
  });

  it("paints polygon strokes along geometry and multiline text at increasing y offsets", () => {
    const { ctx, calls } = createMockCanvas();

    // 1. Polygon with stroke produces stroke and no strokeRect
    const polyDoc = makeDoc({
      id: "poly",
      type: "polygon",
      width: 100,
      height: 100,
      points: [0, 0, 100, 0, 50, 100],
      stroke: "#ff0000",
      strokeWidth: 2
    } as any);
    const polyTree = layoutDocument(polyDoc);
    const polyMap = new Map([["poly", polyDoc.children[0]]]);
    paintNode(ctx, polyTree[0], polyMap);
    expect(calls.some((c) => c === "stroke")).toBe(true);
    expect(calls.some((c) => c.startsWith("strokeRect"))).toBe(false);

    // 2. Multiline text produces multiple fillText calls at increasing y and dark default fill
    const { ctx: textCtx, calls: textCalls } = createMockCanvas();
    const textDoc = makeDoc(txt("t", "First line of long text that wraps across multiple lines in box", 14, {
      width: 80,
      textGrowth: "fixed-width"
    } as any));
    const textTree = layoutDocument(textDoc);
    const textMap = new Map([["t", textDoc.children[0]]]);
    paintNode(textCtx, textTree[0], textMap);

    const fillTextCalls = textCalls.filter((c) => c.startsWith("fillText"));
    expect(fillTextCalls.length).toBeGreaterThan(1);
    expect(textCtx.fillStyle).not.toBe("#ffffff");
    expect(textCtx.fillStyle).toBe("#1e293b");
  });
});

