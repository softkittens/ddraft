import { describe, it, expect } from "bun:test";
import { makeDoc, frame, screen, txt, rect } from "./harness";
import { layoutDocument } from "../src/layout/layout";
import {
  auditDesign,
  auditDocument,
  auditInsertion,
  formatAudit,
  type AuditRule,
  type AuditSeverity,
  type AuditFinding
} from "../src/design/evaluator";
import { STYLE_METADATA_KEY, HARD_SHADOW_ELEVATION } from "../src/design/styleKeys";
import { createDocumentTools } from "../src/agent/tools";
import type { Document } from "../src/model/types";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function audit(doc: Document, targetId?: string): AuditFinding[] {
  return auditDesign(layoutDocument(doc), doc, targetId);
}

function rules(doc: Document, targetId?: string): AuditRule[] {
  return audit(doc, targetId).map((f) => f.rule);
}

function expectFinding(
  doc: Document,
  rule: AuditRule,
  opts?: { nodeId?: string; severity?: AuditSeverity; message?: RegExp | string }
): AuditFinding {
  const found = audit(doc).find((f) => f.rule === rule);
  expect(found).toBeDefined();
  if (opts?.nodeId) expect(found!.nodeId).toBe(opts.nodeId);
  if (opts?.severity) expect(found!.severity).toBe(opts.severity);
  if (opts?.message instanceof RegExp) expect(found!.message).toMatch(opts.message);
  else if (typeof opts?.message === "string") expect(found!.message).toContain(opts.message);
  return found!;
}

function healthyScreen(): Document {
  const doc = makeDoc(
    frame("screen", 390, "fit_content", [
      frame("wrapper", "fill_container", "fit_content", [
        txt("title", "Today", 28, { fill: "$foreground-primary", fontWeight: "700" }),
        txt("body", "Four things need attention.", 14, { fill: "$foreground-secondary" }),
        frame("cta", "fill_container", 48, [txt("cta_txt", "Review all", 15, { fill: "#FFFFFF" })], {
          layout: "horizontal", justifyContent: "center", alignItems: "center",
          fill: "$accent-primary", cornerRadius: 12
        })
      ], { layout: "vertical", gap: 24, padding: [0, 20] })
    ], { layout: "vertical", fill: "$surface-primary" })
  );
  doc.variables = {
    "surface-primary": { type: "color", value: "#FFFFFF" },
    "foreground-primary": { type: "color", value: "#09090B" },
    "foreground-secondary": { type: "color", value: "#52525B" },
    "accent-primary": { type: "color", value: "#18181B" }
  };
  return doc;
}

function screenWith(...body: any[]): Document {
  const doc = makeDoc(
    frame("screen", 390, "fit_content", [
      frame("status bar", "fill_container", 62, [], { name: "Status Bar" }),
      ...body
    ], { name: "Home", layout: "vertical", fill: "$surface-primary" })
  );
  doc.variables = {
    "surface-primary": { type: "color", value: "#FFFFFF" },
    "foreground-primary": { type: "color", value: "#09090B" },
    "accent-primary": { type: "color", value: "#18181B" }
  };
  return doc;
}

/* ------------------------------------------------------------------ *
 * 1. Layout Constraints & Geometry
 * ------------------------------------------------------------------ */

