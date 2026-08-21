import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeDoc, frame, txt, rect } from "./harness";
import { layoutDocument } from "../src/layout/layout";
import {
  auditDesign,
  auditDocument,
  auditInsertion,
  formatAudit,
  contrastRatio,
  type AuditRule
} from "../src/design/evaluator";
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
  HARD_SHADOW_ELEVATION,
  dealTypefaces
} from "../src/design/styleSystem";
import { effectSchema } from "../src/model/parse";
import { agentSystemPrompt } from "../src/agent/prompt";
import {
  recordRun,
  avoidanceNote,
  loadHistory,
  HISTORY_LIMIT,
  type StyleRun
} from "../src/design/history";
import { createDocumentTools } from "../src/agent/tools";
import type { Document } from "../src/model/types";

function audit(doc: Document, targetId?: string) {
  return auditDesign(layoutDocument(doc), doc, targetId);
}
function rules(doc: Document, targetId?: string): AuditRule[] {
  return audit(doc, targetId).map((f) => f.rule);
}

/** A small screen that every rule should stay silent about. */
function healthyScreen(): Document {
  const doc = makeDoc(
    frame("screen", 390, "fit_content", [
      frame(
        "wrapper",
        "fill_container",
        "fit_content",
        [
          txt("title", "Today", 28, { fill: "$foreground-primary", fontWeight: "700" }),
          txt("body", "Four things need attention.", 14, { fill: "$foreground-secondary" }),
          frame("primary action", "fill_container", 48, [txt("cta", "Review all", 15, { fill: "#FFFFFF" })], {
            layout: "horizontal",
            justifyContent: "center",
            alignItems: "center",
            fill: "$accent-primary",
            cornerRadius: 12
          })
        ],
        { layout: "vertical", gap: 24, padding: [0, 20] }
      )
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

describe("Design audit — every rule must be able to fail", () => {
  // A check that cannot fail is not a check. Each case below injects one fault
  // and asserts the rule names the node and reports the numbers behind it.

  it("stays silent on a healthy screen", () => {
    expect(audit(healthyScreen())).toEqual([]);
  });

  it("clipped: reports the overflow amount and both boxes", () => {
    // The defect from the screenshot: a fixed-height box around text that
    // does not fit inside it.
    const doc = makeDoc(
      frame("card", 200, 40, [txt("bio", "A line of copy that is far too long for this box", 14)], {
        layout: "vertical",
        clip: true
      })
    );
    const found = audit(doc).find((f) => f.rule === "clipped");
    expect(found).toBeDefined();
    expect(found!.nodeId).toBe("bio");
    expect(found!.message).toMatch(/\d+px past the (right|bottom) edge/);
    expect(found!.message).toContain("clipped");
  });

  it("clipped: tells fixed mobile screens to reduce content, not resize the root", () => {
    const doc = makeDoc(frame("screen", 390, 844, [rect("content", 390, 900)], {
      layout: "vertical",
      clip: true,
      metadata: { screenKind: "mobile" }
    }));
    const found = audit(doc).find((f) => f.rule === "clipped");

    expect(found?.fix).toContain("fixed mobile screen size");
    expect(found?.fix).not.toContain("fit_content");
  });

  it("clipped: does not fire when a shape bleeds out of an unclipped parent", () => {
    // Deliberate composition. A shape hanging outside an unclipped frame is a
    // decision, so the audit leaves it alone.
    const doc = makeDoc(
      frame("card", 200, 40, [rect("photo", 320, 200)], { layout: "none", clip: false })
    );
    expect(audit(doc).some((f) => f.rule === "clipped")).toBe(false);
  });

  it("clipped: fires when text overruns an unclipped parent", () => {
    // The match-row defect: the text box auto-grows past the card, so it never
    // overflows its own box and the row never clips. The sentence still runs
    // out from under its container.
    const doc = makeDoc(
      frame("card", 200, 40, [txt("bio", "A line of copy that is far too long for this box", 14)], {
        layout: "vertical",
        clip: false
      })
    );
    const found = audit(doc).find((f) => f.rule === "clipped");
    expect(found?.severity).toBe("blocker");
    expect(found?.message).toContain("runs outside its container");
  });

  it("clipped: ignores a disabled overflowing child", () => {
    const doc = makeDoc(
      frame("card", 80, 80, [rect("r", 200, 200, { enabled: false })], { layout: "none", clip: true })
    );
    expect(audit(doc).some((f) => f.rule === "clipped")).toBe(false);
  });

  it("collision: ignores a disabled sibling", () => {
    const doc = makeDoc(
      frame("canvas", 200, 200, [
        rect("a", 50, 50, { x: 10, y: 10, enabled: false }),
        rect("b", 50, 50, { x: 20, y: 20 })
      ], { layout: "none" })
    );
    expect(audit(doc).some((f) => f.rule === "collision")).toBe(false);
  });

  it("collision: ignores collisions inside a disabled frame", () => {
    const doc = makeDoc(
      frame("hidden", 200, 200, [
        rect("a", 50, 50, { x: 10, y: 10 }),
        rect("b", 50, 50, { x: 20, y: 20 })
      ], { layout: "none", enabled: false })
    );
    expect(audit(doc).some((f) => f.rule === "collision")).toBe(false);
  });

  it("collision: reports an absolute node that only partly overlaps a sibling", () => {
    const doc = makeDoc(
      frame("canvas", 200, 200, [
        rect("a", 50, 50, { x: 10, y: 10 }),
        rect("b", 50, 50, { x: 20, y: 20, layoutPosition: "absolute" })
      ], { layout: "none" })
    );
    expect(audit(doc).some((f) => f.rule === "collision")).toBe(true);
  });

  it("collision: exempts an absolute overlay contained by its sibling", () => {
    const doc = makeDoc(
      frame("canvas", 200, 200, [
        rect("photo", 120, 120, { x: 10, y: 10 }),
        rect("caption", 80, 30, { x: 30, y: 90, layoutPosition: "absolute" })
      ], { layout: "none" })
    );
    expect(audit(doc).some((f) => f.rule === "collision")).toBe(false);
  });

  it("text_clipped: catches a sentence that never wraps", () => {
    // The defect that shipped as "...loves morning gallops in open past". The
    // node fits its parent, so the box check is blind to it; only comparing the
    // text's own width against its box finds it.
    const sentence = "Gentle temperament, loves morning gallops in open pastures.";
    const doc = makeDoc(
      frame("card", 320, "fit_content", [txt("bio", sentence, 12, { width: "fill_container" })], {
        layout: "vertical"
      })
    );
    const found = audit(doc).find((f) => f.rule === "text_clipped");
    expect(found).toBeDefined();
    expect(found!.nodeId).toBe("bio");
    expect(found!.message).toMatch(/needs \d+px on one line but its box is \d+px/);
    expect(found!.fix).toContain("textGrowth: 'fixed-width'");

    // Declaring the wrap resolves it.
    const wrapped = makeDoc(
      frame("card", 320, "fit_content", [
        txt("bio", sentence, 12, { width: "fill_container", textGrowth: "fixed-width" })
      ], { layout: "vertical" })
    );
    expect(rules(wrapped)).not.toContain("text_clipped");
  });

  it("empty_text: catches a text node whose copy was dropped", () => {
    const doc = makeDoc(frame("s", 300, 200, [txt("t", "", 14)]));
    const found = audit(doc).find((f) => f.rule === "empty_text");
    expect(found).toBeDefined();
    expect(found!.fix).toContain("`content`");
  });

  it("collision: names both siblings", () => {
    const doc = makeDoc(
      frame("canvas", 200, 200, [rect("a", 50, 50, { x: 10, y: 10 }), rect("b", 50, 50, { x: 20, y: 20 })], {
        layout: "none"
      })
    );
    const found = audit(doc).find((f) => f.rule === "collision");
    expect(found).toBeDefined();
    expect(found!.message).toContain("b");
  });

  it("text_too_small: blocks below the readable floor and warns below the house standard", () => {
    const blocker = audit(makeDoc(frame("s", 200, 200, [txt("t", "Tiny", 7)]))).find(
      (f) => f.rule === "text_too_small" && f.severity === "blocker"
    );
    expect(blocker).toBeDefined();
    expect(blocker!.message).toContain("7px");

    const warning = audit(makeDoc(frame("s", 200, 200, [txt("t", "Small", 10)]))).find(
      (f) => f.rule === "text_too_small" && f.severity === "warning"
    );
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("10px");
  });

  it("low_contrast: reports the measured ratio and the required one", () => {
    const doc = makeDoc(
      frame("s", 300, 200, [txt("t", "Barely there", 14, { fill: "#BBBBBB" })], { fill: "#FFFFFF" })
    );
    const found = audit(doc).find((f) => f.rule === "low_contrast");
    expect(found).toBeDefined();
    expect(found!.message).toMatch(/measures \d+\.\d+:1/);
    expect(found!.message).toContain("4.5:1 is required");
  });

  it("low_contrast: resolves tokens rather than giving up on them", () => {
    const doc = makeDoc(frame("s", 300, 200, [txt("t", "Token text", 14, { fill: "$fg" })], { fill: "$bg" }));
    doc.variables = { bg: { type: "color", value: "#FFFFFF" }, fg: { type: "color", value: "#CCCCCC" } };
    expect(rules(doc)).toContain("low_contrast");
  });

  it("low_contrast: exempts text sitting on a photograph", () => {
    const doc = makeDoc(
      frame("s", 300, 200, [txt("t", "On a photo", 14, { fill: "#FFFFFF" })], {
        fill: { type: "image", url: "https://example.test/p.jpg" }
      })
    );
    expect(rules(doc)).not.toContain("low_contrast");
  });

  it("tap_target: reports the measured size against the minimum", () => {
    const doc = makeDoc(
      frame("s", 300, 200, [frame("like", 28, 28, [], { name: "Like Button", fill: "$accent-primary" })])
    );
    const found = audit(doc).find((f) => f.rule === "tap_target");
    expect(found).toBeDefined();
    expect(found!.message).toContain("28x28px");
    expect(found!.message).toContain("44x44px");
  });

  it("empty_container: reports the size of the empty box", () => {
    const doc = makeDoc(frame("s", 400, 400, [frame("photo", 200, 200, [], { name: "Photo" })]));
    const found = audit(doc).find((f) => f.rule === "empty_container");
    expect(found).toBeDefined();
    expect(found!.message).toContain("200x200px");
  });

  it("token_bypass: fires on a literal colour when tokens exist, and not otherwise", () => {
    const withTokens = makeDoc(frame("s", 200, 200, [rect("r", 50, 50, { fill: "#334155" })]));
    withTokens.variables = { "surface-primary": { type: "color", value: "#FFFFFF" } };
    const found = audit(withTokens).find((f) => f.rule === "token_bypass");
    expect(found).toBeDefined();
    expect(found!.message).toContain("#334155");

    const noTokens = makeDoc(frame("s", 200, 200, [rect("r", 50, 50, { fill: "#334155" })]));
    expect(rules(noTokens)).not.toContain("token_bypass");
  });

  it("type_scale, spacing_scale and radius_scale fire on undisciplined values", () => {
    const doc = makeDoc(
      frame(
        "s",
        400,
        "fit_content",
        [
          ...[32, 27, 23, 19, 17, 15, 13, 11].map((size, i) => txt(`t${i}`, "x", size)),
          frame("a", 100, 40, [], { gap: 7, padding: 13, cornerRadius: 3 }),
          frame("b", 100, 40, [], { gap: 9, cornerRadius: 5 }),
          frame("c", 100, 40, [], { cornerRadius: 7 }),
          frame("d", 100, 40, [], { cornerRadius: 9 }),
          frame("e", 100, 40, [], { cornerRadius: 11 }),
          frame("f", 100, 40, [], { cornerRadius: 13 })
        ],
        { layout: "vertical" }
      )
    );
    const found = rules(doc);
    expect(found).toContain("type_scale");
    expect(found).toContain("spacing_scale");
    expect(found).toContain("radius_scale");
  });

  it("spacing_scale lets an even value pass and reports an odd one", () => {
    // Measured over 24 runs, 90% of the spacing a model writes is already on the
    // 4px grid, so holding it to 4 fired on nearly every screen. A rule that
    // fires every time is one the model learns to spend a turn on and ignore.
    const even = makeDoc(frame("s", 400, "fit_content", [
      frame("a", 100, 40, [], { gap: 10, padding: 14 }),
      frame("b", 100, 40, [], { gap: 6 })
    ], { name: "Home", layout: "vertical" }));
    expect(auditDesign(layoutDocument(even), even).filter((f) => f.rule === "spacing_scale")).toEqual([]);

    const odd = makeDoc(frame("s", 400, "fit_content", [
      frame("a", 100, 40, [], { gap: 7, padding: 15 })
    ], { name: "Home", layout: "vertical" }));
    const hits = auditDesign(layoutDocument(odd), odd).filter((f) => f.rule === "spacing_scale");
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("odd spacing");
  });

  it("spacing_scale reports a screen with no scale at all", () => {
    const kids = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28].map((v, i) =>
      frame(`f${i}`, 100, 40, [], { gap: v })
    );
    const doc = makeDoc(frame("s", 400, "fit_content", kids, { name: "Home", layout: "vertical" }));
    const hits = auditDesign(layoutDocument(doc), doc).filter((f) => f.rule === "spacing_scale");
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("distinct spacing values");
  });

  it("nested_screen: does not call a top bar a nested screen", () => {
    // Widening screen detection to cover desktop made a "Top Bar" holding
    // anything else named like a bar read as a screen inside its own screen.
    const doc = makeDoc(
      frame("s", 1440, 1024, [
        frame("top", "fill_container", 64, [
          frame("topActions", 200, 40, [], { name: "Top Bar Actions" })
        ], { name: "Top Bar", layout: "horizontal" })
      ], { name: "Support Triage", layout: "vertical" })
    );
    expect(auditDesign(layoutDocument(doc), doc).filter((f) => f.rule === "nested_screen")).toEqual([]);
  });

  it("nested_screen: catches a screen built inside another screen", () => {
    // The failure this came from: all three screens were authored as one tree,
    // so the first screen grew to 1972px tall and none of them read as a device.
    const inner = frame("inner", 390, "fit_content", [frame("sb2", "fill_container", 62, [], { name: "Status Bar" })], {
      name: "Profile",
      layout: "vertical"
    });
    const doc = makeDoc(
      frame("outer", 390, "fit_content", [frame("sb1", "fill_container", 62, [], { name: "Status Bar" }), inner], {
        name: "Discover",
        layout: "vertical"
      })
    );
    const found = audit(doc).find((f) => f.rule === "nested_screen");
    expect(found).toBeDefined();
    expect(found!.nodeId).toBe("inner");
    expect(found!.message).toContain("Discover");

    // Side by side on the canvas is the correct shape and stays silent.
    const sideBySide = makeDoc(
      frame("a", 390, "fit_content", [frame("sb1", "fill_container", 62, [], { name: "Status Bar" })], {
        layout: "vertical"
      }),
      frame("b", 390, "fit_content", [frame("sb2", "fill_container", 62, [], { name: "Status Bar" })], {
        layout: "vertical",
        x: 470
      })
    );
    expect(rules(sideBySide)).not.toContain("nested_screen");
  });

  it("duplicate_region: catches a screen with two tab bars", () => {
    const tabBar = (id: string) =>
      frame(id, "fill_container", 56, [frame(`${id}i`, 40, 40, [])], { name: "Tab Bar", layout: "horizontal" });
    const doc = makeDoc(
      frame("screen", 390, "fit_content", [
        frame("sb", "fill_container", 62, [], { name: "Status Bar" }),
        frame("inset1", "fill_container", 68, [tabBar("tb1")], { name: "Tab Bar Inset" }),
        frame("inset2", "fill_container", 68, [tabBar("tb2")], { name: "Tab Bar Inset" })
      ], { name: "Discover", layout: "vertical" })
    );
    const found = audit(doc).find((f) => f.rule === "duplicate_region");
    expect(found).toBeDefined();
    expect(found!.message).toContain("2 tab bars");

    // One tab bar inside one inset wrapper is the correct shape.
    const single = makeDoc(
      frame("screen", 390, "fit_content", [
        frame("sb", "fill_container", 62, [], { name: "Status Bar" }),
        frame("inset1", "fill_container", 68, [tabBar("tb1")], { name: "Tab Bar Inset" })
      ], { name: "Discover", layout: "vertical" })
    );
    expect(rules(single)).not.toContain("duplicate_region");
  });

  it("off_canvas: reports negative root coordinates", () => {
    const doc = makeDoc(frame("s", 200, 200, [], { x: -40, y: 0 }));
    expect(rules(doc)).toContain("off_canvas");
  });
});

describe("Design audit — scoping", () => {
  // A scoped audit includes descendant findings, not only the target itself.
  const doc = makeDoc(
    frame("screen", 390, 600, [
      frame("card", 200, 40, [txt("bio", "A line of copy that is far too long for this box", 14)], {
        layout: "vertical",
        clip: true
      })
    ])
  );

  it("reports a descendant's clipping when scoped to its ancestor", () => {
    expect(rules(doc, "card")).toContain("clipped");
    expect(rules(doc, "screen")).toContain("clipped");
    expect(rules(doc)).toContain("clipped");
  });

  it("excludes nodes outside the scope", () => {
    const two = makeDoc(
      frame("a", 200, 40, [txt("t1", "A line of copy that is far too long for this box", 14)], {
        layout: "vertical",
        clip: true
      }),
      frame("b", 200, 40, [txt("t2", "A line of copy that is far too long for this box", 14)], {
        layout: "vertical",
        clip: true
      })
    );
    expect(audit(two, "a").map((f) => f.nodeId)).not.toContain("t2");
    expect(audit(two, "a").map((f) => f.nodeId)).toContain("t1");
  });

  it("formatAudit states the result without a score", () => {
    const clean = formatAudit([], "Audit");
    expect(clean).toContain("no findings");
    expect(clean).not.toContain("100");
    expect(formatAudit(audit(doc), "Audit")).not.toMatch(/\d+\/100/);
  });
});

describe("insert_node normalizes what the model wrote", () => {
  // A whole run produced 44 blank text nodes because the model wrote `text:`
  // and the schema reads `content:`. Nothing said so.
  it("renames a known alias and says that it did", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: {
        type: "frame",
        id: "screen",
        width: 390,
        height: 200,
        children: [{ type: "text", id: "t", text: "Hello", fontSize: 14 }]
      }
    });
    expect(result).toContain("text.text -> content");
    const inserted = (session.doc.children[0] as any).children[0];
    expect(inserted.content).toBe("Hello");
    expect(inserted.text).toBeUndefined();
  });

  it("drops a property the engine does not have, and warns", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: { type: "frame", id: "f", width: 100, height: 100, boxShadow: "0 0 4px red" }
    });
    expect(result).toContain("dropped 1 property");
    expect(result).toContain("frame.boxShadow");
    expect((session.doc.children[0] as any).boxShadow).toBeUndefined();
  });

  it("leaves a valid tree untouched", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: {
        type: "frame",
        id: "f",
        width: 100,
        height: 100,
        layout: "vertical",
        gap: 8,
        children: [{ type: "text", id: "t", content: "Hi", fontSize: 14, fill: "$foreground-primary" }]
      }
    });
    expect(result).not.toContain("note:");
    expect(result).not.toContain("warning:");
  });
});

