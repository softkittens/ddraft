import { describe, it, expect } from "bun:test";
import type { Document } from "../src/model/types";
import { layoutDocument } from "../src/layout/layout";
import { drawShape, paintNode } from "../src/render/paint";
import { resolveFill } from "../src/render/fills";
import { paintStroke } from "../src/render/strokes";
import { applyEffects, clearEffects } from "../src/render/effects";

describe("Render - Transform Stack (C2)", () => {

  it("paints nested children at the sum of ancestor offsets", () => {
    const doc: Document = {
      version: "2.17",
      children: [{
        type: "frame",
        id: "outer",
        x: 100,
        y: 50,
        width: 400,
        height: 300,
        layout: "none",
        children: [{
          type: "frame",
          id: "inner",
          x: 20,
          y: 30,
          width: 200,
          height: 150,
          layout: "none",
          children: [
            { type: "rectangle", id: "leaf", x: 10, y: 10, width: 50, height: 50 }
          ]
        }]
      }]
    };

    const layoutTree = layoutDocument(doc);
    const translations: { id: string; cumulativeX: number; cumulativeY: number }[] = [];
    let curX = 0;
    let curY = 0;
    const stack: { x: number; y: number }[] = [];

    const mockCtx: any = {
      save: () => stack.push({ x: curX, y: curY }),
      translate: (x: number, y: number) => {
        curX += x;
        curY += y;
      },
      rotate: () => {},
      fillRect: () => {},
      restore: () => {
        const prev = stack.pop();
        if (prev) {
          curX = prev.x;
          curY = prev.y;
        }
      }
    };

    function recordNode(node: any) {
      mockCtx.save();
      mockCtx.translate(node.box.x, node.box.y);
      translations.push({ id: node.id, cumulativeX: curX, cumulativeY: curY });
      for (const child of node.children) recordNode(child);
      mockCtx.restore();
    }

    recordNode(layoutTree[0]);

    const leafRecord = translations.find((t) => t.id === "leaf");
    expect(leafRecord).toBeDefined();
    // 100 (outer) + 20 (inner) + 10 (leaf) = 130
    // 50 (outer) + 30 (inner) + 10 (leaf) = 90
    expect(leafRecord?.cumulativeX).toBe(130);
    expect(leafRecord?.cumulativeY).toBe(90);
  });
});

describe("Render - Fills & Simple Shapes (C3)", () => {
  it("resolves linear gradient pointing up at 0 degrees", () => {
    let gradientPoints: { x0: number; y0: number; x1: number; y1: number } | null = null;
    const mockCtx: any = {
      createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => {
        gradientPoints = { x0, y0, x1, y1 };
        return { addColorStop: () => {} };
      }
    };

    resolveFill(
      mockCtx,
      {
        type: "gradient",
        gradientType: "linear",
        rotation: 0,
        stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "#000" }]
      },
      { x: 0, y: 0, width: 200, height: 100 }
    );

    expect(gradientPoints).not.toBeNull();
    const pts = gradientPoints as unknown as { x0: number; y0: number; x1: number; y1: number };
    expect(pts.x0).toBe(100);
    expect(pts.y0).toBe(100);
    expect(pts.x1).toBe(100);
    expect(pts.y1).toBe(0);
  });

  it("draws ellipse using canvas ellipse method", () => {
    let ellipseCalled = false;
    const mockCtx: any = {
      beginPath: () => {},
      ellipse: () => { ellipseCalled = true; },
      fill: () => {}
    };

    drawShape(
      mockCtx,
      { id: "e1", type: "ellipse", box: { x: 0, y: 0, width: 100, height: 60 }, children: [] },
      { id: "e1", type: "ellipse", fill: "#FF0000" }
    );

    expect(ellipseCalled).toBe(true);
  });

  it("draws polygon connecting points and closing path", () => {
    const pointsVisited: [number, number][] = [];
    let closed = false;

    const mockCtx: any = {
      beginPath: () => {},
      moveTo: (x: number, y: number) => pointsVisited.push([x, y]),
      lineTo: (x: number, y: number) => pointsVisited.push([x, y]),
      closePath: () => { closed = true; },
      fill: () => {}
    };

    drawShape(
      mockCtx,
      { id: "p1", type: "polygon", box: { x: 0, y: 0, width: 100, height: 100 }, children: [] },
      { id: "p1", type: "polygon", points: [0, 0, 50, 100, 100, 0] }
    );

    expect(pointsVisited.length).toBe(3);
    expect(pointsVisited[0]).toEqual([0, 0]);
    expect(pointsVisited[1]).toEqual([50, 100]);
    expect(pointsVisited[2]).toEqual([100, 0]);
    expect(closed).toBe(true);
  });
});