describe("Layout constraints", () => {
  it("stays silent on a healthy screen", () => {
    expect(audit(healthyScreen())).toEqual([]);
  });

  it("evaluates clipping and overflow rules", () => {
    // 1. Box overflow on clipped container
    const clipped = makeDoc(
      frame("card", 200, 40, [txt("bio", "A line of copy that is far too long for this box", 14)], {
        layout: "vertical",
        clip: true
      })
    );
    expectFinding(clipped, "clipped", { nodeId: "bio", severity: "blocker", message: /\d+px past the/ });

    // 2. Tailored fix for horizontal rows
    const chips = makeDoc(
      frame("s", 300, 200, [
        frame("row", 400, 36, [frame("c1", 100, 36), frame("c2", 100, 36)], { layout: "horizontal" })
      ], { layout: "vertical", clip: true })
    );
    expect(expectFinding(chips, "clipped").fix).toContain("This row is wider than the space it has");

    // 3. Tailored fix for fixed mobile screen
    const mobile = makeDoc(frame("s", 390, 844, [frame("c", "fill_container", 1000)], { clip: true, metadata: { screenKind: "mobile" } }));
    expect(expectFinding(mobile, "clipped").fix).toContain("Keep the fixed mobile screen size");

    // 4. Bleed and disabled child exemptions
    const bleed = makeDoc(frame("s", 390, 844, [frame("h", 390, 300, [], { fill: { type: "image", url: "x.jpg" } })], { clip: false }));
    const disabled = makeDoc(frame("card", 80, 80, [rect("r", 200, 200, { enabled: false })], { clip: true }));
    expect(rules(bleed)).not.toContain("clipped");
    expect(rules(disabled)).not.toContain("clipped");

    // 5. Unclipped text overrun
    const textOverrun = makeDoc(
      frame("card", 200, 40, [
        frame("in", 200, 40, [txt("t", "A line of copy that is far too long for this box to hold", 14)], { layout: "vertical" })
      ], { layout: "vertical", clip: false })
    );
    expect(rules(textOverrun)).toContain("clipped");
  });

  it("evaluates collision detection and exemptions", () => {
    const overlapping = makeDoc(frame("s", 400, 400, [rect("r1", 100, 100, { x: 50, y: 50 }), rect("r2", 100, 100, { x: 100, y: 100 })], { layout: "none" }));
    const partialAbs = makeDoc(frame("s", 600, 400, [rect("c1", 200, 200, { x: 0, y: 0 }), rect("c2", 200, 200, { x: 250, y: 0 }), rect("b", 100, 50, { x: 200, y: 50, layoutPosition: "absolute" })], { layout: "none" }));
    const containedAbs = makeDoc(frame("s", 400, 400, [rect("card", 300, 200, { x: 0, y: 0 }), rect("play", 48, 48, { x: 126, y: 76, layoutPosition: "absolute" })], { layout: "none" }));
    const disabledSibling = makeDoc(frame("s", 200, 200, [rect("a", 50, 50, { x: 10, y: 10, enabled: false }), rect("b", 50, 50, { x: 20, y: 20 })], { layout: "none" }));

    expectFinding(overlapping, "collision", { severity: "blocker" });
    expect(rules(partialAbs)).toContain("collision");
    expect(rules(containedAbs)).not.toContain("collision");
    expect(rules(disabledSibling)).not.toContain("collision");
  });

  it("evaluates off-canvas and font readability floors", () => {
    const offCanvas = makeDoc(frame("s", 200, 200, [], { x: -40, y: 0 }));
    const tiny = makeDoc(frame("s", 200, 200, [txt("t", "Tiny", 7)]));
    const small = makeDoc(frame("s", 200, 200, [txt("t", "Small", 10)]));

    expectFinding(offCanvas, "off_canvas", { severity: "warning" });
    expectFinding(tiny, "text_too_small", { severity: "blocker", message: "7px" });
    expectFinding(small, "text_too_small", { severity: "warning", message: "10px" });
  });
});

/* ------------------------------------------------------------------ *
 * 2. Typography & Scales
 * ------------------------------------------------------------------ */

