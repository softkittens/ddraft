import { describe, it, expect, afterEach } from "bun:test";
import { captureDocumentPng } from "../src/render/capture";
import { paintNode } from "../src/render/paint";
import { makeDoc, frame, rect, createMockCanvas } from "./harness";

const originalImage = globalThis.Image;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.Image = originalImage;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: originalDocument
  });
});

describe("browser capture", () => {
  it("returns unavailable without a canvas", async () => {
    const result = await captureDocumentPng(makeDoc(frame("f", 100, 100)));
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns no_target for an empty document", async () => {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ({
            scale() {},
            translate() {},
            beginPath() {},
            rect() {},
            clip() {}
          }),
          toDataURL: () => "data:image/png;base64,xx"
        }),
        fonts: { ready: Promise.resolve() }
      }
    });
    expect(await captureDocumentPng(makeDoc())).toEqual({ ok: false, reason: "no_target" });
  });

  it("paints token fills using document variables", async () => {
    const { ctx, calls } = createMockCanvas();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ctx,
          toDataURL: () => "data:image/png;base64,xx"
        }),
        fonts: { ready: Promise.resolve() }
      }
    });
    const doc = makeDoc(frame("f", 40, 40, [], { fill: "$surface-primary" }));
    doc.variables = { "surface-primary": { type: "color", value: "#aabbcc" } };
    const result = await captureDocumentPng(doc);
    expect(result.ok).toBe(true);
    expect(calls.some((c) => c.includes("#aabbcc"))).toBe(true);
    expect(calls.some((c) => c.includes("$surface-primary"))).toBe(false);
  });

  it("waits for document images before painting", async () => {
    let waited = false;
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      complete = false;
      naturalWidth = 0;
      crossOrigin = "";
      addEventListener(type: string, fn: () => void) {
        if (type === "load") this.onload = fn;
        if (type === "error") this.onerror = fn;
      }
      set src(_url: string) {
        waited = true;
        this.complete = true;
        this.naturalWidth = 1;
        queueMicrotask(() => this.onload?.());
      }
    }
    (globalThis as unknown as { Image: unknown }).Image = FakeImage;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      writable: true,
      value: {
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => null,
          toDataURL: () => "data:image/png;base64,xx"
        }),
        fonts: { ready: Promise.resolve() }
      }
    });

    const result = await captureDocumentPng(makeDoc(frame("f", 40, 40, [], {
      fill: { type: "image", url: "https://example.com/a.png" }
    })));
    expect(waited).toBe(true);
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("paintNode effects", () => {
  it("paints an icon from its stored geometry rather than the fallback glyph", () => {
    // The other half of the icon fix: tools store geometry, and this is what
    // proves the painter reaches for it. Without it every non-core icon drew
    // ICON_PATH — the layers glyph — whatever the model asked for.
    const drawn: string[] = [];
    (globalThis as { Path2D?: unknown }).Path2D = class {
      constructor(d: string) { drawn.push(d); }
    };
    try {
      const { ctx } = createMockCanvas();
      const node = {
        type: "icon", id: "bm", icon: "bookmark",
        geometry: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
      };
      paintNode(
        ctx,
        { id: "bm", type: "icon", box: { x: 0, y: 0, width: 22, height: 22 }, children: [] },
        new Map([["bm", node as never]])
      );
      expect(drawn).toEqual(["M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"]);
    } finally {
      delete (globalThis as { Path2D?: unknown }).Path2D;
    }
  });

  it("cover-crops image fills instead of stretching them", () => {
    class WideImage {
      complete = true;
      naturalWidth = 200;
      naturalHeight = 100;
      crossOrigin = "";
      set src(_url: string) {}
    }
    (globalThis as unknown as { Image: unknown }).Image = WideImage;
    const { ctx, calls } = createMockCanvas();
    const node = rect("photo", 100, 100, {
      fill: { type: "image", url: "https://example.com/wide-cover-test.png" }
    });

    paintNode(ctx, {
      id: "photo",
      type: "rectangle",
      box: { x: 0, y: 0, width: 100, height: 100 },
      children: []
    }, new Map([["photo", node]]));

    expect(calls.find((call) => call.startsWith("drawImage:"))).toEndWith(",50,0,100,100,0,0,100,100");
  });

  it("applies a singular shadow effect", () => {
    const { ctx, calls } = createMockCanvas();
    const node = rect("r", 40, 40, {
      effect: { type: "shadow", color: "#00000029", x: 0, y: 4, blur: 8, spread: 0, enabled: true }
    });
    paintNode(ctx, {
      id: "r",
      type: "rectangle",
      box: { x: 0, y: 0, width: 40, height: 40 },
      children: []
    }, new Map([["r", node]]));
    expect(calls).toContain("shadowOffsetY=4");
    expect(calls).toContain("shadowBlur=8");
    expect(calls).toContain("shadowColor=#00000029");
  });
});
