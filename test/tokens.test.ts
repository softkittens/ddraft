import { describe, it, expect } from "bun:test";
import { makeDoc, frame, rect, txt } from "./harness";
import {
  documentSwatches,
  documentFonts,
  documentTypeScale,
  documentSpacingScale,
  documentColorsInUse,
  documentRadiusScale,
  PILL_RADIUS
} from "../src/model/tokens";
import { resolveStyle } from "../src/design/styleSystem";
import type { Document, FrameNode } from "../src/model/types";

const styled = (): Document => {
  const style = resolveStyle({
    palette: "Carbon Frost",
    roundness: "Basic",
    elevation: "Soft Lift",
    headings: "Inter",
    body: "Inter",
    captions: "Inter"
  });
  return { ...makeDoc(), variables: style.variables };
};

describe("The colours a document offers", () => {
  it("finds nothing on a document with no variables", () => {
    expect(documentSwatches(makeDoc())).toEqual([]);
  });

  it("lists the palette roles in reading order, surfaces before accents", () => {
    const names = documentSwatches(styled()).map((s) => s.name);
    expect(names.slice(0, 8)).toEqual([
      "surface-primary",
      "surface-secondary",
      "foreground-primary",
      "foreground-secondary",
      "foreground-muted",
      "border-subtle",
      "accent-primary",
      "accent-secondary"
    ]);
  });

  it("carries the token to write and the colour to paint the chip", () => {
    const accent = documentSwatches(styled()).find((s) => s.name === "accent-primary")!;
    // The token is what lands on the node; severing that link is what a raw
    // hex picker does.
    expect(accent.token).toBe("$accent-primary");
    expect(accent.value).toMatch(/^#/);
    expect(accent.label).toBe("Accent Primary");
    expect(accent.role).toBe("accent");
  });

  it("includes the derived status colours", () => {
    const roles = documentSwatches(styled()).filter((s) => s.role === "status").map((s) => s.name);
    expect(roles).toEqual(["status-ok", "status-warn", "status-fault"]);
  });

  it("keeps a colour the file invented, after the roles it knows", () => {
    const doc = styled();
    doc.variables!.brand = { type: "color", value: "#FF00AA" };
    const list = documentSwatches(doc);
    const brand = list.find((s) => s.name === "brand")!;
    expect(brand.value).toBe("#FF00AA");
    expect(brand.role).toBe("custom");
    expect(list.indexOf(brand)).toBeGreaterThan(list.findIndex((s) => s.name === "accent-primary"));
  });

  it("leaves out the fonts and anything else that is not a colour", () => {
    const names = documentSwatches(styled()).map((s) => s.name);
    expect(names).not.toContain("font-heading");
  });

  it("reads a file that stores variables as bare strings", () => {
    const doc: Document = { ...makeDoc(), variables: { "accent-primary": "#123456", spacing: "8px" } };
    const list = documentSwatches(doc);
    expect(list.map((s) => s.name)).toEqual(["accent-primary"]);
    expect(list[0].value).toBe("#123456");
  });
});

describe("The typefaces a document offers", () => {
  it("lists heading, body and caption in that order", () => {
    expect(documentFonts(styled()).map((f) => f.name)).toEqual([
      "font-heading",
      "font-body",
      "font-caption"
    ]);
  });

  it("carries the token, not the resolved family, for the write", () => {
    const heading = documentFonts(styled())[0];
    expect(heading.token).toBe("$font-heading");
    expect(heading.value).toBe("Inter");
  });

  it("finds nothing on an unstyled document", () => {
    expect(documentFonts(makeDoc())).toEqual([]);
  });
});

describe("The type scale in use", () => {
  const page = () => [
    frame("screen", 390, 844, [
      txt("h1", "Title", 32),
      txt("p", "Body", 16),
      txt("small", "Caption", 12),
      txt("dup", "Body again", 16),
      rect("box", 40, 40)
    ])
  ];

  it("lists each size once, largest first", () => {
    expect(documentTypeScale(page())).toEqual([32, 16, 12]);
  });

  it("ignores nodes that are not text", () => {
    const nodes = [frame("screen", 390, 844, [rect("box", 40, 40)])];
    expect(documentTypeScale(nodes)).toEqual([]);
  });

  it("reaches text nested at any depth", () => {
    const nodes = [
      frame("screen", 390, 844, [frame("card", 200, 100, [frame("row", 100, 40, [txt("deep", "x", 11)])])])
    ];
    expect(documentTypeScale(nodes)).toEqual([11]);
  });
});

describe("The spacing scale in use", () => {
  it("collects gaps and paddings together, smallest first", () => {
    const nodes = [
      frame("screen", 390, 844, [
        frame("card", 200, 100, [], { gap: 12, padding: 16 } as Partial<FrameNode>)
      ], { gap: 24, padding: 8 } as Partial<FrameNode>)
    ];
    expect(documentSpacingScale(nodes)).toEqual([8, 12, 16, 24]);
  });

  it("flattens the shorthand forms", () => {
    const nodes = [
      frame("a", 100, 100, [], { padding: [16, 24] } as Partial<FrameNode>),
      frame("b", 100, 100, [], { padding: [4, 8, 4, 8] } as Partial<FrameNode>)
    ];
    expect(documentSpacingScale(nodes)).toEqual([4, 8, 16, 24]);
  });

  it("drops zero, which is an absence rather than a step", () => {
    const nodes = [frame("a", 100, 100, [], { gap: 0, padding: 16 } as Partial<FrameNode>)];
    expect(documentSpacingScale(nodes)).toEqual([16]);
  });

  it("finds nothing on a page that sets no spacing", () => {
    expect(documentSpacingScale([rect("box", 40, 40)])).toEqual([]);
  });
});

describe("The colours a document already paints with", () => {
  const page = () => [
    frame("screen", 390, 844, [
      txt("a", "One", 14, { fill: "#111111" } as any),
      txt("b", "Two", 14, { fill: "#111111" } as any),
      rect("box", 40, 40, { fill: "#FF00AA", stroke: "#111111" }),
      rect("edge", 40, 40, { fill: { type: "color", color: "#00FF88" } })
    ], { fill: "#FFFFFF" } as Partial<FrameNode>)
  ];

  it("orders them by how much of the page they cover", () => {
    // #111111 is on two labels and a stroke; everything else appears once.
    expect(documentColorsInUse(page()).map((s) => s.value)).toEqual([
      "#111111",
      "#ffffff",
      "#ff00aa",
      "#00ff88"
    ]);
  });

  it("reads the object form of a fill as well as the string", () => {
    expect(documentColorsInUse(page()).map((s) => s.value)).toContain("#00ff88");
  });

  it("leaves out gradients and images, which have no one colour", () => {
    const nodes = [
      rect("g", 40, 40, { fill: { type: "gradient", stops: [{ offset: 0, color: "#FFF" }] } }),
      rect("i", 40, 40, { fill: { type: "image", url: "photo.png" } }),
      rect("c", 40, 40, { fill: "#123456" })
    ];
    expect(documentColorsInUse(nodes).map((s) => s.value)).toEqual(["#123456"]);
  });

  it("leaves out tokens, which the swatch list already covers", () => {
    const nodes = [rect("a", 40, 40, { fill: "$accent-primary" }), rect("b", 40, 40, { fill: "#123456" })];
    expect(documentColorsInUse(nodes).map((s) => s.value)).toEqual(["#123456"]);
  });

  it("writes the literal colour, since there is no token to point at", () => {
    const one = documentColorsInUse([rect("a", 40, 40, { fill: "#123456" })])[0];
    expect(one.token).toBe("#123456");
    expect(one.label).toBe("#123456".toUpperCase());
  });

  it("stops at a row a person can scan", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      rect(`r${i}`, 10, 10, { fill: `#${i.toString(16).padStart(6, "0")}` })
    );
    expect(documentColorsInUse(many)).toHaveLength(12);
    expect(documentColorsInUse(many, 4)).toHaveLength(4);
  });

  it("finds nothing on a page that paints nothing", () => {
    expect(documentColorsInUse([rect("a", 40, 40)])).toEqual([]);
  });
});

describe("The corner radii in use", () => {
  it("lists each one once, smallest first", () => {
    const nodes = [
      frame("screen", 390, 844, [
        rect("a", 40, 40, { cornerRadius: 12 }),
        rect("b", 40, 40, { cornerRadius: 4 }),
        rect("c", 40, 40, { cornerRadius: 12 })
      ])
    ];
    expect(documentRadiusScale(nodes)).toEqual([4, 12]);
  });

  it("flattens a per-corner radius", () => {
    const nodes = [rect("a", 40, 40, { cornerRadius: [8, 8, 0, 16] })];
    expect(documentRadiusScale(nodes)).toEqual([8, 16]);
  });

  it("leaves out zero and the pill, which the control always offers anyway", () => {
    const nodes = [
      rect("a", 40, 40, { cornerRadius: 0 }),
      rect("b", 40, 40, { cornerRadius: PILL_RADIUS }),
      rect("c", 40, 40, { cornerRadius: 10 })
    ];
    expect(documentRadiusScale(nodes)).toEqual([10]);
  });

  it("finds nothing on a page with square corners", () => {
    expect(documentRadiusScale([rect("a", 40, 40)])).toEqual([]);
  });
});
