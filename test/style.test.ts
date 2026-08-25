import { describe, it, expect } from "bun:test";
import { makeDoc } from "./harness";
import { contrastRatio } from "../src/design/evaluator";
import {
  PALETTES,
  COMPOSITION_ARCHETYPES,
  dealCompositionArchetypes,
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
import { deriveStatusTokens, hexToHsl } from "../src/design/statusTokens";
import { effectSchema } from "../src/model/parse";
import { agentSystemPrompt } from "../src/agent/prompt";
import { createDocumentTools, TOOL_DEFS } from "../src/agent/tools";

describe("Style system", () => {
  it("deals a hand of palettes instead of printing the whole catalog", () => {
    const catalog = styleCatalog(12345);
    const offered = PALETTES.filter((p) => catalog.includes(`  ${p.name} — ${p.scheme}.`));
    expect(offered).toHaveLength(PALETTE_HAND_SIZE);
    expect(PALETTES.length).toBeGreaterThan(PALETTE_HAND_SIZE * 3);
  });

  it("lists the palette name as the set_style argument, not glued to light/dark", () => {
    // de275003: first call was set_style palette "Publication (light)" because
    // the hand printed `Publication (light) — …`. The catalog name is Publication.
    const catalog = styleCatalog(12345);
    for (const p of PALETTES) {
      expect(catalog).not.toContain(`  ${p.name} (${p.scheme})`);
    }
    const offered = PALETTES.filter((p) => catalog.includes(`  ${p.name} — ${p.scheme}.`));
    expect(offered).toHaveLength(PALETTE_HAND_SIZE);
  });

  it("resolves a palette name copied with the scheme parenthetical the old hand printed", () => {
    const p = PALETTES.find((entry) => entry.scheme === "light")!;
    const style = resolveStyle({
      composition: "Cinematic Hero & Narrative",
      palette: `${p.name} (${p.scheme})`,
      roundness: "Basic",
      elevation: "Soft Lift",
      headings: "Inter",
      body: "Inter",
      captions: "Inter"
    });
    expect(style.choice.palette).toBe(p.name);
  });

  it("puts both light and dark on the table in every hand", () => {
    for (const seed of [1, 2, 7, 99, 1234, -5000]) {
      const catalog = styleCatalog(seed);
      const offered = PALETTES.filter((p) => catalog.includes(`  ${p.name} — ${p.scheme}.`));
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
        composition: "Cinematic Hero & Narrative",
        palette: "Neon Horse",
        roundness: "Basic",
        elevation: "Soft Lift",
        headings: "Inter",
        body: "Inter",
        captions: "Inter"
      })
    ).toThrow(StyleChoiceError);
  });

  it("requires one display step without making it the default title", () => {
    const style = resolveStyle({
      composition: "Cinematic Hero & Narrative",
      palette: "Carbon Frost",
      roundness: "Basic",
      elevation: "Flat",
      headings: "Funnel Display",
      body: "Inter",
      captions: "Inter"
    });
    const guidance = styleGuidelines(style);
    expect(guidance).toContain("44-64 display");
    expect(guidance).toContain("Compact mobile apps may use 32-40 instead");
  });

  it("asks firstViewport for subject and hierarchy, not a left/right lock", () => {
    // 8ca10dd0: the hedge in this description, the builder prompt, and the
    // critic all licensed filling the desktop rails as a "split composition".
    const setStyle = TOOL_DEFS.find((t) => t.name === "set_style")!;
    const desc = (setStyle.parameters as any).properties.firstViewport.description as string;
    expect(desc).toContain("focal subject");
    expect(desc).toContain("static canvas");
    expect(desc).not.toContain("left/right");
  });

  it("set_style writes tokens and the guidelines restate them on later turns", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("set_style", {
      composition: "Monumental Editorial",
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
      composition: "Monumental Editorial",
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

  it("never points small text at a token that cannot carry it in style guidelines", () => {
    for (const palette of PALETTES) {
      const style = resolveStyle({
        composition: "Cinematic Hero & Narrative",
        palette: palette.name, roundness: "Rounded", elevation: "Flat",
        headings: "Inter", body: "Inter", captions: "Inter"
      });
      const text = styleGuidelines(style);
      const line = text.split("\n").find((l: string) => l.includes("$foreground-muted"))!;
      expect(line).toBeTruthy();
      expect(line).not.toMatch(/timestamps|inactive tab labels|caption/i);
    }
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

describe("Status colours are derived per palette", () => {
  it("gives every palette three legible status colours", () => {
    /*
     * The whole reason these are derived rather than authored: 58 palettes x 3
     * colours is 174 contrast decisions, and the one that gets it wrong is the
     * one nobody checks. Here every one of them is checked on every run.
     */
    let worst = Infinity;
    let worstAt = "";
    for (const palette of PALETTES) {
      const status = deriveStatusTokens(palette.tokens, palette.scheme);
      for (const [role, hex] of Object.entries(status)) {
        expect(hex).toMatch(/^#[0-9A-F]{6}$/);
        const ratio = contrastRatio(hex, palette.tokens["surface-secondary"])!;
        if (ratio < worst) { worst = ratio; worstAt = `${palette.name}/${role}`; }
      }
    }
    // 4.5:1 because these carry 11px bold labels — WARN, MAINT, 92% — not just dots.
    expect(worst, `worst was ${worstAt}`).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps each status recognisable as its meaning", () => {
    const hue = (hex: string) => hexToHsl(hex)!.h;
    const within = (h: number, centre: number, span: number) => {
      const d = Math.abs(((h - centre) % 360 + 360) % 360);
      return Math.min(d, 360 - d) <= span;
    };
    for (const palette of PALETTES) {
      const s = deriveStatusTokens(palette.tokens, palette.scheme);
      expect(within(hue(s["status-ok"]), 145, 20), `${palette.name} ok`).toBe(true);
      expect(within(hue(s["status-warn"]), 42, 14), `${palette.name} warn`).toBe(true);
      expect(within(hue(s["status-fault"]), 8, 14), `${palette.name} fault`).toBe(true);
    }
  });

  it("does not hand the same green to every dark palette", () => {
    // Anchoring lightness to a constant did exactly that: Carbon Frost, Amber
    // Night and Agentic all came back #49F390, which is a sticker rather than
    // part of a system. Lightness is offset from each palette's own card now.
    const darks = PALETTES.filter((p) => p.scheme === "dark");
    const greens = new Set(darks.map((p) => deriveStatusTokens(p.tokens, p.scheme)["status-ok"]));
    expect(greens.size).toBeGreaterThan(darks.length / 3);
  });

  it("moves a status hue off an accent that already occupies it", () => {
    const green: any = {
      name: "Test", scheme: "light", mood: "",
      tokens: {
        "surface-primary": "#FFFFFF", "surface-secondary": "#F2F2F2",
        "foreground-primary": "#111111", "foreground-secondary": "#555555",
        "foreground-muted": "#888888", "border-subtle": "#DDDDDD",
        "accent-primary": "#2E9E52", "accent-secondary": "#C2703D"
      }
    };
    const ok = deriveStatusTokens(green.tokens, "light")["status-ok"];
    const gap = Math.abs(hexToHsl(ok)!.h - hexToHsl(green.tokens["accent-primary"])!.h);
    // A dashboard where "online" and "the primary button" are the same colour
    // has lost both meanings.
    expect(gap).toBeGreaterThan(8);
  });

  it("writes the status tokens onto the document with the rest of the style", () => {
    const style = resolveStyle({
      composition: "Cinematic Hero & Narrative",
      palette: "Carbon Frost", roundness: "Basic", elevation: "Soft Lift",
      headings: "Inter", body: "Inter", captions: "Inter"
    });
    expect(Object.keys(style.variables)).toEqual(
      expect.arrayContaining(["status-ok", "status-warn", "status-fault"])
    );
    expect(styleGuidelines(style)).toContain("$status-ok");
    expect(styleGuidelines(style)).toContain("running, online, nominal");
  });
});

describe("Dealing", () => {
  it("offers a typeface for every job it asks the model to fill", () => {
    const sans = ["Inter", "Geist", "DM Sans", "Space Grotesk", "Plus Jakarta Sans", "Outfit", "Hanken Grotesk", "Chivo", "Epilogue"];
    const serif = ["Newsreader", "Playfair Display", "Instrument Serif", "Fraunces", "Cormorant Garamond", "EB Garamond", "Cardo", "DM Serif Display", "Bodoni Moda", "Spectral", "Crimson Pro", "Source Serif 4", "Cinzel"];
    const display = ["Funnel Display", "Anton", "Bricolage Grotesque", "Syne", "Unbounded", "Big Shoulders Display"];
    for (const seed of [1, 2, 7, 99, 1234, -5000]) {
      const hand = dealTypefaces(seed);
      for (const group of [sans, serif, display]) {
        expect(hand.some((f) => group.includes(f))).toBe(true);
      }
    }
  });

  it("makes monospace an occasional card rather than one in every hand", () => {
    const mono = ["Geist Mono", "IBM Plex Mono", "JetBrains Mono", "Space Mono", "Fira Code", "DM Mono"];
    const N = 800;
    const rate =
      [...Array(N)].filter((_, i) => dealTypefaces(i + 1).some((f) => mono.includes(f))).length / N;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.4);
  });

  it("prints each dealt face beside the job it is allowed to do", () => {
    const mono = ["Geist Mono", "IBM Plex Mono", "JetBrains Mono", "Space Mono", "Fira Code", "DM Mono"];
    const withMono = [...Array(200)]
      .map((_, i) => i + 1)
      .find((s) => dealTypefaces(s).some((f) => mono.includes(f)))!;
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
        if (catalog.includes(`  ${p.name} — ${p.scheme}.`)) {
          seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
        }
      }
    }
    expect(seen.size).toBe(PALETTES.length);
    const worst = Math.max(...seen.values()) / N;
    expect(worst).toBeLessThan(0.3);
  });

  it("does not tell the model to skip a look that fits the brief", () => {
    // Luna had Refined in the hand for a warm-minimal house and picked
    // Neobrutalism because this line said a guessable look is the wrong one.
    expect(styleCatalog(1)).not.toContain("If the look is guessable");
  });

  it("holds two palettes whose world overlaps a warm-minimal brief, and keeps costumes off that table", () => {
    const brief = "Warm minimal booking site for a Lisbon coworking space";
    for (const seed of [1, 2, 3, 7, 99, 1234, -5000]) {
      const catalog = styleCatalog(seed, PALETTE_HAND_SIZE, {}, { brief });
      const offered = PALETTES.filter((p) => catalog.includes(`  ${p.name} — ${p.scheme}.`));
      expect(offered).toHaveLength(PALETTE_HAND_SIZE);
      const matching = offered.filter((p) =>
        /warm|minimal|paper|linen|editorial|refined|modern|cafe/i.test(`${p.name} ${p.mood}`)
      );
      expect(matching.length).toBeGreaterThanOrEqual(2);
      expect(offered.map((p) => p.name)).not.toContain("Neobrutalism");
      expect(offered.map((p) => p.name)).not.toContain("Trading Terminal");
      expect(offered.map((p) => p.name)).not.toContain("Dithered");
      expect(offered.map((p) => p.name)).not.toContain("Simple");
      expect(offered.map((p) => p.name)).not.toContain("Corporate");
      expect(offered.map((p) => p.name)).not.toContain("Enterprise");
      expect(offered.map((p) => p.name)).not.toContain("Cobalt Clean");
      expect(catalog).not.toContain("Hard Block");
    }
  });

  it("still deals a costume world when the brief asks for that world", () => {
    for (const seed of [1, 7, 99]) {
      const catalog = styleCatalog(seed, PALETTE_HAND_SIZE, {}, {
        brief: "Bloomberg-style trading terminal for futures desks"
      });
      expect(catalog).toContain("Trading Terminal");
    }
  });

  it("offers Hard Block only when a block-world palette is in the hand", () => {
    const brutal = styleCatalog(3, PALETTE_HAND_SIZE, {}, {
      brief: "Neobrutalist poster site with bold borders and offset block shadows"
    });
    expect(brutal).toContain("Neobrutalism");
    expect(brutal).toContain("Hard Block");

    const quiet = styleCatalog(3, PALETTE_HAND_SIZE, {}, {
      brief: "Warm minimal booking site for a Lisbon coworking space"
    });
    expect(quiet).not.toContain("Neobrutalism");
    expect(quiet).not.toContain("Hard Block");
  });

  it("keeps one brief plus seed on the same hand", () => {
    const brief = "Warm minimal booking site for a Lisbon coworking space";
    const opts = { brief } as const;
    expect(styleCatalog(11, PALETTE_HAND_SIZE, {}, opts)).toBe(
      styleCatalog(11, PALETTE_HAND_SIZE, {}, opts)
    );
  });
});

describe("Composition archetypes", () => {
  it("provides 14 curated distinct composition archetypes", () => {
    expect(COMPOSITION_ARCHETYPES.length).toBe(14);
    for (const a of COMPOSITION_ARCHETYPES) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.signature.length).toBeGreaterThan(0);
      expect(a.rhythm.length).toBeGreaterThan(0);
      expect(a.density.length).toBeGreaterThan(0);
      expect(a.media.length).toBeGreaterThan(0);
      expect(a.avoid.length).toBeGreaterThan(0);
    }
  });

  it("resolves a style with a valid composition archetype", () => {
    const style = resolveStyle({
      composition: "Cinematic Hero & Narrative",
      palette: "Carbon Frost",
      roundness: "Basic",
      elevation: "Soft Lift",
      headings: "Inter",
      body: "Inter",
      captions: "Inter"
    });
    expect(style.choice.composition).toBe("Cinematic Hero & Narrative");
    expect(style.composition?.name).toBe("Cinematic Hero & Narrative");
    expect(style.composition?.signature).toContain("Full-bleed panoramic hero");
  });

  it("rejects an invalid composition archetype name", () => {
    expect(() =>
      resolveStyle({
        composition: "Random Nonexistent Layout",
        palette: "Carbon Frost",
        roundness: "Basic",
        elevation: "Soft Lift",
        headings: "Inter",
        body: "Inter",
        captions: "Inter"
      })
    ).toThrow(StyleChoiceError);
  });

  it("requires composition for fresh style resolution", () => {
    expect(() =>
      resolveStyle({
        palette: "Carbon Frost",
        roundness: "Basic",
        elevation: "Soft Lift",
        headings: "Inter",
        body: "Inter",
        captions: "Inter"
      })
    ).toThrow(StyleChoiceError);
  });

  it("permits missing composition when resolving legacy documents", () => {
    const style = resolveStyle(
      {
        palette: "Carbon Frost",
        roundness: "Basic",
        elevation: "Soft Lift",
        headings: "Inter",
        body: "Inter",
        captions: "Inter"
      },
      { allowMissingComposition: true }
    );
    expect(style.choice.palette).toBe("Carbon Frost");
    expect(style.composition).toBeUndefined();
  });

  it("includes composition in styleGuidelines when chosen", () => {
    const style = resolveStyle({
      composition: "Modular Bento Grid",
      palette: "Carbon Frost",
      roundness: "Basic",
      elevation: "Soft Lift",
      headings: "Inter",
      body: "Inter",
      captions: "Inter"
    });
    const guide = styleGuidelines(style);
    expect(guide).toContain("COMPOSITION: Modular Bento Grid");
    expect(guide).toContain("Dominant Geometry: Asymmetric multi-cell modular cluster");
    expect(guide).toContain("Rhythm Principle:  Punchy headline");
    expect(guide).toContain("Avoid:             Monotonous equal-size square grid");
  });

  it("strictly excludes incompatible compositions for tool surfaces (negative routing)", () => {
    for (const seed of [1, 2, 7, 42, 99, 1234]) {
      const toolDeals = dealCompositionArchetypes(seed, { archetype: "tool", surface: "desktop" });
      const names = toolDeals.map((a) => a.name);
      // Tool eligible: Operational Workbench, Modular Bento Grid, Dense Multi-Pane Inspector, Monospace Terminal
      for (const name of names) {
        expect([
          "Operational Workbench",
          "Modular Bento Grid",
          "Dense Multi-Pane Inspector",
          "Monospace Terminal & API Spec Ledger"
        ]).toContain(name);
      }
      // Negative checks: site and mobile app archetypes must never appear
      expect(names).not.toContain("Cinematic Hero & Narrative");
      expect(names).not.toContain("Monumental Editorial");
      expect(names).not.toContain("Filtered Catalog & Index Ledger");
      expect(names).not.toContain("Card-Stage & Thumb Dock");
      expect(names).not.toContain("Linear Stepwise Journey");
      expect(names).not.toContain("Asymmetric Split Instrument");
      expect(names).not.toContain("Bifurcated Dual-Gate Gateway");
      expect(names).not.toContain("Sticky Stage & Scrolly Track");
    }
  });

  it("strictly excludes Operational Workbench and Card-Stage for site surfaces (negative routing)", () => {
    for (const seed of [1, 2, 7, 42, 99, 1234]) {
      const siteDeals = dealCompositionArchetypes(seed, { archetype: "site", surface: "desktop" });
      const names = siteDeals.map((a) => a.name);
      expect(names).not.toContain("Operational Workbench");
      expect(names).not.toContain("Dense Multi-Pane Inspector");
      expect(names).not.toContain("Card-Stage & Thumb Dock");
    }
  });

  it("strictly routes swipe discovery and mobile apps to mobile archetypes (negative routing)", () => {
    for (const seed of [1, 2, 7, 42, 99, 1234]) {
      const mobileDeals = dealCompositionArchetypes(seed, {
        archetype: "app",
        surface: "mobile",
        traits: ["swipe_discovery"]
      });
      const names = mobileDeals.map((a) => a.name);
      expect(names).toContain("Card-Stage & Thumb Dock");
      expect(names).not.toContain("Operational Workbench");
      expect(names).not.toContain("Dense Multi-Pane Inspector");
      expect(names).not.toContain("Cinematic Hero & Narrative");
      expect(names).not.toContain("Monumental Editorial");
      expect(names).not.toContain("Filtered Catalog & Index Ledger");
    }
  });

  it("lists composition archetypes in the style catalog", () => {
    const catalog = styleCatalog(
      42,
      PALETTE_HAND_SIZE,
      {},
      { brief: "Modern devtools product", context: { archetype: "site", surface: "desktop", traits: [], lifecycle: "initial_build" } }
    );
    expect(catalog).toContain("COMPOSITION (choose one for composition)");
    expect(catalog).toContain("Pass the archetype name to set_style");
  });
});