describe("Typography & Scale Discipline", () => {
  it("evaluates text clipping and empty text", () => {
    const unwrapped = makeDoc(frame("c", 320, "fit_content", [txt("bio", "Gentle temperament, loves morning gallops in open pastures.", 12, { width: "fill_container" })], { layout: "vertical" }));
    const wrapped = makeDoc(frame("c", 320, "fit_content", [txt("bio", "Gentle temperament, loves morning gallops in open pastures.", 12, { width: "fill_container", textGrowth: "fixed-width" })], { layout: "vertical" }));
    const empty = makeDoc(frame("s", 300, 200, [txt("t", "", 14)]));

    expectFinding(unwrapped, "text_clipped", { severity: "blocker" });
    expect(rules(wrapped)).not.toContain("text_clipped");
    expectFinding(empty, "empty_text", { severity: "blocker" });
  });

  it("evaluates letter-spacing tracking rules", () => {
    const tight = makeDoc(frame("s", 300, 200, [txt("t", "Display Headline", 48, { letterSpacing: -3 })]));
    const untrackedCaps = makeDoc(frame("s", 300, 200, [txt("t", "ALL CAPS LABEL", 14, { letterSpacing: 0 })]));
    const trackedCaps = makeDoc(frame("s", 300, 200, [txt("t", "ALL CAPS LABEL", 14, { letterSpacing: 1.5 })]));
    const numerals = makeDoc(frame("s", 300, 200, [txt("t", "42", 14, { letterSpacing: 0 })]));

    expectFinding(tight, "tracking", { severity: "warning" });
    expectFinding(untrackedCaps, "tracking", { severity: "warning" });
    expect(rules(trackedCaps)).not.toContain("tracking");
    expect(rules(numerals)).not.toContain("tracking");
  });

  it("evaluates prose measure", () => {
    const longProse = "Typography is the art and technique of arranging type to make written language legible, readable and appealing when displayed. The arrangement of type involves selecting typefaces, point sizes, line lengths, line-spacing, and letter-spacing.";
    const wide = makeDoc(frame("s", 1200, "fit_content", [txt("b", longProse, 16, { width: 1100 })], { layout: "vertical" }));
    const narrow = makeDoc(frame("s", 400, "fit_content", [txt("b", "A short paragraph of body copy that wraps.", 14, { width: "fill_container", textGrowth: "fixed-width" })], { layout: "vertical" }));
    const bannerHeading = makeDoc(frame("s", 1200, "fit_content", [txt("h", "A short punchy banner heading across the screen", 48, { width: 1100 })], { layout: "vertical" }));

    expectFinding(wide, "prose_measure", { severity: "warning" });
    expect(rules(narrow)).not.toContain("prose_measure");
    expect(rules(bannerHeading)).not.toContain("prose_measure");
  });

  it("evaluates scale discipline (type, spacing, radius)", () => {
    const chaos = makeDoc(frame("s", 400, "fit_content", [
      ...[32, 27, 23, 19, 17, 15, 13, 11].map((sz, i) => txt(`t${i}`, "x", sz)),
      ...[3, 5, 7, 9, 11, 13].map((r, i) => frame(`f${i}`, 100, 40, [], { cornerRadius: r, gap: r + 4 }))
    ], { layout: "vertical" }));
    const rChaos = rules(chaos);
    expect(rChaos).toContain("type_scale");
    expect(rChaos).toContain("spacing_scale");
    expect(rChaos).toContain("radius_scale");

    const evenSpacing = makeDoc(frame("s", 400, "fit_content", [frame("a", 100, 40, [], { gap: 10, padding: 14 }), frame("b", 100, 40, [], { gap: 6 })], { layout: "vertical" }));
    const oddSpacing = makeDoc(frame("s", 400, "fit_content", [frame("a", 100, 40, [], { gap: 7, padding: 15 })], { layout: "vertical" }));
    expect(rules(evenSpacing)).not.toContain("spacing_scale");
    expectFinding(oddSpacing, "spacing_scale", { message: "odd spacing" });
  });
});

/* ------------------------------------------------------------------ *
 * 3. Styling, Colors & Effects
 * ------------------------------------------------------------------ */