describe("Style system", () => {
  it("deals a hand of palettes instead of printing the whole catalog", () => {
    const catalog = styleCatalog(12345);
    const offered = PALETTES.filter((p) => catalog.includes(`  ${p.name} (`));
    expect(offered).toHaveLength(PALETTE_HAND_SIZE);
    expect(PALETTES.length).toBeGreaterThan(PALETTE_HAND_SIZE * 3);
  });

  it("puts both light and dark on the table in every hand", () => {
    // Whether a product is dark is a question about where it is used. A hand
    // drawn from the whole list would be light nearly every time, so the two
    // schemes are dealt separately.
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
    // The convergence this replaces: every warm brief reached the same friendly
    // cream palette because every run saw the same list in the same order.
    const doc = makeDoc();
    const cats = agentSystemPrompt(doc, [], undefined, 101);
    const bank = agentSystemPrompt(doc, [], undefined, 202);
    expect(cats).not.toBe(bank);
  });

  it("every palette clears its contrast requirements", () => {
    // Palettes are shipped, not measured at runtime, so this is the only place
    // a bad pairing can be caught.
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
      palette: "Carbon Frost", roundness: "Basic", elevation: "Flat",
      headings: "Funnel Display", body: "Inter", captions: "Inter"
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
    // The catalog is dealt per run, so a rejection points back at the hand the
    // model was given rather than printing all fifty-one names — which would
    // hand back the whole catalog and undo the deal.
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
          expect(eff).toEqual(expect.objectContaining({
            type: "shadow",
            color: expect.any(String),
            x: expect.any(Number),
            y: expect.any(Number),
            blur: expect.any(Number),
            spread: expect.any(Number),
            enabled: true
          }));
          expect(eff).not.toHaveProperty("offset");
        }
      }
    }
  });
});

