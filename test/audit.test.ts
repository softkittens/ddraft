import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeDoc, frame, txt, rect } from "./harness";
import { layoutDocument } from "../src/layout/layout";
import { auditDesign, formatAudit, contrastRatio, type AuditRule } from "../src/design/evaluator";
import {
  PALETTES,
  resolveStyle,
  currentStyle,
  styleGuidelines,
  StyleChoiceError,
  STYLE_METADATA_KEY,
  FONT_FAMILIES
} from "../src/design/styleSystem";
import { agentSystemPrompt } from "../src/agent/prompt";
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
        layout: "vertical"
      })
    );
    const found = audit(doc).find((f) => f.rule === "clipped");
    expect(found).toBeDefined();
    expect(found!.nodeId).toBe("bio");
    expect(found!.message).toMatch(/\d+px past the (right|bottom) edge/);
    expect(found!.message).toContain("clipped");
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
  // The rubber-stamp regression. review_design(id) used to keep only findings
  // whose nodeId was the target itself, so asking about a card discarded every
  // finding about the card's contents and answered "no defects".
  const doc = makeDoc(
    frame("screen", 390, 600, [
      frame("card", 200, 40, [txt("bio", "A line of copy that is far too long for this box", 14)], {
        layout: "vertical"
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
        layout: "vertical"
      }),
      frame("b", 200, 40, [txt("t2", "A line of copy that is far too long for this box", 14)], {
        layout: "vertical"
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

  it("set_style writes tokens and the guidelines restate them on later turns", async () => {
    const session = createDocumentTools(makeDoc());
    const result = await session.execute("set_style", {
      palette: "Carbon Frost",
      roundness: "Basic",
      elevation: "Soft Lift",
      headings: "Funnel Display",
      body: "Inter",
      captions: "Geist Mono"
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
    expect(result).toContain("Carbon Frost");
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

  it("costs less than the template it replaced", () => {
    // The template prompt measured 10,451 characters.
    expect(prompt.length).toBeLessThan(9000);
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