describe("Styling, Colors & Effects", () => {
  it("evaluates contrast ratios across literals, tokens and rgb values", () => {
    const lowLiteral = makeDoc(frame("s", 300, 200, [txt("t", "Low", 14, { fill: "#BBBBBB" })], { fill: "#FFFFFF" }));
    expectFinding(lowLiteral, "low_contrast", { severity: "blocker", message: "4.5:1 is required" });

    const lowToken = makeDoc(frame("s", 300, 200, [txt("t", "Low", 14, { fill: "$fg" })], { fill: "$bg" }));
    lowToken.variables = { bg: { type: "color", value: "#FFFFFF" }, fg: { type: "color", value: "#CCCCCC" } };
    expect(rules(lowToken)).toContain("low_contrast");

    const lowRgb = makeDoc(frame("s", 300, 200, [txt("t", "Low", 14, { fill: "rgb(200, 200, 200)" })], { fill: "#fff" }));
    expect(rules(lowRgb)).toContain("low_contrast");

    const onPhoto = makeDoc(frame("s", 300, 200, [txt("t", "Photo", 14, { fill: "#FFF" })], { fill: { type: "image", url: "p.jpg" } }));
    expect(rules(onPhoto)).not.toContain("low_contrast");

    // Solid card over photo is evaluated for contrast
    const cardOverPhoto = makeDoc(
      frame("s", 300, 400, [
        frame("card", 200, 100, [txt("t", "Dark on Dark", 14, { fill: "#1e293b" })], { fill: "#0f172a" })
      ], { fill: { type: "image", url: "p.jpg" } })
    );
    expectFinding(cardOverPhoto, "low_contrast", { severity: "blocker" });
  });

  it("evaluates token bypass across literals, multi-fills and gradient stops", () => {
    const withTokens = makeDoc(frame("s", 200, 200, [rect("r", 50, 50, { fill: "#334155" })]));
    withTokens.variables = { "surface-primary": { type: "color", value: "#FFFFFF" } };
    expectFinding(withTokens, "token_bypass", { message: "#334155" });

    const arrayTokens = makeDoc(frame("s", 200, 200, [rect("r", 50, 50, { fill: ["#e11d48"] })]));
    arrayTokens.variables = { "surface-primary": { type: "color", value: "#FFFFFF" } };
    expect(rules(arrayTokens)).toContain("token_bypass");

    const gradientTokens = makeDoc(frame("s", 200, 200, [rect("r", 50, 50, { fill: { type: "gradient", stops: [{ color: "#2563eb" }] } })]));
    gradientTokens.variables = { "surface-primary": { type: "color", value: "#FFFFFF" } };
    expect(rules(gradientTokens)).toContain("token_bypass");

    const noTokens = makeDoc(frame("s", 200, 200, [rect("r", 50, 50, { fill: "#334155" })]));
    expect(rules(noTokens)).not.toContain("token_bypass");
  });

  it("evaluates accent overuse", () => {
    const four = makeDoc(frame("s", 390, 844, [
      frame("sb", "fill_container", 62, [], { name: "Status Bar" }),
      ...[1, 2, 3, 4].map((i) => frame(`a${i}`, 100, 40, [], { fill: "$accent-primary" }))
    ], { name: "Home", layout: "vertical" }));
    const one = makeDoc(frame("s", 390, 844, [
      frame("sb", "fill_container", 62, [], { name: "Status Bar" }),
      frame("a1", 100, 40, [], { fill: "$accent-primary" })
    ], { name: "Home", layout: "vertical" }));
    const accentText = screenWith(frame("r", "fill_container", 44, [txt("l", "P", 15, { fill: "$accent-primary" })]));

    expectFinding(four, "accent_overuse", { severity: "warning", message: "4 elements" });
    expect(rules(one)).not.toContain("accent_overuse");
    expect(rules(accentText)).not.toContain("accent_overuse");
  });

  it("evaluates shadow quality and neobrutalist exemptions", () => {
    const halo = makeDoc(frame("c", 200, 100, [], { effect: [{ type: "shadow", x: 0, y: 0, blur: 0, color: "#00000033", enabled: true }] }));
    const soft = makeDoc(frame("c", 200, 100, [], { effect: [{ type: "shadow", x: 0, y: 4, blur: 12, color: "#0000001A", enabled: true }] }));
    const hardBlock = makeDoc(frame("c", 200, 100, [], { effect: [{ type: "shadow", x: 4, y: 4, blur: 0, color: "#000000", enabled: true }] }));
    const hardBlockAllowed = makeDoc(frame("c", 200, 100, [], { effect: [{ type: "shadow", x: 4, y: 4, blur: 0, color: "#000000", enabled: true }] }));
    hardBlockAllowed.metadata = { [STYLE_METADATA_KEY]: { elevation: HARD_SHADOW_ELEVATION } };

    expectFinding(halo, "shadow_quality", { severity: "warning" });
    expectFinding(hardBlock, "shadow_quality", { severity: "warning", message: "hard block shadow" });
    expect(rules(soft)).not.toContain("shadow_quality");
    expect(rules(hardBlockAllowed)).not.toContain("shadow_quality");
  });

  it("evaluates border accent badges and exemptions", () => {
    const badge = makeDoc(frame("t", 200, 80, [], { cornerRadius: 12, stroke: "$accent-primary", strokeWidth: { top: 0, right: 0, bottom: 0, left: 4 } }));
    const hairline = makeDoc(frame("t", 200, 80, [], { cornerRadius: 12, stroke: "$accent-primary", strokeWidth: { top: 0, right: 0, bottom: 0, left: 1 } }));
    const square = makeDoc(frame("t", 200, 80, [], { cornerRadius: 0, stroke: "$accent-primary", strokeWidth: { top: 0, right: 0, bottom: 0, left: 4 } }));

    expectFinding(badge, "border_accent", { severity: "warning" });
    expect(rules(hairline)).not.toContain("border_accent");
    expect(rules(square)).not.toContain("border_accent");
  });

  it("evaluates single elevation depth discipline (no ghost cards)", () => {
    const ghostCard = makeDoc(frame("c", 200, 100, [], {
      stroke: "$border-subtle",
      strokeWidth: 1,
      effect: [{ type: "shadow", x: 0, y: 4, blur: 12, color: "#0000001A", enabled: true }]
    }));
    const borderOnly = makeDoc(frame("c", 200, 100, [], { stroke: "$border-subtle", strokeWidth: 1 }));
    const shadowOnly = makeDoc(frame("c", 200, 100, [], { effect: [{ type: "shadow", x: 0, y: 4, blur: 12, color: "#0000001A", enabled: true }] }));

    expectFinding(ghostCard, "single_elevation", { severity: "warning", message: "ghost card" });
    expect(rules(borderOnly)).not.toContain("single_elevation");
    expect(rules(shadowOnly)).not.toContain("single_elevation");
  });
});

