import { describe, it, expect } from "bun:test";
import { makeDoc, frame, screen, txt, rect } from "./harness";
import { layoutDocument } from "../src/layout/layout";
import {
  auditDesign,
  auditDocument,
  auditInsertion,
  formatAudit,
  FINISHING_RULES,
  type AuditRule,
  type AuditSeverity,
  type AuditFinding
} from "../src/design/evaluator";
import { STYLE_METADATA_KEY, HARD_SHADOW_ELEVATION } from "../src/design/styleKeys";
import { nearestGeneratedAspect } from "../src/design/photography";
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
    expect(expectFinding(mobile, "clipped").fix).toContain("first viewport");

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

    // Dark text on mid-tone/dark colored button is blocked
    const darkOnGreenBtn = makeDoc(
      frame("s", 390, 844, [
        frame("btn", 350, 48, [txt("label", "Build a box", 16, { fill: "#1A1A1A", fontWeight: 600 })], {
          name: "Primary Action Button",
          fill: "#6F8F45"
        })
      ])
    );
    expectFinding(darkOnGreenBtn, "low_contrast", {
      severity: "blocker",
      message: /dark text on a colored surface/
    });

    // White text on mid-tone olive green button (3.7:1 >= 3.0:1) passes cleanly
    const whiteOnGreenBtn = makeDoc(
      frame("s", 390, 844, [
        frame("btn", 350, 48, [txt("label", "Build a box", 16, { fill: "#FFFFFF", fontWeight: 600 })], {
          name: "Primary Action Button",
          fill: "#6F8F45"
        })
      ])
    );
    expect(rules(whiteOnGreenBtn)).not.toContain("low_contrast");
  });

  it("blocks icons that disappear into their control surface", () => {
    const invisibleAction = makeDoc(frame("screen", 390, 844, [
      frame("add", 44, 44, [{
        type: "icon", id: "plus", name: "Plus", icon: "plus", width: 20, height: 20,
        stroke: "$surface-secondary"
      } as any], {
        name: "Add Button", fill: "$surface-secondary", cornerRadius: 22,
        layout: "horizontal", justifyContent: "center", alignItems: "center"
      })
    ], { fill: "$surface-primary" }));
    invisibleAction.variables = {
      "surface-primary": { type: "color", value: "#FFFFFF" },
      "surface-secondary": { type: "color", value: "#F8F7FC" }
    };
    expectFinding(invisibleAction, "low_contrast", {
      nodeId: "plus",
      severity: "blocker",
      message: /Icon.*3:1/
    });
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

  it("evaluates accent overuse by role, not by element", () => {
    const role = (id: string) =>
      frame(id, 120, 40, [frame(`${id}a`, 100, 40, [], { fill: "$accent-primary" })]);
    const screenOf = (...kids: ReturnType<typeof frame>[]) =>
      makeDoc(frame("s", 390, 844, [
        frame("sb", "fill_container", 62, [], { name: "Status Bar" }),
        ...kids
      ], { name: "Home", layout: "vertical" }));

    const threeRoles = screenOf(role("r1"), role("r2"), role("r3"));
    const twoRoles = screenOf(role("r1"), role("r2"));
    // A data series is one role however many bars it has. Counting bars was
    // what made every dashboard trip this rule and desaturate its own chart.
    const series = screenOf(
      frame("chart", "fill_container", 120,
        [1, 2, 3, 4, 5, 6, 7, 8].map((i) => frame(`bar${i}`, 20, 10 * i, [], { fill: "$accent-primary" })),
        { layout: "horizontal", gap: 8 })
    );
    const accentText = screenWith(frame("r", "fill_container", 44, [txt("l", "P", 15, { fill: "$accent-primary" })]));

    // Repeated card CTAs in a collection (e.g. 6 identical "Reserve" buttons) represent 1 semantic role.
    const cardCtas = screenOf(
      frame("hero-cta", 140, 44, [txt("h_btn", "Check availability", 14)], { fill: "$accent-primary" }),
      frame("grid", "fill_container", 400, [
        ...[1, 2, 3, 4, 5, 6].map((i) =>
          frame(`card-${i}`, 200, 180, [
            txt(`t-${i}`, `Workspace ${i}`, 16),
            frame(`btn-${i}`, 100, 36, [txt(`btn-txt-${i}`, "Reserve", 14)], { fill: "$accent-primary" })
          ])
        )
      ])
    );

    expectFinding(threeRoles, "accent_overuse", { severity: "warning", message: "3 separate roles" });
    expect(rules(twoRoles)).not.toContain("accent_overuse");
    expect(rules(series)).not.toContain("accent_overuse");
    expect(rules(accentText)).not.toContain("accent_overuse");
    expect(rules(cardCtas)).not.toContain("accent_overuse");
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
    const smallBtn = makeDoc(screen("mobile", [frame("btn", 32, 32, [], { name: "Close Button" })]));
    const okBtn = makeDoc(screen("mobile", [frame("btn", 48, 48, [], { name: "CTA Button" })]));
    const collapsed = makeDoc(frame("s", 390, 844, [frame("c", 0, 0, [frame("h", "fill_container", 200)])], { layout: "vertical" }));
    const emptyFrame = makeDoc(frame("s", 390, 600, [frame("hole", "fill_container", 300, [], { name: "Gallery" })], { layout: "vertical" }));

    expectFinding(smallBtn, "tap_target", { severity: "warning", message: "32x32px" });
    expect(rules(okBtn)).not.toContain("tap_target");
    expectFinding(collapsed, "collapsed_container", { severity: "blocker" });
    expectFinding(emptyFrame, "empty_container", { message: "390x300" });
  });

  it("flags unnamed icon-only commerce actions on mobile, but not desktop", () => {
    const add = frame("add", 36, 36, [
      { id: "plus", type: "icon", icon: "plus", width: 16, height: 16 }
    ], { layout: "horizontal" });
    const mobile = makeDoc(screen("mobile", [add]));
    const desktop = makeDoc(screen("desktop", [add], { width: 1440 }));

    expectFinding(mobile, "tap_target", { severity: "warning", message: "36x36px" });
    expect(rules(desktop)).not.toContain("tap_target");
  });

  it("does not measure a label separately from its valid interactive parent", () => {
    const doc = makeDoc(frame("screen", 390, 844, [
      frame("action", 320, 44, [
        txt("label", "View cake details", 13, { name: "Photo action label" })
      ], { name: "Photo action", layout: "horizontal" })
    ], { layout: "vertical" }));
    expect(rules(doc)).not.toContain("tap_target");
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

  it("warns when a desktop Main column stops short of the viewport", () => {
    const leftover = makeDoc(frame("desk", 1440, 900, [
      frame("top", "fill_container", 56, [txt("brand", "Desk", 16, {})], { name: "Top Bar", layout: "horizontal" }),
      frame("body", "fill_container", "fill_container", [
        frame("main", "fill_container", "fill_container", [
          txt("h", "Overview", 48, {}),
          frame("kpi", "fill_container", 80, [txt("n", "18", 32, {})], { fill: "$surface-secondary" })
        ], { name: "Main", layout: "vertical", gap: 12, padding: [0, 8] })
      ], { name: "Body", layout: "horizontal" })
    ], { name: "Board", layout: "vertical", metadata: { screenKind: "desktop" } }));

    expectFinding(leftover, "empty_column", { nodeId: "main", severity: "warning", message: "Main" });
  });

  it("leaves a filled desktop Main alone", () => {
    const filled = makeDoc(frame("desk", 1440, 900, [
      frame("top", "fill_container", 56, [txt("brand", "Desk", 16, {})], { name: "Top Bar", layout: "horizontal" }),
      frame("body", "fill_container", "fill_container", [
        frame("main", "fill_container", "fill_container", [
          txt("h", "Overview", 48, {}),
          frame("plot", "fill_container", "fill_container", [
            rect("bar", 40, 200, { fill: "$accent-primary" })
          ], { fill: "$surface-secondary" })
        ], { name: "Main", layout: "vertical", gap: 12 })
      ], { name: "Body", layout: "horizontal" })
    ], { name: "Board", layout: "vertical", metadata: { screenKind: "desktop" } }));

    expect(rules(filled)).not.toContain("empty_column");
  });

  it("does not treat leftover cream under a subject photograph as an unfinished column", () => {
    const editorial = makeDoc(frame("desk", 1440, 900, [
      frame("top", "fill_container", 56, [txt("brand", "House", 16, {})], { name: "Top Bar", layout: "horizontal" }),
      frame("body", "fill_container", "fill_container", [
        frame("main", "fill_container", "fill_container", [
          txt("h", "Stay a while", 52, {}),
          frame("photo", "fill_container", 520, [], { fill: { type: "image", url: "room.jpg" } })
        ], { name: "Main", layout: "vertical", gap: 16 })
      ], { name: "Body", layout: "horizontal" })
    ], { name: "House", layout: "vertical", metadata: { screenKind: "desktop" } }));

    expect(rules(editorial)).not.toContain("empty_column");
    expect(rules(editorial)).not.toContain("undersized_subject");
  });

  it("warns when photography is only a thumbnail strip", () => {
    const strip = makeDoc(frame("desk", 1440, 900, [
      frame("top", "fill_container", 56, [txt("brand", "House", 16, {})], { name: "Top Bar" }),
      frame("main", "fill_container", "fill_container", [
        txt("h", "Book a desk", 48, {}),
        frame("thumb", 400, 80, [], { fill: { type: "image", url: "room.jpg" } })
      ], { name: "Main", layout: "vertical" })
    ], { name: "House", layout: "vertical", metadata: { screenKind: "desktop" } }));

    expectFinding(strip, "undersized_subject", { severity: "warning", message: "viewport" });
  });

  it("does not warn about undersized_subject on tall pages when hero occupies a real share of first viewport", () => {
    const tallSite = makeDoc(frame("desk", 1440, 4800, [
      frame("top", "fill_container", 56, [txt("brand", "Casa Estrela", 16, {})], { name: "Top Bar" }),
      frame("hero", "fill_container", 720, [
        frame("hero_copy", 600, 400, [txt("h", "Book a desk", 48, {})]),
        frame("hero_photo", 680, 520, [], { fill: { type: "image", url: "room.jpg" } })
      ], { name: "Hero", layout: "horizontal" })
    ], { name: "Casa Estrela", layout: "vertical", metadata: { screenKind: "desktop" } }));

    expect(rules(tallSite)).not.toContain("undersized_subject");
  });

  it("warns when three equal catalog cards are the page", () => {
    const card = (id: string, title: string) => frame(id, 220, 120, [
      txt(`${id}_t`, title, 16),
      txt(`${id}_b`, "Shared table · quiet", 12),
      txt(`${id}_p`, "€18", 14)
    ], { layout: "vertical", gap: 6 });
    const catalog = makeDoc(frame("s", 800, 400, [
      frame("row", "fill_container", 140, [card("a", "Sun Room"), card("b", "Library"), card("c", "Terrace")], {
        name: "Places",
        layout: "horizontal",
        gap: 12
      })
    ], { layout: "vertical" }));

    expectFinding(catalog, "catalog_row", { nodeId: "row", severity: "warning" });
  });

  it("does not treat an offer row on a tall site as the whole page", () => {
    const card = (id: string, title: string) => frame(id, 220, 120, [
      txt(`${id}_t`, title, 16),
      txt(`${id}_b`, "Shared table · quiet", 12),
      txt(`${id}_p`, "€18", 14)
    ], { layout: "vertical", gap: 6 });
    const site = makeDoc(frame("s", 1440, 2800, [
      frame("row", "fill_container", 140, [card("a", "Sun Room"), card("b", "Library"), card("c", "Terrace")], {
        name: "Offers",
        layout: "horizontal",
        gap: 12
      })
    ], { layout: "vertical", name: "House", metadata: { screenKind: "desktop" } }));

    expect(rules(site)).not.toContain("catalog_row");
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

describe("A design whose data does not render", () => {
  it("blocks a painted leaf that resolves to nothing, and names the value that did it", () => {
    const doc = makeDoc(frame("s", 400, 200, [
      frame("track", "fill_container", 7, [
        frame("fill", "82%" as any, "fill_container", [], { fill: "$accent-primary" })
      ], { layout: "horizontal", fill: "$surface-secondary" })
    ], { name: "Board", layout: "vertical", padding: 16 }));

    const found = expectFinding(doc, "invisible_node", { nodeId: "fill", severity: "blocker" });
    // The symptom is "0px wide". The cause is the percentage, and a finding
    // that names the cause is one the model can act on without investigating.
    expect(found.message).toContain('"82%"');
    expect(found.message).toContain("0x7px");
  });

  it("blocks an icon with no size and leaves a sized one alone", () => {
    const doc = makeDoc(frame("s", 200, 100, [
      { type: "icon", id: "ghost", name: "Pin", icon: "map-pin", stroke: "#fff", geometry: "M0 0" } as any,
      { type: "icon", id: "real", name: "Bell", icon: "bell", width: 16, height: 16, stroke: "#fff", geometry: "M0 0" } as any
    ], { layout: "horizontal", gap: 8 }));

    const found = expectFinding(doc, "invisible_node", { nodeId: "ghost", severity: "blocker" });
    expect(found.message).toContain("no width is set");
    expect(audit(doc).filter((f) => f.nodeId === "real")).toHaveLength(0);
  });

  it("leaves a divider and a real bar alone", () => {
    const doc = makeDoc(frame("s", 400, 200, [
      frame("rule", "fill_container", 1, [], { fill: "$border-subtle" }),
      frame("bar", 164, 7, [], { fill: "$accent-primary" })
    ], { name: "Board", layout: "vertical", gap: 8 }));
    expect(rules(doc)).not.toContain("invisible_node");
  });

  it("warns when a series is painted the colour of the card behind it", () => {
    const vars = {
      "$surface-primary": "#070B12",
      "$surface-secondary": "#101826",
      "$border-subtle": "#263246",
      "$accent-primary": "#38BDF8",
      "$foreground-muted": "#8492A6"
    };
    const chart = (id: string, fills: string[]) =>
      frame(id, "fill_container", 120,
        fills.map((f, i) => frame(`${id}b${i}`, 40, 40 + i * 8, [], { fill: f })),
        { name: `${id} Row`, layout: "horizontal", gap: 12, alignItems: "end" });
    const card = (id: string, fills: string[]) =>
      frame(`${id}card`, "fill_container", "fit_content", [chart(id, fills)],
        { layout: "vertical", padding: 14, fill: "$surface-secondary" });

    const dim = { ...makeDoc(frame("s", 800, 600, [
      card("dim", ["$border-subtle", "$border-subtle", "$border-subtle", "$border-subtle", "$accent-primary"])
    ], { name: "Board", layout: "vertical", padding: 24, fill: "$surface-primary" })), variables: vars };
    const lit = { ...makeDoc(frame("s", 800, 600, [
      card("lit", ["$foreground-muted", "$foreground-muted", "$foreground-muted", "$foreground-muted", "$accent-primary"])
    ], { name: "Board", layout: "vertical", padding: 24, fill: "$surface-primary" })), variables: vars };

    const found = expectFinding(dim, "undrawn_series", { nodeId: "dim", severity: "warning" });
    expect(found.message).toContain("$border-subtle");
    expect(rules(lit)).not.toContain("undrawn_series");
  });

  it("does not mistake a row of cards for a series", () => {
    // Cards hold children and vary on both axes; bars are painted leaves of one
    // width. Only the second is a chart, and only the second is this rule's.
    const doc = makeDoc(frame("s", 900, 300, [
      frame("row", "fill_container", "fit_content",
        [1, 2, 3, 4].map((i) => frame(`k${i}`, 180, 80, [txt(`k${i}t`, "24", 24)], { fill: "$surface-secondary" })),
        { layout: "horizontal", gap: 10 })
    ], { name: "Board", layout: "vertical", padding: 24, fill: "$surface-secondary" }));
    expect(rules(doc)).not.toContain("undrawn_series");
  });

  it("reads a small label above a metric as a stat tile, not an eyebrow", () => {
    const tile = (id: string, label: string, value: string) =>
      frame(id, 200, "fit_content", [
        txt(`${id}l`, label, 11),
        txt(`${id}v`, value, 28)
      ], { layout: "vertical", gap: 8, padding: 14 });

    const kpis = makeDoc(frame("s", 900, 400, [
      tile("t1", "ACTIVE UNITS", "24 / 28"),
      tile("t2", "CELL EFFICIENCY", "91.6%"),
      tile("t3", "CYCLE", "00:14:32"),
      tile("t4", "POWER DRAW", "412 kW")
    ], { name: "Board", layout: "horizontal", gap: 12 }));
    const marketing = makeDoc(frame("s", 390, 844, [
      tile("m1", "DISCOVER //", "Find your next adventure")
    ], { name: "Home", layout: "vertical" }));

    expect(rules(kpis)).not.toContain("eyebrow_kicker");
    expectFinding(marketing, "eyebrow_kicker", { nodeId: "m1l", severity: "warning" });
  });
});

describe("State has its own vocabulary", () => {
  it("names the status token a raw state colour was reaching for", () => {
    const doc: any = {
      version: "2.17",
      variables: { "$surface-primary": { type: "color", value: "#0B0D10" } },
      children: [{
        type: "frame", id: "s", name: "Board", width: 300, height: 100, fill: "$surface-primary",
        children: [
          { type: "ellipse", id: "ok", name: "H14 State", width: 8, height: 8, fill: "#4ADE80" },
          { type: "ellipse", id: "wr", name: "H15 State", width: 8, height: 8, fill: "#F59E0B" },
          { type: "ellipse", id: "ft", name: "H16 State", width: 8, height: 8, fill: "#EF4444" }
        ]
      }]
    };
    /*
     * The exact three colours a logged run reached for. Before the status
     * tokens existed the model was told only that it had bypassed the system,
     * with no token to bypass it toward — eleven #4ADE80 dots in one document.
     */
    const found = audit(doc).filter((f) => f.rule === "token_bypass");
    expect(found.find((f) => f.nodeId === "ok")!.message).toContain("$status-ok");
    expect(found.find((f) => f.nodeId === "wr")!.message).toContain("$status-warn");
    expect(found.find((f) => f.nodeId === "ft")!.message).toContain("$status-fault");
  });

  it("does not count status fills against the accent budget", () => {
    const dot = (id: string, fill: string) => frame(id, 8, 8, [], { fill, name: `${id} State` });
    const doc = makeDoc(frame("s", 390, 844, [
      frame("sb", "fill_container", 62, [], { name: "Status Bar" }),
      frame("g1", 40, 20, [dot("a", "$status-ok")]),
      frame("g2", 40, 20, [dot("b", "$status-warn")]),
      frame("g3", 40, 20, [dot("c", "$status-fault")]),
      frame("g4", 40, 20, [dot("d", "$status-ok")])
    ], { name: "Home", layout: "vertical" }));
    // Four state indicators in four containers is a fleet grid, not four
    // competing accents. accent_overuse only ever looked at $accent-primary,
    // and that is now a deliberate line rather than an accident of the regex.
    expect(rules(doc)).not.toContain("accent_overuse");
  });
});

describe("A photograph in a frame no photograph fits", () => {
  const photo = { type: "image" as const, url: "data:image/jpeg;base64,AA==" };

  it("flags a phone hero band that crops most of the picture away", () => {
    const doc = screenWith(frame("m-hero-photo", 390, 1320, [], { name: "Courtyard mobile", fill: photo }));
    const found = expectFinding(doc, "cropped_photography", {
      nodeId: "m-hero-photo",
      severity: "warning",
      message: /390x1320 frame — 0\.30:1/
    });
    expect(found.message).toContain("61%");
    // The frame is the fix, so the sizes that work are named in it.
    // 3:4 is the tallest shape on offer, so 520 is as tall as 390 wide can go,
    // and being nearest the band it is named first.
    expect(found.fix).toMatch(/fits — 390x520 \(3:4\), /);
    expect(found.fix).toContain("390x219 (16:9)");
  });

  it("leaves a frame the generator can fill alone", () => {
    const doc = screenWith(frame("hero-photo", 390, 219, [], { name: "Courtyard", fill: photo }));
    expect(rules(doc)).not.toContain("cropped_photography");
  });

  /*
   * A nearly-square card used to be the common case of this defect, because
   * the tool split landscape from square at 1.15 and sent 1.17 to 16:9 — a 34%
   * crop where 1:1 costs 14%. Fixing the boundary halved the corpus-wide count
   * of severe crops, so this asserts the boundary rather than the rule.
   */
  it("does not flag a nearly-square card, which 1:1 serves", () => {
    const doc = screenWith(frame("card-photo", 350, 300, [], { name: "Library desk", fill: photo }));
    expect(rules(doc)).not.toContain("cropped_photography");
    expect(nearestGeneratedAspect(350 / 300).name).toBe("square");
  });

  it("puts the boundary between square and landscape at the geometric mean", () => {
    expect(nearestGeneratedAspect(1.2).name).toBe("square");
    expect(nearestGeneratedAspect(1.4).name).toBe("landscape");
    expect(nearestGeneratedAspect(0.8).name).toBe("portrait");
    expect(nearestGeneratedAspect(3.0).name).toBe("landscape");
  });

  it("ignores decoration too small to read as photography", () => {
    const doc = screenWith(frame("hairline", 30, 120, [], { name: "Edge sliver", fill: photo }));
    expect(rules(doc)).not.toContain("cropped_photography");
  });
});

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
      message: "holds its contents in a corner"
    });
  });

  it("flags a status chip whose label sits in the corner of a larger plate", () => {
    const looseChip = makeDoc(
      frame("screen", 390, 844, [
        frame("pill", 96, 36, [
          rect("dot", 6, 6, { fill: "$status-ok", cornerRadius: 99 }),
          txt("state", "RUNNING", 11, { fontWeight: "700" })
        ], {
          name: "Status Pill",
          cornerRadius: 99,
          layout: "horizontal",
          justifyContent: "start",
          alignItems: "start"
        })
      ])
    );
    expectFinding(looseChip, "icon_alignment", { nodeId: "pill", severity: "warning" });
  });

  it("leaves a hugging chip and a wide start-aligned nav row alone", () => {
    const hugged = makeDoc(
      frame("screen", 390, 844, [
        frame("pill", "fit_content", "fit_content", [
          rect("dot", 6, 6, { fill: "$status-ok", cornerRadius: 99 }),
          txt("state", "RUNNING", 11, { fontWeight: "700" })
        ], {
          name: "Status Pill",
          cornerRadius: 99,
          layout: "horizontal",
          justifyContent: "center",
          alignItems: "center",
          padding: [2, 8],
          gap: 6
        })
      ])
    );
    const navRow = makeDoc(
      frame("screen", 390, 844, [
        frame("item", 236, 36, [
          { type: "icon", id: "ico", icon: "house", width: 16, height: 16 } as any,
          txt("label", "Overview", 13)
        ], {
          name: "Nav Item",
          cornerRadius: 8,
          layout: "horizontal",
          justifyContent: "start",
          alignItems: "center",
          padding: [0, 12],
          gap: 8
        })
      ])
    );
    expect(rules(hugged)).not.toContain("icon_alignment");
    expect(rules(navRow)).not.toContain("icon_alignment");
  });

  it("leaves a centered multi-child cart pill alone", () => {
    const cart = makeDoc(frame("screen", 390, 844, [
      frame("cart", 58, 44, [
        { type: "icon", id: "bag", name: "Bag", icon: "shopping-bag", width: 18, height: 18 } as any,
        txt("count", "2", 13)
      ], {
        name: "Cart Button", layout: "horizontal", justifyContent: "center",
        alignItems: "center", padding: [0, 10], gap: 6, cornerRadius: 22
      })
    ]));
    expect(rules(cart)).not.toContain("icon_alignment");
  });

  it("flags eyebrow kickers with stylized hacker slashes above headings", () => {
    const kickerDoc = makeDoc(
      frame("screen", 390, 844, [
        frame("header", 300, 100, [
          txt("eyebrow", "NEAR YOU //", 10),
          txt("title", "Brooklyn, NY", 28)
        ], { layout: "vertical" })
      ])
    );
    expectFinding(kickerDoc, "eyebrow_kicker", {
      severity: "warning",
      message: "is an eyebrow/kicker placed above heading"
    });
  });

  it("flags a section heading glued to the card grid below it", () => {
    const card = (id: string) =>
      frame(id, 220, 280, [
        frame(`${id}img`, 220, 140, [], { fill: { type: "image", url: "room.jpg" } }),
        txt(`${id}t`, "The Focus Room", 22),
        txt(`${id}d`, "Twelve desks, north light.", 13)
      ], { layout: "vertical", gap: 8 });

    const glued = makeDoc(
      screen("desktop", [
        frame("spacesBand", 1312, "fit_content", [
          frame("spacesHead", "fill_container", "fit_content", [
            txt("spacesOverline", "THE SPACES", 12),
            txt("spacesTitle", "Four rooms, one unhurried pace.", 28),
            txt("spacesSub", "Each corner of the house holds a different kind of work.", 14)
          ], { layout: "vertical", gap: 10 }),
          frame("spacesRow", "fill_container", "fit_content", [
            card("c1"), card("c2"), card("c3"), card("c4")
          ], { layout: "horizontal", gap: 20 })
        ], { layout: "vertical", padding: [80, 64] })
      ], { width: 1440, height: 1800 })
    );
    expectFinding(glued, "heading_content_gap", {
      nodeId: "spacesBand",
      severity: "warning",
      message: /heading.*grid|grid.*heading/i
    });

    const spaced = makeDoc(
      screen("desktop", [
        frame("spacesBand", 1312, "fit_content", [
          frame("spacesHead", "fill_container", "fit_content", [
            txt("spacesOverline", "THE SPACES", 12),
            txt("spacesTitle", "Four rooms, one unhurried pace.", 28)
          ], { layout: "vertical", gap: 10 }),
          frame("spacesRow", "fill_container", "fit_content", [
            card("c1"), card("c2"), card("c3"), card("c4")
          ], { layout: "horizontal", gap: 20 })
        ], { layout: "vertical", gap: 32, padding: [80, 64] })
      ], { width: 1440, height: 1800 })
    );
    expect(rules(spaced)).not.toContain("heading_content_gap");
  });

  it("does not treat a hero title above a compact booking control as a glued section", () => {
    const hero = makeDoc(
      screen("desktop", [
        frame("heroLeft", 480, "fit_content", [
          txt("title", "A slower workday, held in a tiled house.", 44),
          frame("ctaRow", "fill_container", 48, [
            frame("b1", 140, 44, [txt("b1t", "Reserve", 14)], { layout: "horizontal" }),
            frame("b2", 140, 44, [txt("b2t", "View", 14)], { layout: "horizontal" })
          ], { layout: "horizontal", gap: 12 })
        ], { layout: "vertical", gap: 16 })
      ], { width: 1440, height: 900 })
    );
    expect(rules(hero)).not.toContain("heading_content_gap");
  });

  it("holds glued section headings for the finishing pass", () => {
    expect(FINISHING_RULES.has("heading_content_gap")).toBe(true);
    expect(FINISHING_RULES.has("eyebrow_kicker")).toBe(false);
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

  it("permits intentional 1440x480 panoramic banners without crop warning", () => {
    const bannerDoc = makeDoc(
      screen("desktop", [
        frame("banner", 1440, 480, [], { fill: { type: "image", url: "hero.png" } })
      ], { width: 1440, height: 900 })
    );
    const cropFindings = audit(bannerDoc).filter((f) => f.rule === "cropped_photography");
    expect(cropFindings).toHaveLength(0);
  });

  it("blocks the same solid primary action repeated across a site", () => {
    const repeatedActions = makeDoc(
      screen("desktop", [
        frame("hero_cta", 220, 48, [txt("hero_label", "Check availability", 14)], {
          name: "Hero CTA", fill: "$accent-primary", layout: "horizontal"
        }),
        frame("footer_cta", 220, 48, [txt("footer_label", "Check availability", 14)], {
          name: "Footer CTA", fill: "$accent-primary", layout: "horizontal"
        })
      ], { width: 1440, height: 900 })
    );
    expectFinding(repeatedActions, "repeated_primary_action", {
      severity: "blocker",
      nodeId: "footer_cta",
      message: "appears 2 times"
    });
  });

  it("blocks a non-hero support photograph that consumes most of a desktop viewport", () => {
    const wall = makeDoc(
      screen("desktop", [
        frame("support_photo", 1376, 774, [], {
          name: "Support Image", fill: { type: "image", url: "room.png" }
        })
      ], { width: 1440, height: 1200 })
    );
    expectFinding(wall, "supporting_image_wall", {
      severity: "blocker",
      nodeId: "support_photo",
      message: "1376x774"
    });
  });

  it("flags staggered button baselines in horizontal card rows", () => {
    const cardsDoc = makeDoc(
      screen("desktop", [
        frame("card_row", 1200, "fit_content", [
          frame("card1", 380, 400, [
            txt("title1", "Plan A", 20),
            frame("btn1", "fill_container", 44, [txt("btntxt1", "Buy", 14)], { name: "CTA Button", layoutPosition: "absolute", x: 20, y: 340 } as any)
          ], { layout: "none" }),
          frame("card2", 380, 430, [
            txt("badge2", "POPULAR", 12),
            txt("title2", "Plan B", 20),
            frame("btn2", "fill_container", 44, [txt("btntxt2", "Buy", 14)], { name: "CTA Button", layoutPosition: "absolute", x: 20, y: 370 } as any)
          ], { layout: "none" })
        ], { layout: "horizontal", gap: 20 })
      ], { width: 1440, height: 900 })
    );
    expectFinding(cardsDoc, "misaligned_buttons", {
      severity: "warning",
      message: "staggered vertically"
    });
  });

  it("flags overflowing segmented pills in pill switchers", () => {
    const pillDoc = makeDoc(
      screen("desktop", [
        frame("switcher", 300, 44, [
          frame("p1", 120, 36, [txt("t1", "Day Pass", 13)]),
          frame("p2", 120, 36, [txt("t2", "5-Day Pack", 13)]),
          frame("p3", 120, 36, [txt("t3", "Resident Desk", 13)])
        ], { name: "Segmented Pill Switcher", layout: "horizontal", gap: 8 })
      ], { width: 1440, height: 900 })
    );
    expectFinding(pillDoc, "overflow", {
      severity: "warning",
      message: "overflowing"
    });
  });


  it("flags uneven card heights in horizontal comparison rows", () => {
    const cardsDoc = makeDoc(
      screen("desktop", [
        frame("pricing_grid", 1200, "fit_content", [
          frame("card1", 380, 260, [txt("t1", "Day Pass", 20)], { name: "Card 1", fill: "$surface-secondary" }),
          frame("card2", 380, 360, [txt("t2", "Resident", 20)], { name: "Card 2", fill: "$surface-secondary" })
        ], { name: "Pricing Plans", layout: "horizontal", gap: 20 })
      ], { width: 1440, height: 900 })
    );
    expectFinding(cardsDoc, "uneven_card_heights", {
      severity: "warning",
      message: "uneven heights"
    });
  });

  it("does not flag asymmetric hero/image, copy/form, or footer splits as uneven card heights", () => {
    const splitDoc = makeDoc(
      screen("desktop", [
        // 1. Hero split: text column vs photo column
        frame("hero_split", "fill_container", "fit_content", [
          frame("hero_text", 560, 480, [txt("title", "Casa Alfama", 48)], { layout: "vertical" }),
          frame("hero_photo", 520, 585, [], { fill: "$surface-secondary" })
        ], { name: "Hero Split", layout: "horizontal", gap: 48 }),

        // 2. Availability / Booking split: explanatory copy vs booking form
        frame("avail_split", "fill_container", "fit_content", [
          frame("avail_copy", 500, 220, [txt("p", "Reserve your desk", 24)], { layout: "vertical" }),
          frame("avail_form", 520, 340, [], { layout: "vertical", stroke: "$border-subtle" })
        ], { name: "Availability Split", layout: "horizontal", gap: 40 }),

        // 3. Footer split: brand column vs 3-column navigation
        frame("footer_nav_row", "fill_container", "fit_content", [
          frame("col1", 140, 160, [txt("l1", "Home", 14), txt("l2", "Atelier", 14)], { layout: "vertical" }),
          frame("col2", 140, 240, [txt("l3", "Press", 14), txt("l4", "Careers", 14), txt("l5", "Journal", 14)], { layout: "vertical" })
        ], { name: "Footer Nav", layout: "horizontal", gap: 32 })
      ], { width: 1440, height: 900 })
    );
    expect(rules(splitDoc)).not.toContain("uneven_card_heights");
  });

  it("flags stray orphan punctuation characters", () => {
    const strayDoc = makeDoc(
      screen("desktop", [
        frame("card", 380, 200, [
          txt("title", "Fast Wi-Fi", 16),
          txt("orphan", "-", 14)
        ], { layout: "vertical", gap: 8 })
      ], { width: 1440, height: 900 })
    );
    expectFinding(strayDoc, "stray_character", {
      severity: "warning",
      message: "stray placeholder character"
    });
  });

  it("flags inconsistent text alignment across form inputs in a card stack", () => {
    const formDoc = makeDoc(
      screen("desktop", [
        frame("card", 380, 200, [
          frame("row1", "fill_container", 44, [txt("t1", "Tue, 18 Jun", 14)], { name: "Date Input", layout: "horizontal", justifyContent: "center", stroke: "$border-subtle" } as any),
          frame("row2", "fill_container", 44, [txt("t2", "1 person", 14)], { name: "Guest Input", layout: "horizontal", justifyContent: "flex_start", stroke: "$border-subtle" } as any)
        ], { layout: "vertical", gap: 10 })
      ], { width: 1440, height: 900 })
    );
    expectFinding(formDoc, "misaligned_inputs", {
      severity: "warning",
      message: "inconsistent alignment"
    });
  });

  it("does not classify booking grouping rows containing child controls as misaligned inputs", () => {
    const bookingDoc = makeDoc(
      screen("desktop", [
        frame("booking_panel", 480, "fit_content", [
          // Field Row 1: grouping row holding 2 date field children
          frame("field_row_1", "fill_container", 48, [
            frame("date_in", 200, 44, [txt("t_in", "Check in", 14)], { layout: "horizontal", stroke: "$border-subtle" }),
            frame("date_out", 200, 44, [txt("t_out", "Check out", 14)], { layout: "horizontal", stroke: "$border-subtle" })
          ], { name: "Field Row 1", layout: "horizontal", justifyContent: "space_between" } as any),
          // Guests Row: grouping row holding a label and a stepper button container
          frame("guests_row", "fill_container", 48, [
            txt("g_lbl", "1 Resident", 14),
            frame("stepper", 100, 36, [txt("minus", "-", 14), txt("plus", "+", 14)], { layout: "horizontal", justifyContent: "center" })
          ], { name: "Guests Row", layout: "horizontal", justifyContent: "space_between" } as any)
        ], { name: "Booking Card", layout: "vertical", gap: 16 })
      ], { width: 1440, height: 900 })
    );
    expect(rules(bookingDoc)).not.toContain("misaligned_inputs");
  });

  it("does not classify ordinary content and action rows as form inputs", () => {
    const builder = makeDoc(
      screen("mobile", [
        frame("box", 350, "fit_content", [
          frame("item", "fill_container", 56, [txt("name", "Matcha slice", 15)], {
            name: "Builder row", layout: "horizontal", justifyContent: "space_between", stroke: "$border-subtle"
          } as any),
          frame("add", "fill_container", 44, [txt("add-label", "+ Add another flavor", 14)], {
            name: "Builder add row", layout: "horizontal", justifyContent: "center", stroke: "$border-subtle"
          } as any)
        ], { name: "Box builder", layout: "vertical", gap: 12 })
      ], { width: 390, height: 900 })
    );
    expect(rules(builder)).not.toContain("misaligned_inputs");
  });

  it("flags mobile tab bar swipe screens that expand beyond the 844px device viewport", () => {
    const tallMobileDoc = makeDoc(
      frame("screen", 390, 1100, [
        frame("content", "fill_container", 950, [
          txt("title", "Purrfect", 24),
          frame("actionDock", "fill_container", 64, [], { name: "Swipe Action Dock" })
        ], { layout: "vertical" }),
        frame("tabBar", "fill_container", 56, [], { name: "Tab Bar", metadata: { scaffold: "chrome" } } as any)
      ], { name: "Swipe Screen", layout: "vertical", metadata: { screenKind: "mobile" } } as any)
    );
    expectFinding(tallMobileDoc, "oversized_section_height", {
      severity: "blocker",
      message: /844px device viewport|844px fold|pushing the action/
    });
  });

  it("allows scrollable multi-item food ordering store feeds with tab navigation to be tall", () => {
    const tallStoreDoc = makeDoc(
      frame("screen", 390, 1350, [
        frame("header", "fill_container", 60, [txt("brand", "Moss & Crumb", 20)], { layout: "horizontal" }),
        frame("hero", "fill_container", 280, [txt("heroTitle", "Matcha magic", 24)], { layout: "vertical" }),
        frame("productGrid", "fill_container", 400, [
          frame("card1", 170, 180, [txt("t1", "Pistachio cloud", 16)], { name: "Product Card 1" }),
          frame("card2", 170, 180, [txt("t2", "Yuzu green tea", 16)], { name: "Product Card 2" })
        ], { name: "Product Collection Grid", layout: "horizontal" }),
        frame("tabBar", "fill_container", 56, [], { name: "Tab Bar", metadata: { scaffold: "chrome" } } as any)
      ], { name: "Home Feed", layout: "vertical", metadata: { screenKind: "mobile" } } as any)
    );
    expect(rules(tallStoreDoc)).not.toContain("oversized_section_height");
  });

  it("flags empty product card placeholder image wells with missing_product_image blocker", () => {
    const cardWithEmptyWell = makeDoc(
      frame("screen", 390, 844, [
        frame("card", 170, 200, [
          frame("imageWell", 160, 80, [], { name: "Image Well", fill: "$surface-secondary" }),
          txt("title", "Pistachio cloud", 16),
          txt("price", "€8.50", 14)
        ], { name: "Product Card", layout: "vertical" })
      ], { name: "Home", layout: "vertical" })
    );
    expectFinding(cardWithEmptyWell, "missing_product_image", {
      severity: "blocker",
      message: /placeholder box/
    });
  });

  it("blocks false floor on scrollable mobile feeds when section 2 is pushed below 844px", () => {
    const falseFloorDoc = makeDoc(
      frame("screen", 390, 1400, [
        frame("header", "fill_container", 60, [txt("brand", "MORI", 20)], { layout: "horizontal" }),
        frame("giantHero", "fill_container", 750, [
          txt("heroTitle", "A little green joy, made to share.", 32),
          frame("heroPhoto", "fill_container", 400, [], { fill: { type: "image", url: "cake.png" } })
        ], { name: "Hero Card", layout: "vertical" }),
        frame("productGrid", "fill_container", 400, [
          frame("card1", 170, 180, [txt("t1", "Cake A", 16)])
        ], { name: "Product Grid", layout: "horizontal" })
      ], { name: "Home Feed", layout: "vertical", metadata: { screenKind: "mobile" } } as any)
    );
    expectFinding(falseFloorDoc, "false_floor", {
      severity: "blocker",
      message: /creates a false floor|844px fold/
    });
  });

  it("does not treat a thin quote bar as the fold peek on a desktop site", () => {
    // 3fbe82f2: an 80px black quote peeked above 900px while rooms sat below.
    const site = makeDoc(
      screen("desktop", [
        frame("main", 1440, "fit_content", [
          frame("hero", 1440, 800, [txt("h", "Make room for your best work in Lisbon", 48)], {
            name: "Hero",
            layout: "vertical"
          }),
          frame("quote", 1440, 80, [txt("q", "The best workday leaves a little room for the city", 18)], {
            name: "Quote",
            layout: "vertical"
          }),
          frame("rooms", 1440, 420, [
            frame("card1", 400, 380, [txt("c1", "The Quiet Desk", 22)]),
            frame("card2", 400, 380, [txt("c2", "The Courtyard Table", 22)])
          ], { name: "Rooms", layout: "horizontal" })
        ], { name: "Main", layout: "vertical", metadata: { scaffold: "slot" } as any })
      ], { width: 1440, height: 2200 })
    );
    expectFinding(site, "false_floor", {
      severity: "blocker",
      message: /900px fold|do not delete Main/i
    });
  });

  it("blocks oversized hero and false floor inside scaffolded Inset Content", () => {
    const scaffoldedDoc = makeDoc(
      frame("screen", 390, 1600, [
        frame("sb", "fill_container", 62, [], { name: "Status Bar", metadata: { scaffold: "chrome" } } as any),
        frame("inset", "fill_container", "fit_content", [
          frame("home", "fill_container", "fit_content", [
            frame("topBar", "fill_container", 56, [txt("title", "Matcha Moon", 20)], { name: "Top Bar", layout: "horizontal" }),
            frame("search", "fill_container", 56, [txt("q", "Search", 14)], { name: "Search Bar", layout: "horizontal" }),
            frame("hero", "fill_container", 660, [
              txt("t", "Whisked for your little joy", 28, { width: "fill_container" } as any),
              frame("img", "fill_container", 320, [], { fill: { type: "image", url: "cake.png" } })
            ], { name: "Seasonal Hero", layout: "vertical" }),
            frame("catalog", "fill_container", 450, [
              txt("sub", "Pick your slice", 22),
              frame("card", 160, 200, [], { fill: { type: "image", url: "p1.png" } })
            ], { name: "Product Grid", layout: "vertical" })
          ], { name: "Home Content", layout: "vertical", gap: 16 })
        ], { name: "Inset Content", metadata: { scaffold: "slot" } } as any),
        frame("tabBar", "fill_container", 56, [], { name: "Tab Bar", metadata: { scaffold: "chrome" } } as any)
      ], { name: "Matcha Moon", layout: "vertical", metadata: { screenKind: "mobile" } } as any)
    );
    expectFinding(scaffoldedDoc, "false_floor", { severity: "blocker" });
    expectFinding(scaffoldedDoc, "oversized_section_height", { severity: "blocker" });
  });

  it("finds an oversized hero inside a Storefront Content wrapper with short utility rows", () => {
    const storefrontDoc = makeDoc(frame("screen", 390, 1448, [
      frame("storefront", "fill_container", "fit_content", [
        frame("header", "fill_container", 44, [txt("brand", "Mori & Moss", 20)], { name: "Header" }),
        frame("search", "fill_container", 48, [txt("query", "What are you craving?", 14)], { name: "Search" }),
        frame("hero", "fill_container", 574, [
          txt("headline", "A little matcha magic, made to order.", 44),
          frame("photo", "fill_container", 250, [], { fill: { type: "image", url: "cake.png" } })
        ], { name: "Featured Hero", layout: "vertical" }),
        frame("products", "fill_container", 300, [
          frame("card-a", 170, 280, [txt("a", "Yuzu Cloud", 16)]),
          frame("card-b", 170, 280, [txt("b", "Black Sesame", 16)])
        ], { name: "Product Grid", layout: "horizontal" })
      ], { name: "Storefront Content", layout: "vertical", gap: 16 })
    ], { name: "Matcha Cakes", layout: "vertical", metadata: { screenKind: "mobile" } } as any));

    expectFinding(storefrontDoc, "oversized_section_height", {
      nodeId: "hero",
      severity: "blocker"
    });
  });

  it("does not exempt a tall hero merely because it has photo and action frames", () => {
    const heroWithStructuralFrames = makeDoc(frame("screen", 390, 1300, [
      frame("stack", "fill_container", "fit_content", [
        frame("hero", "fill_container", 520, [
          txt("hero-title", "A quieter kind of cake", 36),
          frame("photo", "fill_container", 260, [], {
            name: "Hero Photo Well",
            fill: { type: "image", url: "cake.png" }
          }),
          frame("action-row", "fill_container", 48, [txt("price", "€18", 16)], {
            name: "Hero Action Row",
            layout: "horizontal"
          })
        ], { name: "Seasonal Hero", layout: "vertical" }),
        frame("catalog", "fill_container", 320, [
          frame("product-a", 170, 280, [], { name: "Product Card A" }),
          frame("product-b", 170, 280, [], { name: "Product Card B" })
        ], { name: "Product Grid", layout: "horizontal" })
      ], { name: "Storefront Stack", layout: "vertical" })
    ], { metadata: { screenKind: "mobile" }, layout: "vertical" } as any));
    expectFinding(heroWithStructuralFrames, "oversized_section_height", {
      nodeId: "hero",
      severity: "blocker"
    });
  });

  it("does not treat a 650px photo story on a scrolling desktop site as an oversized card", () => {
    const site = makeDoc(
      screen("desktop", [
        frame("main", 1440, "fit_content", [
          frame("hero", 1440, 520, [txt("h", "Work at Lisbon's pace", 48)], { name: "Hero", layout: "vertical" }),
          frame("story", 1440, 680, [
            txt("st", "A day at Calma", 28),
            frame("p1", 400, 480, [], { fill: { type: "image", url: "a.jpg" } }),
            frame("p2", 400, 480, [], { fill: { type: "image", url: "b.jpg" } })
          ], { name: "Story", layout: "vertical" }),
          frame("pricing", 1440, 400, [txt("pr", "Day pass", 22)], { name: "Pricing" })
        ], { name: "Main", layout: "vertical" })
      ], { width: 1440, height: 2200 })
    );
    expect(rules(site)).not.toContain("oversized_section_height");
  });

  it("warns about inconsistent action styles across sibling cards in a row", () => {
    const asymmetricCardsDoc = makeDoc(
      screen("mobile", [
        frame("grid", "fill_container", "fit_content", [
          frame("card1", 170, 240, [
            txt("t1", "Pistachio Picnic", 16),
            frame("addBtn", 36, 36, [txt("p1", "+", 14)], { name: "Add Button", fill: "$accent-primary", cornerRadius: 999 })
          ], { name: "Product Card 1", layout: "vertical" }),
          frame("card2", 170, 240, [
            txt("t2", "Yuzu Matcha Cloud", 16),
            txt("nakedPlus", "+", 18, { fill: "$foreground-primary" } as any)
          ], { name: "Product Card 2", layout: "vertical" })
        ], { name: "Product Row", layout: "horizontal", gap: 12 })
      ], { width: 390, height: 844 })
    );
    expectFinding(asymmetricCardsDoc, "inconsistent_card_actions", {
      severity: "warning",
      message: /inconsistent action style/
    });
  });

  it("does not flag informational card rows where cards intentionally have no buttons", () => {
    const noActions = makeDoc(screen("mobile", [
      frame("grid", "fill_container", "fit_content", [
        frame("card1", 170, 240, [txt("t1", "Quiet Studio", 16)], { name: "Card 1" }),
        frame("card2", 170, 240, [txt("t2", "Garden Loft", 16)], { name: "Card 2" })
      ], { name: "Spaces Row", layout: "horizontal", gap: 12 })
    ], { width: 390, height: 844 }));
    expect(rules(noActions)).not.toContain("inconsistent_card_actions");
  });
});