describe("accent_overuse", () => {
  function screen(id: string, accents: number) {
    const kids: any[] = [{ type: "frame", id: `${id}-sb`, name: "Status Bar", width: 390, height: 62, children: [] }];
    for (let i = 0; i < accents; i += 1) {
      kids.push({ type: "frame", id: `${id}-a${i}`, name: `Action ${i}`, width: 200, height: 48, fill: "$accent-primary", children: [] });
    }
    return { type: "frame", id, name: "Home", width: 390, height: 844, layout: "vertical", children: kids } as any;
  }

  it("passes one accent fill and fails four", () => {
    const one = makeDoc(screen("s1", 1));
    const four = makeDoc(screen("s1", 4));
    expect(auditDesign(layoutDocument(one), one).filter((f) => f.rule === "accent_overuse")).toEqual([]);
    const hits = auditDesign(layoutDocument(four), four).filter((f) => f.rule === "accent_overuse");
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("4 elements");
  });

  it("ignores the accent used as a text or icon colour", () => {
    const doc = makeDoc({
      type: "frame", id: "s1", name: "Home", width: 390, height: 844, layout: "vertical",
      children: [
        { type: "frame", id: "sb", name: "Status Bar", width: 390, height: 62, children: [] },
        { type: "frame", id: "cta", width: 200, height: 48, fill: "$accent-primary", children: [] },
        { type: "text", id: "t1", content: "Learn more", fontSize: 14, fill: "$accent-primary" },
        { type: "icon", id: "i1", icon: "heart", width: 22, height: 22, stroke: "$accent-primary" }
      ]
    } as any);
    expect(auditDesign(layoutDocument(doc), doc).filter((f) => f.rule === "accent_overuse")).toEqual([]);
  });
});

