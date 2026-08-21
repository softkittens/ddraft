import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeDoc } from "./harness";
import { contrastRatio } from "../src/design/evaluator";
import {
  PALETTES,
  resolveStyle,
  currentStyle,
  styleGuidelines,
  StyleChoiceError,
  DIRECTION_METADATA_KEY,
  STYLE_METADATA_KEY,
  FONT_FAMILIES,
  ELEVATION,
  styleCatalog,
  PALETTE_HAND_SIZE,
  dealTypefaces
} from "../src/design/styleSystem";
import { effectSchema } from "../src/model/parse";
import { agentSystemPrompt } from "../src/agent/prompt";
import { createDocumentTools } from "../src/agent/tools";

describe("Style system", () => {
  it("deals a hand of palettes instead of printing the whole catalog", () => {
    const catalog = styleCatalog(12345);
    const offered = PALETTES.filter((p) => catalog.includes(`  ${p.name} (`));
    expect(offered).toHaveLength(PALETTE_HAND_SIZE);
    expect(PALETTES.length).toBeGreaterThan(PALETTE_HAND_SIZE * 3);
  });

  it("puts both light and dark on the table in every hand", () => {
    for (const seed of [1, 2, 7, 99, 1234, -5000]) {
      const catalog = styleCatalog(seed);
      const offered = PALETTES.filter((p) => catalog.includes(`  ${p.name} (`));
      expect(offered.some((p) => p.scheme === "dark")).toBe(true);
      expect(offered.some((p) => p.scheme === "light")).toBe(true);
    }
  });

  it("deals the same hand for one seed and different hands across seeds", () => {
    expect(styleCatalog(42)).toBe(styleCatalog(42));
    const hands = new Set([1, 2, 3, 4, 5, 6].map((seed) => styleCatalog(seed)));
    expect(hands.size).toBeGreaterThan(4);
  });

  it("gives two different briefs two different palette hands", () => {
    const doc = makeDoc();
    const cats = agentSystemPrompt(doc, [], undefined, 101);
    const bank = agentSystemPrompt(doc, [], undefined, 202);
    expect(cats).not.toBe(bank);
  });

  it("every palette clears its contrast requirements", () => {
    for (const p of PALETTES) {
      const t = p.tokens;
      const pairs: [string, number, number][] = [
        ["foreground-primary on surface-primary", contrastRatio(t["foreground-primary"], t["surface-primary"])!, 7],
        ["foreground-primary on surface-secondary", contrastRatio(t["foreground-primary"], t["surface-secondary"])!, 7],
        ["foreground-secondary on surface-primary", contrastRatio(t["foreground-secondary"], t["surface-primary"])!, 4.5],
        ["foreground-secondary on surface-secondary", contrastRatio(t["foreground-secondary"], t["surface-secondary"])!, 4.5],
        ["foreground-muted on surface-primary", contrastRatio(t["foreground-muted"], t["surface-primary"])!, 3],
        ["foreground-muted on surface-secondary", contrastRatio(t["foreground-muted"], t["surface-secondary"])!, 3],
        ["accent-primary on surface-primary", contrastRatio(t["accent-primary"], t["surface-primary"])!, 3],
        ["accent-primary on surface-secondary", contrastRatio(t["accent-primary"], t["surface-secondary"])!, 3],
        ["accent-secondary on surface-primary", contrastRatio(t["accent-secondary"], t["surface-primary"])!, 3]
      ];
      for (const [label, ratio, required] of pairs) {
        expect(`${p.name} ${label} ${ratio.toFixed(2)}`).toBe(
          `${p.name} ${label} ${Math.max(ratio, required).toFixed(2)}`
        );
      }
      const onAccent = Math.max(
        contrastRatio("#FFFFFF", t["accent-primary"])!,
        contrastRatio("#000000", t["accent-primary"])!
      );
      expect(onAccent).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("rejects a name that is not in the catalog instead of substituting one", () => {
    expect(() =>
      resolveStyle({
        palette: "Neon Horse",
        roundness: "Basic",
        elevation: "Soft Lift",
        headings: "Inter",
        body: "Inter",
        captions: "Inter"
      })
    ).toThrow(StyleChoiceError);
  });

  it("only offers typefaces the renderer loads", () => {
    const loaded = readFileSync(join(import.meta.dir, "../index.html"), "utf-8");
    for (const family of FONT_FAMILIES) {
      expect(loaded).toContain(family.replace(/ /g, "+"));
    }
  });

  it("requires one display step without making it the default title", () => {
    const style = resolveStyle({
      palette: "Carbon Frost",
      roundness: "Basic",
      elevation: "Flat",
      headings: "Funnel Display",
      body: "Inter",
      captions: "Inter"
    });
    const guidance = styleGuidelines(style);
    expect(guidance).toContain("44-64 display");
    expect(guidance).toContain("one 44-64 display treatment per composed screen");
  });

  it("set_style writes tokens and the guidelines restate them on later turns", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("set_style", {
      palette: "Carbon Frost",
      roundness: "Basic",
      elevation: "Soft Lift",
      headings: "Funnel Display",
      body: "Inter",
      captions: "Geist Mono",
      thesis: "A publication, not a dashboard",
      ownWorld: "Carbon paper, hard rules and narrow labels",
      firstViewport: "A 56px title above one dense reading column"
    });
    expect(result).toContain("ok: style set");

    const doc = session.doc;
    expect((doc.variables as any)["accent-primary"].value).toBe("#5AC8F5");
    expect((doc.variables as any)["font-heading"].value).toBe("Funnel Display");
    expect(doc.metadata?.[STYLE_METADATA_KEY]).toEqual({
      palette: "Carbon Frost",
      roundness: "Basic",
      elevation: "Soft Lift",
      headings: "Funnel Display",
      body: "Inter",
      captions: "Geist Mono"
    });
    expect(doc.metadata?.[DIRECTION_METADATA_KEY]).toEqual({
      thesis: "A publication, not a dashboard",
      ownWorld: "Carbon paper, hard rules and narrow labels",
      firstViewport: "A 56px title above one dense reading column"
    });

    const recovered = currentStyle(doc);
    expect(recovered).toBeDefined();
    expect(styleGuidelines(recovered!)).toContain("Carbon Frost");
  });

  it("set_style names the valid options when given a bad one", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("set_style", {
      palette: "Nope",
      roundness: "Basic",
      elevation: "Soft Lift",
      headings: "Inter",
      body: "Inter",
      captions: "Inter"
    });
    expect(result).toStartWith("error:");
    expect(result).toContain('palette "Nope" is not in the catalog');
    expect(result).toContain("listed in your instructions");
  });

  it("parses every elevation effect example into painter-facing shadow fields", () => {
    for (const preset of ELEVATION) {
      for (const raw of [preset.sm, preset.lg]) {
        if (raw.startsWith("no shadow")) continue;
        const body = raw.replace(/^effect:\s*/, "");
        const value = Function(`"use strict"; return (${body})`)();
        const list = (Array.isArray(value) ? value : [value]).map((item) => effectSchema.parse(item));
        for (const eff of list) {
          expect(eff).toEqual(
            expect.objectContaining({
              type: "shadow",
              color: expect.any(String),
              x: expect.any(Number),
              y: expect.any(Number),
              blur: expect.any(Number),
              spread: expect.any(Number),
              enabled: true
            })
          );
          expect(eff).not.toHaveProperty("offset");
        }
      }
    }
  });
});

describe("Dealing", () => {
  it("offers a typeface for every job it asks the model to fill", () => {
    const sans = ["Inter", "Geist", "DM Sans", "Space Grotesk"];
    const serif = ["Newsreader", "Playfair Display", "Instrument Serif"];
    const display = ["Funnel Display", "Anton"];
    for (const seed of [1, 2, 7, 99, 1234, -5000]) {
      const hand = dealTypefaces(seed);
      for (const group of [sans, serif, display]) {
        expect(hand.some((f) => group.includes(f))).toBe(true);
      }
    }
  });

  it("makes monospace an occasional card rather than one in every hand", () => {
    const mono = ["Geist Mono", "IBM Plex Mono"];
    const N = 800;
    const rate =
      [...Array(N)].filter((_, i) => dealTypefaces(i + 1).some((f) => mono.includes(f))).length / N;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.4);
  });

  it("prints each dealt face beside the job it is allowed to do", () => {
    const withMono = [...Array(200)]
      .map((_, i) => i + 1)
      .find((s) => dealTypefaces(s).some((f) => ["Geist Mono", "IBM Plex Mono"].includes(f)))!;
    const catalog = styleCatalog(withMono);
    expect(catalog).toContain("Display");
    expect(catalog).toContain("headings above 28px only");
    expect(catalog).toMatch(/Mono\s+\S.*never labels, chips or tab bars/);
  });

  it("deals the same typefaces for one seed and reaches every family across seeds", () => {
    expect(dealTypefaces(42)).toEqual(dealTypefaces(42));
    const seen = new Set<string>();
    for (let s = 1; s <= 200; s++) for (const f of dealTypefaces(s)) seen.add(f);
    expect(seen.size).toBe(FONT_FAMILIES.length);
  });

  it("no longer offers Inter on every run", () => {
    const rate = [...Array(200)].filter((_, i) => dealTypefaces(i + 1).includes("Inter")).length / 200;
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.8);
  });

  it("spreads the palette hands evenly across neighbouring briefs", () => {
    const N = 300;
    const seen = new Map<string, number>();
    for (let s = 1; s <= N; s++) {
      const catalog = styleCatalog(s);
      for (const p of PALETTES) {
        if (catalog.includes(`  ${p.name} (`)) {
          seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
        }
      }
    }
    expect(seen.size).toBe(PALETTES.length);
    const worst = Math.max(...seen.values()) / N;
    expect(worst).toBeLessThan(0.3);
  });
});