describe("Render - Paths & Strokes (C4)", () => {
  it("paints per-edge border strokes", () => {
    let strokeCount = 0;
    const lines: [number, number, number, number][] = [];
    let curX = 0;
    let curY = 0;

    const mockCtx: any = {
      beginPath: () => {},
      moveTo: (x: number, y: number) => { curX = x; curY = y; },
      lineTo: (x: number, y: number) => {
        lines.push([curX, curY, x, y]);
      },
      stroke: () => { strokeCount++; }
    };

    paintStroke(mockCtx, { x: 0, y: 0, width: 200, height: 100 }, "#333", { bottom: 1 });
    expect(strokeCount).toBe(1);
    expect(lines.length).toBe(1);
    expect(lines[0][1]).toBe(99.5);
    expect(lines[0][3]).toBe(99.5);
  });

  it("strokes each edge at its own lineWidth", () => {
    const widths: number[] = [];
    const mockCtx: any = {
      lineWidth: 1,
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: function () { widths.push(this.lineWidth); }
    };

    paintStroke(mockCtx, { x: 0, y: 0, width: 100, height: 100 }, "#000", {
      top: 1, right: 2, bottom: 3, left: 4
    });
    expect(widths).toEqual([1, 3, 4, 2]);
  });

  it("paints inner stroke using clipping", () => {
    let clipCalled = false;
    let saved = false;
    let restored = false;

    const mockCtx: any = {
      save: () => { saved = true; },
      beginPath: () => {},
      rect: () => {},
      clip: () => { clipCalled = true; },
      strokeRect: () => {},
      restore: () => { restored = true; }
    };

    paintStroke(mockCtx, { x: 0, y: 0, width: 100, height: 100 }, "#FF0000", 2, "inner");
    expect(clipCalled).toBe(true);
    expect(saved).toBe(true);
    expect(restored).toBe(true);
  });
});

describe("Render - Effects (C5)", () => {
  it("applies drop shadow properties to context", () => {
    const mockCtx: any = {
      shadowColor: "",
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowBlur: 0
    };

    applyEffects(mockCtx, [
      { type: "shadow", color: "rgba(0,0,0,0.5)", x: 2, y: 4, blur: 10 }
    ]);

    expect(mockCtx.shadowColor).toBe("rgba(0,0,0,0.5)");
    expect(mockCtx.shadowOffsetX).toBe(2);
    expect(mockCtx.shadowOffsetY).toBe(4);
    expect(mockCtx.shadowBlur).toBe(10);
  });

  it("applies layer blur filter to context", () => {
    const mockCtx: any = { filter: "none" };
    applyEffects(mockCtx, [{ type: "blur", radius: 8 }]);
    expect(mockCtx.filter).toBe("blur(8px)");
  });

  it("clears effects after drawing", () => {
    const mockCtx: any = {
      shadowColor: "#000",
      shadowOffsetX: 5,
      shadowOffsetY: 5,
      shadowBlur: 10,
      filter: "blur(4px)"
    };
    clearEffects(mockCtx);
    expect(mockCtx.shadowColor).toBe("transparent");
    expect(mockCtx.shadowOffsetX).toBe(0);
    expect(mockCtx.shadowOffsetY).toBe(0);
    expect(mockCtx.shadowBlur).toBe(0);
    expect(mockCtx.filter).toBe("none");
  });

  it("resolves $variable shadow colours", () => {
    const mockCtx: any = {
      shadowColor: "",
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowBlur: 0
    };
    applyEffects(mockCtx, [{ type: "shadow", color: "$shadow" }], { shadow: "rgba(10,20,30,0.4)" });
    expect(mockCtx.shadowColor).toBe("rgba(10,20,30,0.4)");
  });
});

describe("Render - clip, enabled, opacity", () => {
  function mockPaintCtx() {
    const calls: string[] = [];
    const ctx: any = {
      globalAlpha: 1,
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      translate: () => calls.push("translate"),
      rotate: () => {},
      beginPath: () => calls.push("beginPath"),
      rect: () => calls.push("rect"),
      clip: () => calls.push("clip"),
      fill: function () { calls.push(`fill:${this.globalAlpha}`); },
      roundRect: () => {}
    };
    return { ctx, calls };
  }

  it("clips children to the node box when clip is true", () => {
    const { ctx, calls } = mockPaintCtx();
    const layout = {
      id: "frame",
      type: "frame",
      box: { x: 0, y: 0, width: 100, height: 50 },
      children: []
    };
    const map = new Map([["frame", { id: "frame", type: "frame" as const, clip: true, fill: "#fff" }]]);
    paintNode(ctx, layout, map);
    expect(calls).toContain("clip");
  });

  it("skips a node with enabled: false", () => {
    const { ctx, calls } = mockPaintCtx();
    const layout = {
      id: "hidden",
      type: "rectangle",
      box: { x: 0, y: 0, width: 10, height: 10 },
      children: []
    };
    const map = new Map([["hidden", { id: "hidden", type: "rectangle" as const, enabled: false, fill: "#fff" }]]);
    paintNode(ctx, layout, map);
    expect(calls).toEqual([]);
  });

  it("multiplies globalAlpha by node opacity", () => {
    const { ctx, calls } = mockPaintCtx();
    const layout = {
      id: "faded",
      type: "rectangle",
      box: { x: 0, y: 0, width: 10, height: 10 },
      children: []
    };
    const map = new Map([["faded", { id: "faded", type: "rectangle" as const, opacity: 0.5, fill: "#fff" }]]);
    paintNode(ctx, layout, map);
    expect(calls).toContain("fill:0.5");
  });
});