describe("composition expectations", () => {
  function mobile(content: any[], bleedHeight = 700): Document {
    return makeDoc({
      type: "frame", id: "screen", name: "Discover", width: 390, height: 844, layout: "vertical",
      children: [
        { type: "frame", id: "status", name: "Status Bar", width: 390, height: 62, children: [] },
        { type: "frame", id: "bleed", name: "Bleed Content", width: 390, height: bleedHeight, layout: "vertical", children: [
          { type: "frame", id: "inset", name: "Inset Content", width: 390, height: bleedHeight, layout: "vertical", children: content }
        ] },
        { type: "frame", id: "tabs", name: "Tab Bar Inset", width: 390, height: 82, children: [
          { type: "frame", id: "tab", name: "Tab Bar", width: 358, height: 56, children: [] }
        ] }
      ]
    } as any);
  }

  it("warns when a dominant image remains inset", () => {
    const doc = mobile([{ type: "frame", id: "photo", name: "Portrait", width: 350, height: 400, fill: { type: "image", url: "data:image/png;base64,xx" }, children: [] }]);
    const found = audit(doc).find((f) => f.rule === "missed_bleed");
    expect(found?.nodeId).toBe("photo");
    expect(found?.message).toContain("47% of the screen");
  });

  it("warns when composed content never reaches the display step", () => {
    const doc = mobile([txt("title", "Discover", 34)]);
    const found = audit(doc).find((f) => f.rule === "missing_display");
    expect(found?.nodeId).toBe("screen");
    expect(found?.message).toContain("34px");
  });

  it("warns when content ends more than fifteen percent before the tab bar", () => {
    const doc = mobile([frame("last-row", 350, 100, [txt("name", "Pippa", 16)], { fill: "$surface-secondary" })]);
    const found = audit(doc).find((f) => f.rule === "empty_tail");
    expect(found?.nodeId).toBe("screen");
    expect(found?.message).toMatch(/\d+px \(\d+%\) empty/);
  });
});