/* ------------------------------------------------------------------ *
 * 4. Composition & Anti-Patterns
 * ------------------------------------------------------------------ */

describe("Composition & Anti-Patterns", () => {
  it("evaluates tap targets and container health", () => {
    const smallBtn = makeDoc(frame("s", 200, 200, [frame("btn", 32, 32, [], { name: "Close Button" })]));
    const okBtn = makeDoc(frame("s", 200, 200, [frame("btn", 48, 48, [], { name: "CTA Button" })]));
    const collapsed = makeDoc(frame("s", 390, 844, [frame("c", 0, 0, [frame("h", "fill_container", 200)])], { layout: "vertical" }));
    const emptyFrame = makeDoc(frame("s", 390, 600, [frame("hole", "fill_container", 300, [], { name: "Gallery" })], { layout: "vertical" }));

    expectFinding(smallBtn, "tap_target", { severity: "warning", message: "32x32px" });
    expect(rules(okBtn)).not.toContain("tap_target");
    expectFinding(collapsed, "collapsed_container", { severity: "blocker" });
    expectFinding(emptyFrame, "empty_container", { message: "390x300" });
  });

  it("evaluates nested screens and duplicate regions", () => {
    const nested = makeDoc(frame("outer", 390, "fit_content", [
      frame("sb1", "fill_container", 62, [], { name: "Status Bar" }),
      frame("inner", 390, "fit_content", [frame("sb2", "fill_container", 62, [], { name: "Status Bar" })], { name: "Profile", layout: "vertical" })
    ], { name: "Discover", layout: "vertical" }));
    const topBarDesktop = makeDoc(frame("s", 1440, 1024, [frame("top", "fill_container", 64, [frame("a", 200, 40, [], { name: "Top Bar Actions" })], { name: "Top Bar", layout: "horizontal" })], { name: "Desk", layout: "vertical" }));

    const tabBar = (id: string) => frame(id, "fill_container", 56, [frame(`${id}i`, 40, 40)], { name: "Tab Bar", layout: "horizontal" });
    const dupTab = makeDoc(frame("s", 390, "fit_content", [
      frame("sb", "fill_container", 62, [], { name: "Status Bar" }),
      frame("in1", "fill_container", 68, [tabBar("tb1")], { name: "Tab Bar Inset" }),
      frame("in2", "fill_container", 68, [tabBar("tb2")], { name: "Tab Bar Inset" })
    ], { name: "Discover", layout: "vertical" }));

    expectFinding(nested, "nested_screen", { severity: "blocker" });
    expect(rules(topBarDesktop)).not.toContain("nested_screen");
    expectFinding(dupTab, "duplicate_region", { severity: "blocker", message: "2 tab bars" });
  });

  it("evaluates composition expectations (bleed, display, tail)", () => {
    const missedBleed = screenWith(frame("inset", "fill_container", "fit_content", [frame("hero", "fill_container", 400, [], { name: "Hero Photo", fill: { type: "image", url: "x.jpg" } })], { name: "Inset Content", layout: "vertical" }));
    const missingDisplay = screenWith(txt("h", "Section heading", 22, {}), txt("b", "Body", 14, {}));
    const emptyTail = makeDoc(frame("s", 390, 844, [
      frame("sb", "fill_container", 62, [], { name: "Status Bar" }),
      frame("content", "fill_container", 200, [txt("t", "Short", 48, {})], { layout: "vertical" }),
      frame("tab", "fill_container", 56, [], { name: "Tab Bar", y: 788 })
    ], { name: "Home", layout: "none" }));

    expectFinding(missedBleed, "missed_bleed", { severity: "warning" });
    expectFinding(missingDisplay, "missing_display", { severity: "warning" });
    expectFinding(emptyTail, "empty_tail", { severity: "warning" });

    // An intentional rounded card inside Inset Content does NOT trigger missed_bleed
    const roundedCard = screenWith(frame("inset", "fill_container", "fit_content", [
      frame("hero", "fill_container", 400, [], { name: "Hero Card", cornerRadius: 20, fill: { type: "image", url: "x.jpg" } })
    ], { name: "Inset Content", padding: [0, 20], layout: "vertical" }));
    expect(rules(roundedCard)).not.toContain("missed_bleed");
    expect(rules(roundedCard)).not.toContain("radius_scale");

    // An edge-to-edge container touching screen borders with rounded corners triggers radius_scale warning
    const edgeToEdgeRounded = screenWith(
      frame("hero", 390, 380, [], { name: "Bleed Hero", cornerRadius: 24, fill: { type: "image", url: "x.jpg" } })
    );
    expectFinding(edgeToEdgeRounded, "radius_scale", { message: "spans edge-to-edge" });
  });

  it("evaluates cloned content and stat tile rows", () => {
    const row = (id: string, name: string, meta: string) => frame(id, "fill_container", "fit_content", [txt(`${id}_n`, name, 16, { fontFamily: "$font-body" }), txt(`${id}_m`, meta, 12, { fontFamily: "$font-caption" })], { name: "Match Row", layout: "horizontal", gap: 12 });
    const cloned = makeDoc(frame("s", 390, "fit_content", [frame("list", "fill_container", "fit_content", [row("r1", "Match", "15:00"), row("r2", "Match", "15:00"), row("r3", "Match", "15:00")], { layout: "vertical" })], { layout: "vertical" }));
    const distinct = makeDoc(frame("s", 390, "fit_content", [frame("list", "fill_container", "fit_content", [row("r1", "Match 1", "15:00"), row("r2", "Match 2", "17:00"), row("r3", "Match 3", "19:00")], { layout: "vertical" })], { layout: "vertical" }));

    const component = { ...row("tpl", "Juniper", "Matched 8 min ago"), reusable: true };
    const refClones = screenWith(frame("list", "fill_container", "fit_content", [component, { type: "ref", id: "i1", ref: "tpl" } as any, { type: "ref", id: "i2", ref: "tpl" } as any], { layout: "vertical" }));

    expectFinding(cloned, "cloned_content", { severity: "warning" });
    expect(rules(distinct)).not.toContain("cloned_content");
    expect(auditDocument(refClones).map((f) => f.rule)).toContain("cloned_content");

    const stat = (id: string, num: string, label: string) => frame(id, 100, 80, [txt(`${id}_v`, num, 32), txt(`${id}_l`, label, 12)], { layout: "vertical", gap: 4 });
    const stat3 = screenWith(frame("stats", "fill_container", "fit_content", [stat("s1", "1k", "A"), stat("s2", "2k", "B"), stat("s3", "3k", "C")], { layout: "horizontal", gap: 12 }));
    const stat2 = screenWith(frame("stats", "fill_container", "fit_content", [stat("s1", "1k", "A"), stat("s2", "2k", "B")], { layout: "horizontal", gap: 12 }));
    expectFinding(stat3, "stat_tile_row", { severity: "warning" });
    expect(rules(stat2)).not.toContain("stat_tile_row");
  });
});

