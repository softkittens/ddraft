import { describe, it, expect, afterEach } from "bun:test";
import {
  resolveExportTarget,
  exportFilename,
  exportSelectedFrame
} from "../src/render/exportImage";
import { makeDoc, frame, rect, createMockCanvas } from "./harness";
import type { GroupNode } from "../src/model/types";

const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: originalDocument
  });
});

function group(id: string, children: GroupNode["children"] = [], props: Partial<GroupNode> = {}): GroupNode {
  return { type: "group", id, children, ...props };
}

describe("Which frame Share exports", () => {
  it("is nothing when nothing is selected", () => {
    const doc = makeDoc(frame("home", 390, 844, [], { name: "Home" }));
    expect(resolveExportTarget(doc, [])).toBeNull();
  });

  it("is the selected frame", () => {
    const home = frame("home", 390, 844, [], { name: "Home" });
    const doc = makeDoc(home, frame("about", 390, 844, [], { name: "About" }));
    expect(resolveExportTarget(doc, ["about"])).toEqual(doc.children[1]);
  });

  it("walks up to the enclosing frame when a child is selected", () => {
    const card = frame("card", 200, 80, [rect("title")], { name: "Card" });
    const home = frame("home", 390, 844, [card], { name: "Home" });
    const doc = makeDoc(home);
    expect(resolveExportTarget(doc, ["title"])?.id).toBe("card");
  });

  it("prefers a selected nested frame over its parent screen", () => {
    const card = frame("card", 200, 80, [], { name: "Card" });
    const doc = makeDoc(frame("home", 390, 844, [card], { name: "Home" }));
    expect(resolveExportTarget(doc, ["card"])?.id).toBe("card");
  });

  it("walks through groups to the enclosing frame", () => {
    const doc = makeDoc(
      frame("home", 390, 844, [group("cluster", [rect("dot")])], { name: "Home" })
    );
    expect(resolveExportTarget(doc, ["dot"])?.id).toBe("home");
  });

  it("falls back to the selected node when it has no enclosing frame", () => {
    const lone = rect("orphan", 40, 40, { name: "Orphan" });
    const doc = makeDoc(lone);
    expect(resolveExportTarget(doc, ["orphan"])?.id).toBe("orphan");
  });
});

describe("Export filenames", () => {
  it("uses the layer name and the format", () => {
    expect(exportFilename("Home", "png")).toBe("Home.png");
    expect(exportFilename("Home", "jpg")).toBe("Home.jpg");
  });

  it("appends @2x and @3x the way Figma names retina exports", () => {
    expect(exportFilename("Home", "png", 2)).toBe("Home@2x.png");
    expect(exportFilename("Home", "jpg", 3)).toBe("Home@3x.jpg");
    expect(exportFilename("Home", "png", 1)).toBe("Home.png");
  });

  it("falls back to Frame when the layer has no name", () => {
    expect(exportFilename(undefined, "png")).toBe("Frame.png");
    expect(exportFilename("   ", "jpg")).toBe("Frame.jpg");
  });

  it("strips characters that would become path segments", () => {
    expect(exportFilename("Nav / Home", "png")).toBe("Nav - Home.png");
  });
});

describe("Exporting a selected frame", () => {
  it("returns unavailable without a canvas", async () => {
    const result = await exportSelectedFrame(makeDoc(frame("f", 40, 40)), ["f"], "png");
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns no_target when nothing selected can be exported", async () => {
    installCanvas();
    const result = await exportSelectedFrame(makeDoc(frame("f", 40, 40)), [], "png");
    expect(result).toEqual({ ok: false, reason: "no_target" });
  });

  it("exports PNG at the frame's 1x size with a transparent canvas", async () => {
    const { canvases, calls } = installCanvas();
    const result = await exportSelectedFrame(
      makeDoc(frame("home", 390, 844, [], { name: "Home" })),
      ["home"],
      "png"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("Home.png");
    expect(result.mime).toBe("image/png");
    expect(result.width).toBe(390);
    expect(result.height).toBe(844);
    expect(result.dataUrl.startsWith("data:image/png")).toBe(true);
    expect(canvases[0]?.type).toBe("image/png");
    expect(calls.some((c) => c.startsWith("fillRect"))).toBe(false);
  });

  it("exports JPG at 1x composited on white", async () => {
    const { canvases, calls } = installCanvas();
    const result = await exportSelectedFrame(
      makeDoc(frame("home", 390, 844, [], { name: "Home" })),
      ["home"],
      "jpg"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("Home.jpg");
    expect(result.mime).toBe("image/jpeg");
    expect(result.dataUrl.startsWith("data:image/jpeg")).toBe(true);
    expect(canvases[0]?.type).toBe("image/jpeg");
    expect(calls.some((c) => c.includes("#ffffff") || c.includes("#FFFFFF") || c === "fillStyle=#ffffff")).toBe(
      true
    );
    expect(calls.some((c) => c.startsWith("fillRect"))).toBe(true);
  });

  it("exports 2x at double the frame's layout size", async () => {
    const { canvases } = installCanvas();
    const result = await exportSelectedFrame(
      makeDoc(frame("home", 390, 844, [], { name: "Home" })),
      ["home"],
      "png",
      2
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe("Home@2x.png");
    expect(result.width).toBe(780);
    expect(result.height).toBe(1688);
    expect(canvases[0]?.width).toBe(780);
    expect(canvases[0]?.height).toBe(1688);
  });
});

function installCanvas() {
  const { ctx, calls } = createMockCanvas();
  const canvases: { width: number; height: number; type?: string }[] = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ctx,
          toDataURL: (type?: string) => {
            canvases.push({ width: canvas.width, height: canvas.height, type: type ?? "image/png" });
            return (type ?? "image/png").includes("jpeg")
              ? "data:image/jpeg;base64,xx"
              : "data:image/png;base64,xx";
          }
        };
        return canvas;
      },
      fonts: { ready: Promise.resolve() }
    }
  });
  return { canvases, calls, ctx };
}