describe("collapsed_container: a frame that hides everything inside it", () => {
  it("blocks a container that resolves to zero while holding children", () => {
    // The gap that let a screen ship blank. checkOverflow skips any parent
    // measuring zero, so the twenty nodes hanging outside this one produced no
    // finding, and empty_container only ever looked at frames with no children
    // at all. The run that hit this ended with one unrelated collision reported
    // and a screen showing nothing but its status bar and tab bar.
    const doc = makeDoc(frame("screen", 390, 600, [
      frame("hero", 390, 0, [rect("photo", 390, 400)], { name: "Hero" })
    ], { layout: "vertical" }));

    const found = auditDesign(layoutDocument(doc), doc).find((f) => f.rule === "collapsed_container");
    expect(found).toBeDefined();
    expect(found!.severity).toBe("blocker");
    expect(found!.message).toContain("390x0px");
    expect(found!.message).toContain("1 child");
  });

  it("stays quiet on an empty frame, which is the other rule's business", () => {
    const doc = makeDoc(frame("screen", 390, 600, [
      frame("spacer", 390, 0, [], { name: "Spacer" })
    ], { layout: "vertical" }));
    expect(auditDesign(layoutDocument(doc), doc).some((f) => f.rule === "collapsed_container")).toBe(false);
  });

  it("ignores children that are switched off", () => {
    const doc = makeDoc(frame("screen", 390, 600, [
      frame("hero", 390, 0, [rect("photo", 390, 400, { enabled: false } as any)], { name: "Hero" })
    ], { layout: "vertical" }));
    expect(auditDesign(layoutDocument(doc), doc).some((f) => f.rule === "collapsed_container")).toBe(false);
  });
});

describe("empty_container reads the resolved box", () => {
  it("catches a fill_container frame, which the declared width could never see", () => {
    const doc = makeDoc({
      type: "frame", id: "screen", width: 390, height: 600, layout: "vertical",
      children: [{ type: "frame", id: "hole", name: "Gallery", width: "fill_container", height: 300, children: [] }]
    } as any);
    const hits = auditDesign(layoutDocument(doc), doc).filter((f) => f.rule === "empty_container");
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("390x300");
  });
});