/* ------------------------------------------------------------------ *
 * 5. Scoping, Triage & Tool Integration
 * ------------------------------------------------------------------ */

describe("Scoping, Triage & Tool Integration", () => {
  it("scopes audit findings to subtree roots", () => {
    const doc = makeDoc(
      frame("a", 200, 40, [txt("t1", "A line of copy far too long for this box", 14)], { layout: "vertical", clip: true }),
      frame("b", 200, 40, [txt("t2", "A line of copy far too long for this box", 14)], { layout: "vertical", clip: true })
    );
    const scopeA = audit(doc, "a").map((f) => f.nodeId);
    expect(scopeA).toContain("t1");
    expect(scopeA).not.toContain("t2");

    const scopeB = audit(doc, "b").map((f) => f.nodeId);
    expect(scopeB).toContain("t2");
    expect(scopeB).not.toContain("t1");
  });

  it("formats audit triage severest first without arbitrary score numbers", () => {
    const findings: AuditFinding[] = [
      { rule: "type_scale", severity: "info", nodeId: "a", message: "m", fix: "f" },
      { rule: "clipped", severity: "blocker", nodeId: "b", message: "m", fix: "f" }
    ];
    const text = formatAudit(findings, "Audit");
    expect(text).toContain("1 blocker, 0 warnings, 1 info.");
    expect(text.indexOf("[blocker]")).toBeLessThan(text.indexOf("[info]"));
    expect(text).not.toMatch(/\bscore\b|\/100\b/i);
  });

  it("provides instant feedback on tool insertions", async () => {
    const session = createDocumentTools(makeDoc());
    const bad = await session.execute("insert_node", {
      node: {
        type: "frame", id: "card", name: "Card", width: 300, height: 40,
        layout: "vertical", clip: true,
        children: [{ type: "text", id: "bio", name: "Bio", fontSize: 14, content: "A line of copy far too long for forty pixels" }]
      }
    });
    expect(bad).toContain("Measured on what you just inserted");
    expect(bad).toContain("[blocker] clipped");

    const clean = await session.execute("insert_node", {
      node: { type: "frame", id: "box", name: "Box", width: 200, height: 100, layout: "vertical" }
    });
    expect(clean).not.toContain("Measured on what you just inserted");

    // Partial screen builds exempt finishing rules
    const partialScreen = makeDoc(frame("screen", 390, "fit_content", [frame("sb", "fill_container", 62, [], { name: "Status Bar" }), txt("t", "Arrivals", 20, {})], { layout: "vertical" }));
    expect(auditDocument(partialScreen).map((f) => f.rule)).toContain("missing_display");
    expect(auditInsertion(partialScreen, "screen").map((f) => f.rule)).not.toContain("missing_display");
  });

  it("flags uncentered icon buttons as icon_alignment warning", () => {
    const uncenteredButton = makeDoc(
      frame("screen", 390, 844, [
        frame("btn", 48, 48, [
          { type: "icon", id: "ico", name: "Heart", icon: "heart", width: 24, height: 24 } as any
        ], {
          name: "Action Button",
          cornerRadius: 24,
          layout: "horizontal",
          justifyContent: "start",
          alignItems: "start"
        })
      ])
    );
    expectFinding(uncenteredButton, "icon_alignment", {
      severity: "warning",
      message: "pinned to its top-left corner"
    });
  });

  it("flags eyebrow kickers above headings", () => {
    const kickerDoc = makeDoc(
      frame("screen", 390, 844, [
        frame("header", 300, 100, [
          txt("eyebrow", "NEAR YOU", 10),
          txt("title", "Brooklyn, NY", 28)
        ], { layout: "vertical" })
      ])
    );
    expectFinding(kickerDoc, "eyebrow_kicker", {
      severity: "warning",
      message: "is an eyebrow/kicker placed above heading"
    });
  });

  it("flags text colliding across image boundaries", () => {
    const collisionDoc = makeDoc(
      frame("screen", 390, 844, [
        frame("card", 320, 400, [
          frame("hero", 320, 200, [
            frame("img", 320, 200, [], { fill: { type: "image", url: "cat.png" } })
          ]),
          frame("details", 320, 200, [
            txt("mochi", "Mochi", 44, { layoutPosition: "absolute", x: 20, y: -20 } as any)
          ], { layout: "none" })
        ], { layout: "vertical" })
      ])
    );
    expectFinding(collisionDoc, "collision", {
      severity: "blocker",
      message: "partially overlaps and cuts across the boundary"
    });
  });

  it("flags content overlapping bottom navigation chrome", () => {
    const chromeDoc = makeDoc(
      screen("screen", [
        frame("content", 390, 750, [
          txt("footer", "Available for meet-and-greet · Northside Shelter", 14, { layoutPosition: "absolute", x: 20, y: 790 } as any)
        ], { layout: "none" }),
        frame("tab_bar", 390, 64, [], { name: "Tab Bar", layoutPosition: "absolute", x: 0, y: 780 } as any)
      ], { layout: "none" })
    );
    const findings = audit(chromeDoc);
    const chromeFinding = findings.find((f) => f.nodeId === "footer" && f.rule === "collision");
    expect(chromeFinding).toBeDefined();
    expect(chromeFinding!.message).toContain("overlaps the bottom navigation bar");
  });
});