describe("System prompt carries rules, not a design", () => {
  // The regression this guards: 59% of the prompt was once one finished screen,
  // written out to the pixel, and the model transcribed it instead of designing.
  const prompt = agentSystemPrompt(makeDoc(), [], "test-model");

  it("contains no product, no copy and no palette of its own", () => {
    const leakedFromATemplate = [
      "MANE",
      "Thunderbolt",
      "Arabian",
      "Grass-fed",
      "Grand Prix",
      "Carrot",
      "Portland",
      "Starlight",
      "Maya Bennett",
      "gallops",
      "Lorem"
    ];
    for (const literal of leakedFromATemplate) {
      expect(prompt).not.toContain(literal);
    }
  });

  it("contains no emoji, having told the model not to use them", () => {
    expect(prompt).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("asks for a style before anything is built", () => {
    expect(prompt).toContain("set_style");
    expect(prompt).toContain("No style is set on this document yet.");
  });

  it("lets the model distinguish design work from ordinary conversation", () => {
    expect(prompt).toContain("Decide whether the request requires design work");
    expect(prompt).toMatch(/Otherwise,\s+call answer_user/);
    expect(prompt).not.toContain("[no canvas change]");
  });

  it("requires real generated imagery for image-led products", () => {
    expect(prompt).toContain("product depends on photography or illustration");
    expect(prompt).toMatch(/call\s+generate_image/);
    expect(prompt).toContain("fixed device frame");
    expect(prompt).not.toContain("review_design");
  });

  it("names the template reflexes it refuses and exposes full-bleed composition", () => {
    expect(prompt).toContain("edge-to-edge imagery or colour in bleed");
    expect(prompt).toContain("Do not put an eyebrow or kicker above a heading");
    expect(prompt).toContain("same-size icon + heading + text cards");
    expect(prompt).toContain("nest cards inside cards");
    expect(prompt).toContain("at most two visible roles per screen");
    expect(prompt).toContain("gradient text");
    expect(prompt).toContain("decorative blobs");
    expect(prompt).toContain("blur as decoration");
    // The monospace reflex is refused at the point of choice instead — the
    // typeface catalog states the job beside the dealt face, which is a
    // stronger place for it than a prose rule the model reads once.
    expect(prompt).not.toContain("monospace as a costume");
  });

  it("separates inventing content from inventing a claim", () => {
    // OpenDesign blocks invented metrics at P0 while the rule here was telling
    // the model to invent numbers. A mockup needs plausible content and must
    // never carry a statistic nobody can source.
    expect(prompt).toMatch(/Invent the names, numbers and copy/);
    expect(prompt).toContain("Never invent a claim");
    expect(prompt).toContain("marketing, not content");
  });

  it("takes the colour scheme from the use scene rather than the category", () => {
    expect(prompt).toContain("Take light or dark from where the product is used");
  });

  it("tells the model it can name an icon without looking it up first", () => {
    // Observed: set_style then four search_icons rounds and nothing drawn.
    // Geometry resolves for any Lucide name at insert time, so the search was
    // a round-trip the model never needed to spend.
    expect(prompt).toContain("Write the name straight onto the node");
    expect(prompt).toContain("search_icons is only for a name you doubt exists");
  });

  it("states the tool budget instead of enforcing one it never mentioned", () => {
    expect(prompt).toContain("BUDGET");
    expect(prompt).toContain("Reuse ids from earlier tool results");
  });

  it("states the style rules once a style is chosen, and drops the catalog", () => {
    const doc = makeDoc();
    doc.metadata = {
      [STYLE_METADATA_KEY]: {
        palette: "Terminal Green",
        roundness: "Sharp",
        elevation: "Flat",
        headings: "Geist Mono",
        body: "Geist Mono",
        captions: "IBM Plex Mono"
      }
    };
    const styled = agentSystemPrompt(doc, [], "test-model");
    expect(styled).toContain("Terminal Green");
    expect(styled).not.toContain("No style is set");
    // The other eleven palettes are no longer worth their tokens.
    expect(styled).not.toContain("Deep Space Neon");
  });

  it("restates the recorded direction as a build contract", () => {
    const doc = makeDoc();
    doc.metadata = {
      [STYLE_METADATA_KEY]: {
        palette: "Terminal Green", roundness: "Sharp", elevation: "Flat",
        headings: "Geist Mono", body: "Geist Mono", captions: "IBM Plex Mono"
      },
      [DIRECTION_METADATA_KEY]: {
        thesis: "A command surface, not a card dashboard",
        ownWorld: "Black phosphor field with hard dividers",
        firstViewport: "A 56px alert over one dense queue"
      }
    };
    const styled = agentSystemPrompt(doc, [], "test-model");
    expect(styled).toContain("RECORDED DIRECTION CONTRACT");
    expect(styled).toContain("THESIS: A command surface, not a card dashboard");
    expect(styled).toContain("A claim not visible on the canvas is unfinished");
  });

  it("costs less than the template it replaced", () => {
    // The template prompt measured 10,451 characters. What this guards is that
    // the prompt stays rules and never drifts back into a worked example — the
    // ceiling is the evidence, not the exact number.
    //
    // Raised once from 9,000 when the prompt took on the icon rule, the tool
    // budget, and the split between inventing content and inventing a claim.
    // Guidance that only applies alongside findings went to formatAudit and the
    // correction message instead, which is where it costs nothing on the runs
    // that have no findings.
    //
    // Measured across seeds rather than on one, because the dealt palettes and
    // typefaces vary the length: a single seed passing this said nothing about
    // the seed next to it, and the widest hand was over the ceiling while the
    // fixed-seed assertion stayed green.
    const lengths = [...Array(60)].map((_, seed) =>
      agentSystemPrompt({ id: "d", name: "d", children: [] } as any, [], "test-model", seed).length
    );
    expect(Math.max(...lengths)).toBeLessThan(9500);
  });

  it("states the chrome once in code, not as numbers to remember on every run", () => {
    // These belong to create_screen now. A constant in a prompt is a request a
    // stochastic model answers most of the time; a constant in a tool is a fact.
    expect(prompt).toContain("create_screen");
    expect(prompt).not.toMatch(/height 56|height: 56|cornerRadius 9999/);
    expect(prompt).not.toMatch(/padding \[0, ?16, ?12, ?16\]/);
    expect(prompt).not.toMatch(/Status bar — height 62|height 62/);
  });
});

/* ------------------------------------------------------------------ *
 * The craft floor.
 *
 * Ported from Impeccable's craft-floor and OpenDesign's anti-AI-slop
 * list, which ship them as prose. Each case below injects the pattern
 * those documents name and asserts pen measures it instead.
 * ------------------------------------------------------------------ */

/** A screen shell the composition rules recognise, so screen-scoped rules run. */
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

describe("cloned_content", () => {
  const row = (id: string, name: string, meta: string) =>
    frame(id, "fill_container", "fit_content", [
      txt(`${id}_n`, name, 16, { fontFamily: "$font-body" }),
      txt(`${id}_m`, meta, 12, { fontFamily: "$font-caption" })
    ], { name: "Match Row", layout: "horizontal", gap: 12 });

  it("fires when instances are placed without their per-item overrides", () => {
    // The screenshot this comes from: one component, three instances, no
    // descendants map. Every row read "Juniper · Matched 8 min ago".
    const doc = screenWith(
      frame("list", "fill_container", "fit_content", [
        row("r1", "Juniper", "Matched 8 min ago"),
        row("r2", "Juniper", "Matched 8 min ago"),
        row("r3", "Juniper", "Matched 8 min ago")
      ], { name: "Matches", layout: "vertical", gap: 8 })
    );
    const found = audit(doc).find((f) => f.rule === "cloned_content");
    expect(found).toBeDefined();
    expect(found!.message).toContain("3 siblings");
    expect(found!.message).toContain("Juniper");
    expect(found!.fix).toContain("descendants override");
  });

  it("reads a ref that forgot its overrides the same as three hand-written copies", () => {
    // Instances are expanded before the audit runs, so the defect looks
    // identical whichever way the model produced it.
    const component = { ...row("tpl", "Juniper", "Matched 8 min ago"), reusable: true };
    const doc = screenWith(
      frame("list", "fill_container", "fit_content", [
        component,
        { type: "ref", id: "i1", ref: "tpl" } as any,
        { type: "ref", id: "i2", ref: "tpl" } as any
      ], { name: "Matches", layout: "vertical", gap: 8 })
    );
    // auditDocument, not auditDesign: the expansion happens in the former.
    expect(auditDocument(doc).map((f) => f.rule)).toContain("cloned_content");
  });

  it("stays silent when each row carries its own content", () => {
    const doc = screenWith(
      frame("list", "fill_container", "fit_content", [
        row("r1", "Nori", "Matched 8 min ago"),
        row("r2", "Maple", "Matched 2 hours ago"),
        row("r3", "Fig", "Matched yesterday")
      ], { name: "Matches", layout: "vertical", gap: 8 })
    );
    expect(rules(doc)).not.toContain("cloned_content");
  });

  it("ignores siblings that repeat a single label", () => {
    // Two chips reading "New" are a coincidence, not a cloned entry. The rule
    // needs at least two pieces of copy before a repeat means anything.
    const doc = screenWith(
      frame("chips", "fill_container", "fit_content", [
        frame("c1", 60, 24, [txt("c1t", "New", 11)], { name: "Chip" }),
        frame("c2", 60, 24, [txt("c2t", "New", 11)], { name: "Chip" })
      ], { name: "Chips", layout: "horizontal", gap: 8 })
    );
    expect(rules(doc)).not.toContain("cloned_content");
  });
});

describe("shadow_quality", () => {
  const shadow = (x: number, y: number, blur: number) => ({
    type: "shadow" as const, color: "#00000029", x, y, blur, spread: 0, enabled: true
  });

  it("fires on a zero-offset, zero-blur halo", () => {
    const doc = makeDoc(frame("card", 200, 100, [], { effect: shadow(0, 0, 0) }));
    const found = audit(doc).find((f) => f.rule === "shadow_quality");
    expect(found).toBeDefined();
    expect(found!.message).toContain("no offset and no blur");
  });

  it("stays silent on a shadow that carries an offset and a soft blur", () => {
    const doc = makeDoc(frame("card", 200, 100, [], { effect: shadow(0, 4, 12) }));
    expect(rules(doc)).not.toContain("shadow_quality");
  });

  it("fires on a hard block shadow when the document did not choose that world", () => {
    const doc = makeDoc(frame("card", 200, 100, [], { effect: shadow(4, 4, 0) }));
    const found = audit(doc).find((f) => f.rule === "shadow_quality");
    expect(found).toBeDefined();
    expect(found!.message).toContain("hard block shadow");
  });

  it("allows the block shadow under the elevation built on it", () => {
    // Impeccable permits it inside a world that is actually neobrutalist. The
    // catalog now carries those worlds, so the permission has to exist.
    const doc = makeDoc(frame("card", 200, 100, [], { effect: shadow(4, 4, 0) }));
    doc.metadata = {
      [STYLE_METADATA_KEY]: {
        palette: "Terminal Green", roundness: "Sharp", elevation: HARD_SHADOW_ELEVATION,
        headings: "Anton", body: "Inter", captions: "Inter"
      }
    };
    expect(rules(doc)).not.toContain("shadow_quality");
  });
});

describe("border_accent", () => {
  // OpenDesign blocks this shape at P0 and Impeccable refuses it separately.
  // Two floors naming the same pattern independently is what earns it a rule.
  const tile = (props: any) => makeDoc(frame("metric", 200, 80, [], props));

  it("fires on a rounded surface with a thick accent border on one side", () => {
    const doc = tile({
      cornerRadius: 12, stroke: "$accent-primary", strokeWidth: { left: 4 }
    });
    const found = audit(doc).find((f) => f.rule === "border_accent");
    expect(found).toBeDefined();
    expect(found!.message).toContain("stock AI dashboard tile");
  });

  it("stays silent on a hairline, which is a divider rather than a badge", () => {
    const doc = tile({ cornerRadius: 12, stroke: "$accent-primary", strokeWidth: { left: 1 } });
    expect(rules(doc)).not.toContain("border_accent");
  });

  it("stays silent when the border is not an accent, or the surface is square", () => {
    expect(rules(tile({ cornerRadius: 12, stroke: "$border-subtle", strokeWidth: { left: 4 } })))
      .not.toContain("border_accent");
    expect(rules(tile({ stroke: "$accent-primary", strokeWidth: { left: 4 } })))
      .not.toContain("border_accent");
  });
});

describe("tracking", () => {
  it("fires on display type set tighter than the -4% floor", () => {
    const doc = makeDoc(txt("hero", "Arrivals", 48, { letterSpacing: -3 }));
    const found = audit(doc).find((f) => f.rule === "tracking");
    expect(found).toBeDefined();
    expect(found!.message).toContain("tighter than");
  });

  it("fires on capitals left at the body's tracking", () => {
    const doc = makeDoc(txt("label", "DEPARTURES", 11, {}));
    const found = audit(doc).find((f) => f.rule === "tracking");
    expect(found).toBeDefined();
    expect(found!.message).toContain("capitals");
  });

  it("stays silent once the capitals are opened up", () => {
    expect(rules(makeDoc(txt("label", "DEPARTURES", 11, { letterSpacing: 0.8 }))))
      .not.toContain("tracking");
  });

  it("does not read numerals or a single initial as capitals", () => {
    // "7:42" and "A" are uppercase to a naive test and need no tracking.
    expect(rules(makeDoc(txt("time", "7:42", 14, {})))).not.toContain("tracking");
    expect(rules(makeDoc(txt("initial", "A", 14, {})))).not.toContain("tracking");
  });
});

describe("prose_measure", () => {
  const paragraph =
    "The warehouse floor runs three shifts and every pallet that moves through " +
    "the north dock is counted twice, once on arrival and once when it is put " +
    "away, which is how the discrepancy report gets built each morning.";

  it("fires on body copy set too wide to track back", () => {
    const doc = makeDoc(
      frame("main", 1200, "fit_content", [txt("copy", paragraph, 14, { width: "fill_container" })], {
        layout: "vertical"
      })
    );
    const found = audit(doc).find((f) => f.rule === "prose_measure");
    expect(found).toBeDefined();
    expect(found!.message).toContain("characters a line");
  });

  it("stays silent in a column narrow enough to read", () => {
    const doc = makeDoc(
      frame("column", 420, "fit_content", [txt("copy", paragraph, 14, { width: "fill_container" })], {
        layout: "vertical"
      })
    );
    expect(rules(doc)).not.toContain("prose_measure");
  });

  it("does not hold a heading to a prose measure", () => {
    const doc = makeDoc(
      frame("main", 1200, "fit_content", [txt("title", "Arrivals", 44, { width: "fill_container" })], {
        layout: "vertical"
      })
    );
    expect(rules(doc)).not.toContain("prose_measure");
  });
});

describe("stat_tile_row", () => {
  const tile = (id: string) =>
    frame(id, 110, "fit_content", [
      txt(`${id}-value`, "248", 32, {}),
      txt(`${id}-label`, "Pallets", 12, {})
    ], { name: "Metric", layout: "vertical" });

  it("fires when three identical metric tiles open the screen", () => {
    const doc = screenWith(
      frame("stats", "fill_container", "fit_content", [tile("a"), tile("b"), tile("c")], {
        name: "Stats", layout: "horizontal", gap: 12
      })
    );
    const found = audit(doc).find((f) => f.rule === "stat_tile_row");
    expect(found).toBeDefined();
    expect(found!.message).toContain("stock dashboard hero");
  });

  it("stays silent when the metrics follow the screen's real subject", () => {
    // Held narrow on purpose. A metric row is only the template when it is the
    // opening move; further down it is supporting content that earned its place.
    const doc = screenWith(
      frame("subject", "fill_container", "fit_content", [txt("headline", "Dock 3 is backed up", 32, {})], {
        name: "Subject", layout: "vertical"
      }),
      frame("stats", "fill_container", "fit_content", [tile("a"), tile("b"), tile("c")], {
        name: "Stats", layout: "horizontal", gap: 12
      })
    );
    expect(rules(doc)).not.toContain("stat_tile_row");
  });

  it("stays silent on two tiles, which is a comparison rather than a template", () => {
    const doc = screenWith(
      frame("stats", "fill_container", "fit_content", [tile("a"), tile("b")], {
        name: "Stats", layout: "horizontal", gap: 12
      })
    );
    expect(rules(doc)).not.toContain("stat_tile_row");
  });
});

describe("Dealing", () => {
  it("offers a typeface for every job it asks the model to fill", () => {
    // headings, body and captions are three separate choices. A hand of four
    // sans faces can satisfy the schema and still have no display voice.
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
    // The regression: mono was dealt into 100% of hands while the caption role
    // is advertised as "labels, tab labels, metadata, badges". The model took
    // the offer, and tab labels, chips and written values all came out
    // monospaced — the costume the craft rules forbid in prose.
    const mono = ["Geist Mono", "IBM Plex Mono"];
    const N = 800;
    const rate =
      [...Array(N)].filter((_, i) => dealTypefaces(i + 1).some((f) => mono.includes(f))).length / N;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.4);
  });

  it("prints each dealt face beside the job it is allowed to do", () => {
    // A bare list of five names lets the model fill "captions" from whatever
    // sits in the third position. The group label is the part that makes the
    // choice a choice.
    const withMono = [...Array(200)].map((_, i) => i + 1).find((s) =>
      dealTypefaces(s).some((f) => ["Geist Mono", "IBM Plex Mono"].includes(f))
    )!;
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
    // The convergence this replaces: the whole list printed in a fixed order
    // with Inter at the head, on every brief.
    const rate = [...Array(200)].filter((_, i) => dealTypefaces(i + 1).includes("Inter")).length / 200;
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.8);
  });

  it("spreads the palette hands evenly across neighbouring briefs", () => {
    // The regression: seeds are a hash of the brief, so briefs arrive as
    // neighbouring integers, and the raw LCG stayed correlated for exactly the
    // first few draws a hand is dealt from. One dark palette reached 41% of
    // hands against a catalog share of 18%, which is the monoculture the deal
    // exists to prevent, reintroduced underneath it.
    const N = 300;
    const seen = new Map<string, number>();
    for (let s = 1; s <= N; s++) {
      const catalog = styleCatalog(s);
      for (const p of PALETTES) if (catalog.includes(`  ${p.name} (`)) {
        seen.set(p.name, (seen.get(p.name) ?? 0) + 1);
      }
    }
    expect(seen.size).toBe(PALETTES.length);
    const worst = Math.max(...seen.values()) / N;
    expect(worst).toBeLessThan(0.3);
  });
});

describe("Feedback at the call that caused it", () => {
  it("reports an immediate defect on what was just inserted", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: {
        type: "frame", id: "card", name: "Card", width: 300, height: 40,
        layout: "vertical", clip: true,
        children: [{
          type: "text", id: "bio", name: "Bio", fontSize: 14,
          content: "A line of copy that is far too long for this box to hold"
        }]
      }
    });
    expect(result).toContain("Measured on what you just inserted");
    expect(result).toContain("[blocker] clipped");
  });

  it("stays quiet on a clean insertion", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("insert_node", {
      node: { type: "frame", id: "box", name: "Box", width: 200, height: 100, layout: "vertical" }
    });
    expect(result).not.toContain("Measured on what you just inserted");
  });

  it("does not hold a screen under construction to whole-screen rules", () => {
    // missing_display, empty_tail and stat_tile_row are judgments about a
    // finished screen. Reporting them at insert time would fire on every
    // partial build and train the model to ignore the channel.
    const doc = makeDoc(
      frame("screen", 390, "fit_content", [
        frame("sb", "fill_container", 62, [], { name: "Status Bar" }),
        frame("body", "fill_container", "fit_content", [
          txt("t", "Arrivals", 20, {})
        ], { name: "Body", layout: "vertical" })
      ], { name: "Home", layout: "vertical" })
    );
    const whole = auditDocument(doc).map((f) => f.rule);
    expect(whole).toContain("missing_display");
    expect(auditInsertion(doc, "screen").map((f) => f.rule)).not.toContain("missing_display");
  });
});

describe("Severity triage", () => {
  it("files scale consistency as info, not as a defect", () => {
    // A screen using seven font sizes is inconsistent, not broken. Ranked with
    // clipping it spends correction turns that clipping should have had.
    const kids = [11, 13, 15, 17, 20, 24, 28, 34].map((size, i) =>
      txt(`t${i}`, `Line ${i}`, size, {})
    );
    const doc = makeDoc(frame("s", 400, "fit_content", kids, { name: "Home", layout: "vertical" }));
    const scale = audit(doc).find((f) => f.rule === "type_scale");
    expect(scale?.severity).toBe("info");
  });

  it("orders findings severest first and names the triage", () => {
    const findings = [
      { rule: "type_scale" as const, severity: "info" as const, nodeId: "a", message: "m", fix: "f" },
      { rule: "clipped" as const, severity: "blocker" as const, nodeId: "b", message: "m", fix: "f" }
    ];
    const text = formatAudit(findings, "Audit");
    expect(text).toContain("1 blocker, 0 warnings, 1 info.");
    expect(text.indexOf("[blocker]")).toBeLessThan(text.indexOf("[info]"));
    expect(text).toContain("Info is consistency only");
  });
});

describe("Style history", () => {
  const run = (brief: string, palette: string): StyleRun => ({
    at: "2026-08-21T00:00:00.000Z",
    brief, palette, headings: "Anton", elevation: "Flat"
  });

  it("keeps only the most recent entries", () => {
    let history: StyleRun[] = [];
    for (let i = 0; i < 9; i++) history = recordRun(history, run(`brief ${i}`, `P${i}`));
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[history.length - 1].palette).toBe("P8");
    expect(history.some((h) => h.palette === "P0")).toBe(false);
  });

  it("says nothing when there is no history", () => {
    expect(avoidanceNote([])).toBe("");
  });

  it("lists what was already used, most recent first", () => {
    const note = avoidanceNote([run("a bus app", "Terminal Green"), run("a cat app", "Neobrutalism")]);
    expect(note.indexOf("Neobrutalism")).toBeLessThan(note.indexOf("Terminal Green"));
    expect(note).toContain("not habit");
  });

  it("reaches the prompt only when the model is about to choose", () => {
    const history = [run("a cat app", "Spring Meadow")];
    const fresh = makeDoc();
    expect(agentSystemPrompt(fresh, [], "m", 1, history)).toContain("Spring Meadow");

    // A document that already has a style is not choosing one, so the list of
    // what other runs used is noise.
    const styled = makeDoc();
    styled.metadata = {
      [STYLE_METADATA_KEY]: {
        palette: "Terminal Green", roundness: "Sharp", elevation: "Flat",
        headings: "Geist Mono", body: "Geist Mono", captions: "IBM Plex Mono"
      }
    };
    expect(agentSystemPrompt(styled, [], "m", 1, history)).not.toContain("ALREADY USED");
  });

  it("survives a corrupt or absent store", () => {
    const store = (value: string | null) => ({
      getItem: () => value,
      setItem: () => {},
      removeItem: () => {}, clear: () => {}, key: () => null, length: 0
    }) as unknown as Storage;
    expect(loadHistory(store("not json"))).toEqual([]);
    expect(loadHistory(store(null))).toEqual([]);
    expect(loadHistory(store('[{"palette":"P"}]'))).toEqual([]);
  });
});
