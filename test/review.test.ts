import { describe, it, expect } from "bun:test";
import {
  applyReviewMessage,
  applyReviewFixes,
  enforceAuditFindings,
  enforceRejectedFixes,
  type DesignReview
} from "../src/agent/review";
import { CRITIC_PROMPT, criticMessages, parseDesignReview } from "../src/agent/critic";
import type { Document } from "../src/model/types";

const review: DesignReview = {
  verdict: "refine",
  scores: { specificity: 3, hierarchy: 2, usability: 4, craft: 3 },
  strengths: ["Clear title"],
  issues: [{
    title: "Weak hierarchy",
    reason: "The heading and body are the same size.",
    instruction: "Make the heading 28px and the body 16px.",
    nodeIds: ["title", "ghost"]
  }]
};

describe("design review contract", () => {
  it("strips node ids that are not in the digest", () => {
    const parsed = parseDesignReview(review, "title Home t28\nbody Copy t16");
    expect(parsed.issues[0].nodeIds).toEqual(["title"]);
  });

  it("rejects extra fields by keeping only the schema", () => {
    const parsed = parseDesignReview({ ...review, extra: true, issues: review.issues }, "title Home");
    expect("extra" in parsed).toBe(false);
  });

  it("builds critic messages without tools or prior transcript", () => {
    const messages = criticMessages({
      brief: "A reading site",
      screenshotDataUrl: "data:image/png;base64,xx",
      digest: "title Home"
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(String(messages[0].content)).toContain("cannot edit");
    expect(messages[1].role).toBe("user");
    expect(Array.isArray(messages[1].content)).toBe(true);
  });

  it("injects domain-specific review criteria based on the design brief", () => {
    const foodMessages = criticMessages({
      brief: "Playful ordering app for matcha cakes",
      screenshotDataUrl: "data:image/png;base64,xx",
      digest: "title Home"
    });
    expect(String(foodMessages[0].content)).toContain("E-COMMERCE & FOOD ORDERING APP");
    expect(String(foodMessages[0].content)).toContain("capabilities, not template compliance");
    expect(String(foodMessages[0].content)).toContain("Product specificity");
    expect(String(foodMessages[0].content)).toContain("action shape is a design choice");

    const swipeMessages = criticMessages({
      brief: "Mobile cat adoption swipe cards app",
      screenshotDataUrl: "data:image/png;base64,xx",
      digest: "title Home"
    });
    expect(String(swipeMessages[0].content)).toContain("CARD SWIPE / SOCIAL DISCOVERY");
    expect(String(swipeMessages[0].content)).toContain("Single-Viewport Ceiling");

    const opsMessages = criticMessages({
      brief: "Telemetry ops dashboard for server clusters",
      screenshotDataUrl: "data:image/png;base64,xx",
      digest: "title Home"
    });
    expect(String(opsMessages[0].content)).toContain("DASHBOARD & OPERATIONS CONSOLE");
  });

  it("judges against the context the builder used, not one re-derived from the brief", () => {
    // The server has only the brief. Resolving from that string alone gave a
    // mobile app the dashboard criteria, because "analytics" was enough.
    const reResolved = criticMessages({
      brief: "Mobile analytics app",
      screenshotDataUrl: "data:image/png;base64,xx",
      digest: "title Home"
    });
    expect(String(reResolved[0].content)).not.toContain("DASHBOARD & OPERATIONS CONSOLE");

    const supplied = criticMessages({
      brief: "make the numbers bigger",
      screenshotDataUrl: "data:image/png;base64,xx",
      digest: "title Home",
      context: {
        surface: "desktop",
        archetype: "tool",
        traits: ["data_visualization"],
        lifecycle: "revision_edit"
      }
    });
    // The brief alone says nothing about a console; the builder's context does.
    expect(String(supplied[0].content)).toContain("DASHBOARD & OPERATIONS CONSOLE");
  });

  it("asks the tool critic for capabilities rather than a sidebar and a queue", () => {
    const messages = criticMessages({
      brief: "Fleet operations console",
      screenshotDataUrl: "data:image/png;base64,xx",
      digest: "title Home"
    });
    const system = String(messages[0].content);
    // The builder is told an unused rail beats fake telemetry in the same run.
    expect(system).toContain("Do not require a sidebar");
    expect(system).toContain("inventing telemetry to fill it is the defect");
  });

  it("gives the critic the recorded direction contract", () => {
    const messages = criticMessages({
      brief: "A reading site",
      screenshotDataUrl: "data:image/png;base64,xx",
      digest: "title Home",
      direction: {
        thesis: "A journal, not a dashboard",
        ownWorld: "Ink, paper and hard rules",
        firstViewport: "One oversized title above a reading column"
      },
      audit: "[warning] empty_tail screen: 180px empty"
    });
    const content = messages[1].content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as { type: string; text?: string }[];

    // The brief and the measurements come before the screenshot; the direction
    // comes after it. The reviewer is usually the model that wrote that thesis,
    // and reading its own argument first turns the review into a search for
    // confirmation of the story rather than a look at the picture.
    expect(parts[0].text).toContain("Deterministic measurements:");
    expect(parts[0].text).not.toContain("THESIS:");

    const lastImage = parts.map((part) => part.type).lastIndexOf("image_url");
    const afterImage = parts.slice(lastImage + 1).map((part) => part.text ?? "").join("\n");
    expect(afterImage).toContain("THESIS: A journal, not a dashboard");
    // Same hedge as the builder prompt: "prefer the stronger composition"
    // when topology diverges licensed 8ca10dd0's rail photography.
    expect(afterImage).not.toContain("geometry specification");
    expect(afterImage).not.toContain("left/right");
    expect(afterImage).toContain("cannot prove sticky, persistent");
    expect(afterImage).toContain("Banner or split");
    expect(afterImage).toContain("not a defect");
  });

  it("does not treat firstViewport as a composition to rebuild", () => {
    expect(CRITIC_PROMPT).toContain("not a layout specification");
    expect(CRITIC_PROMPT).not.toContain("left/right");
  });

  it("does not treat cream close-ups as a missing page when the digest still names the bands", () => {
    expect(CRITIC_PROMPT).toContain("clip or capture problem");
    expect(CRITIC_PROMPT).toContain("create_screen slot");
  });

  it("tells the overview critic that viewport crop edges are not clipping", () => {
    const messages = criticMessages({
      brief: "A scrolling shop",
      screenshots: [{
        id: "shop_end_viewport",
        name: "Shop — Final Viewport",
        dataUrl: "data:image/png;base64,xx",
        kind: "viewport",
        parentId: "shop"
      }],
      digest: "shop Shop"
    });
    const content = messages[1].content;
    expect(JSON.stringify(content)).toContain("crop boundary is not a canvas boundary");
    expect(JSON.stringify(content)).toContain("must not be reported as clipping");
  });

  it("marks review issues as an internal revision message", () => {
    const text = applyReviewMessage("A reading site", parseDesignReview(review, "title Home"));
    expect(text.startsWith("[Visual review revision]")).toBe(true);
    expect(text).toContain("Original brief: A reading site");
    expect(text).toContain("Weak hierarchy (title)");
    expect(text).toContain("Make the heading 28px");
    expect(text).not.toContain("ghost");
  });

  it("ships the cited subtrees with the instruction that cites them", () => {
    const doc: Document = {
      children: [
        {
          id: "title",
          type: "frame",
          name: "Hero",
          layout: "vertical",
          children: [
            { id: "heading", type: "text", content: "Read slowly", fontSize: 20 },
            { id: "sub", type: "text", content: "Three essays a week", fontSize: 20 }
          ]
        }
      ]
    } as unknown as Document;

    const text = applyReviewMessage("A reading site", parseDesignReview(review, "title Home"), doc);

    // One trace opened its revision with six read_digest calls on the ids the
    // instruction had just quoted. They are already in hand here.
    expect(text).toContain("The nodes it named, as they stand now:");
    expect(text).toContain("Read slowly");
    expect(text).toContain("Three essays a week");
  });

  it("names only nodes that are still on the canvas", () => {
    const doc = { children: [] } as unknown as Document;
    const text = applyReviewMessage("A reading site", parseDesignReview(review, "title Home"), doc);
    expect(text).not.toContain("The nodes it named");
  });

  it("says a revision is a revision", () => {
    const text = applyReviewMessage("A reading site", parseDesignReview(review, "title Home"));
    // The run that read this instruction spent 45 tool calls against the 33 the
    // build had used, most of them nudging regions the critic never mentioned.
    expect(text).toContain("leave the rest of the canvas alone");
    expect(text).toContain("Never delete a create_screen slot");
  });
});

describe("Fixes the critic applies itself", () => {
  const digestText = "card Card\ntitle Heading\nbody Copy";

  it("keeps a well-formed fix and drops one outside the allowlist", () => {
    const parsed = parseDesignReview({
      verdict: "refine",
      scores: { specificity: 3, hierarchy: 3, usability: 3, craft: 3 },
      strengths: [],
      issues: [],
      fixes: [
        { nodeId: "title", property: "fontSize", value: 32 },
        { nodeId: "card", property: "layout", value: "vertical" },
        { nodeId: "body", property: "content", value: "rewritten" }
      ]
    }, digestText);
    // layout and content restructure or rewrite; those stay the model's call.
    expect(parsed.fixes).toEqual([{ nodeId: "title", property: "fontSize", value: 32 }]);
  });

  it("drops a fix that deletes the element instead of adjusting it", () => {
    const parsed = parseDesignReview({
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 4 },
      strengths: [],
      issues: [],
      fixes: [
        { nodeId: "title", property: "fontSize", value: 0 },
        { nodeId: "body", property: "fontSize", value: 8 },
        { nodeId: "card", property: "opacity", value: 0 },
        { nodeId: "card", property: "width", value: 0 },
        { nodeId: "card", property: "height", value: 0 },
        { nodeId: "title", property: "fontSize", value: 11 }
      ]
    }, digestText);
    /*
     * A critic that cannot restructure reaches for the nearest property that
     * makes the thing it objects to disappear, and the nearest property is a
     * zero. One logged review returned `fontSize: 0` on all four KPI labels of
     * a factory dashboard to satisfy an eyebrow warning — a deletion in the
     * shape of a fix, and applyReviewFixes writes fixes with no model in the
     * loop. Removing an element belongs in `issues`, where a model decides.
     */
    expect(parsed.fixes).toEqual([{ nodeId: "title", property: "fontSize", value: 11 }]);
  });

  it("drops a fix whose value is the wrong shape for its property", () => {
    const parsed = parseDesignReview({
      verdict: "refine",
      scores: { specificity: 3, hierarchy: 3, usability: 3, craft: 3 },
      strengths: [],
      issues: [],
      fixes: [
        { nodeId: "card", property: "gap", value: "large" },
        { nodeId: "card", property: "fill", value: "reddish" },
        { nodeId: "card", property: "fill", value: "$surface-secondary" },
        { nodeId: "card", property: "width", value: "fill_container" }
      ]
    }, digestText);
    expect(parsed.fixes).toEqual([
      { nodeId: "card", property: "fill", value: "$surface-secondary" },
      { nodeId: "card", property: "width", value: "fill_container" }
    ]);
  });

  it("drops a fix naming a node that is not on the canvas", () => {
    const parsed = parseDesignReview({
      verdict: "refine",
      scores: { specificity: 3, hierarchy: 3, usability: 3, craft: 3 },
      strengths: [],
      issues: [],
      fixes: [{ nodeId: "ghost", property: "fontSize", value: 20 }]
    }, digestText);
    expect(parsed.fixes).toEqual([]);
  });

  it("applies surviving fixes to the document without a model turn", () => {
    const doc: any = {
      version: "2.17",
      children: [{
        type: "frame", id: "card", name: "Card", width: 300, height: 100, gap: 4,
        children: [{ type: "text", id: "title", name: "Heading", content: "Hi", fontSize: 14 }]
      }]
    };
    const review = parseDesignReview({
      verdict: "refine",
      scores: { specificity: 3, hierarchy: 3, usability: 3, craft: 3 },
      strengths: [],
      issues: [],
      fixes: [
        { nodeId: "title", property: "fontSize", value: 32 },
        { nodeId: "card", property: "gap", value: 16 }
      ]
    }, digestText);

    const result = applyReviewFixes(doc, review);
    expect(result.applied).toEqual(["title.fontSize", "card.gap"]);
    expect(result.doc).not.toBe(doc);
    expect(result.doc.children[0].gap).toBe(16);
    expect((result.doc.children[0] as any).children[0].fontSize).toBe(32);
    // The original is untouched — the caller decides whether to commit.
    expect(doc.children[0].gap).toBe(4);
  });

  it("applies a coordinated fill and text-colour correction atomically", () => {
    const doc: any = {
      version: "2.17",
      variables: {
        "surface-secondary": { type: "color", value: "#FFFFFF" },
        "foreground-primary": { type: "color", value: "#1A1A1A" },
        "accent-primary": { type: "color", value: "#6D28D9" }
      },
      children: [{
        type: "frame", id: "button", name: "Action Button", width: 160, height: 44,
        layout: "horizontal", fill: "$accent-primary", children: [{
          type: "text", id: "label", name: "Action Label", content: "Continue",
          fontSize: 14, fill: "$surface-secondary"
        }]
      }]
    };
    const coordinated = parseDesignReview({
      verdict: "pass",
      scores: { specificity: 4, hierarchy: 4, usability: 4, craft: 4 },
      strengths: [], issues: [],
      fixes: [
        { nodeId: "button", property: "fill", value: "$surface-secondary" },
        { nodeId: "label", property: "fill", value: "$foreground-primary" }
      ]
    }, "button Action Button\nlabel Action Label");

    const result = applyReviewFixes(doc, coordinated);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toEqual(["button.fill", "label.fill"]);
    expect(result.doc.children[0].fill).toBe("$surface-secondary");
    expect(result.doc.children[0].children[0].fill).toBe("$foreground-primary");
  });

  it("returns the same document when a review carries no fixes", () => {
    const doc: any = { version: "2.17", children: [] };
    const review = parseDesignReview({
      verdict: "pass",
      scores: { specificity: 4, hierarchy: 4, usability: 4, craft: 4 },
      strengths: [],
      issues: []
    }, digestText);
    expect(applyReviewFixes(doc, review).doc).toBe(doc);
  });

  it("rejects an auto-fix that makes a product action icon disappear", () => {
    const doc: any = {
      version: "2.17",
      variables: {
        "surface-primary": { type: "color", value: "#FFFFFF" },
        "surface-secondary": { type: "color", value: "#F8F7FC" },
        "accent-primary": { type: "color", value: "#6D28D9" },
        "foreground-primary": { type: "color", value: "#18111F" }
      },
      children: [{
        type: "frame", id: "screen", name: "Store", width: 390, height: 844,
        layout: "vertical", fill: "$surface-primary", children: [{
          type: "frame", id: "add", name: "Add Button", width: 44, height: 44,
          layout: "horizontal", justifyContent: "center", alignItems: "center",
          fill: "$accent-primary", cornerRadius: 22, children: [{
            type: "icon", id: "plus", name: "Plus", icon: "plus", width: 20, height: 20,
            stroke: "$surface-secondary"
          }]
        }]
      }]
    };
    const unsafe = parseDesignReview({
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 5 },
      strengths: [], issues: [],
      fixes: [{ nodeId: "add", property: "fill", value: "$surface-secondary" }]
    }, "add Add Button\nplus Plus");

    const result = applyReviewFixes(doc, unsafe);
    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual(["add.fill"]);
    expect((result.doc.children[0] as any).children[0].fill).toBe("$accent-primary");

    const enforced = enforceRejectedFixes(unsafe, result.rejected);
    expect(enforced.verdict).toBe("refine");
    expect(enforced.issues[0].title).toBe("Unsafe automatic correction");
  });

  it("tells the critic that a single property belongs in fixes", () => {
    expect(CRITIC_PROMPT).toContain("belongs in 'fixes'");
    expect(CRITIC_PROMPT).toContain("fontSize");
  });

  it("judges use-scene and leftover viewport, not a factory costume", () => {
    expect(CRITIC_PROMPT).toContain("Uncentered chips");
    expect(CRITIC_PROMPT).toContain("Unused viewport");
    expect(CRITIC_PROMPT).toContain("house as an operations console");
    expect(CRITIC_PROMPT).toContain("Photography that fails its frame");
    // Both directions: a picture too small to be the subject, and one cropped
    // past recognition by a frame no photograph fits.
    expect(CRITIC_PROMPT).toContain("not a real share of the viewport");
    expect(CRITIC_PROMPT).toContain("only a sliver of the subject survives the crop");
    expect(CRITIC_PROMPT).toContain("Catalog as page");
    expect(CRITIC_PROMPT).toContain("Data That Is Not Drawn");
    expect(CRITIC_PROMPT).toContain("Pasted-On Overlays");
    expect(CRITIC_PROMPT).toContain("Cryptic or Placeholder Selection UI");
    expect(CRITIC_PROMPT).toContain("Do not award 5 merely because");
    expect(CRITIC_PROMPT).not.toContain("SYSTEMS NOMINAL");
    expect(CRITIC_PROMPT).not.toContain("Shift Handoff");
    expect(CRITIC_PROMPT).not.toContain("requires dark/mission-critical");
  });

  it("overrides a passing critic verdict to refine when severe audit findings exist", () => {
    const passingReview: DesignReview = {
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 5 },
      strengths: ["Great photo"],
      issues: []
    };

    const enforced = enforceAuditFindings(passingReview, [
      {
        rule: "cropped_photography",
        severity: "warning",
        nodeId: "m-hero-photo",
        message: "390x1320 frame throws away 61% of photograph",
        fix: "Resize to 390x293 (3:4) or 390x390 (1:1)"
      }
    ]);

    expect(enforced.verdict).toBe("refine");
    // A warning is worth a refine, not the 2 the rubric reserves for a screen
    // you cannot use. The score has to stay proportional to the finding,
    // because the revision the agent writes is scoped to the score.
    expect(enforced.scores.craft).toBe(3);
    expect(enforced.issues).toHaveLength(1);
    expect(enforced.issues[0].title).toBe("Cropped photograph out of proportion");
    expect(enforced.issues[0].nodeIds).toEqual(["m-hero-photo"]);
  });

  it("scores an enforced finding at its own severity, not at blocker level", () => {
    const passing: DesignReview = {
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 5 },
      strengths: [], issues: []
    };

    const warned = enforceAuditFindings(passing, [{
      rule: "misaligned_buttons",
      severity: "warning",
      nodeId: "row",
      message: "CTA baselines differ by 18px",
      fix: "Set height fill_container on the sibling cards."
    }]);
    expect(warned.scores.craft).toBe(3);
    // A staggered button baseline is a craft defect. Marking hierarchy down for
    // it asks for a page rebuild over one row of buttons.
    expect(warned.scores.hierarchy).toBe(5);

    const blocked = enforceAuditFindings(passing, [{
      rule: "missing_display",
      severity: "blocker",
      nodeId: "title",
      message: "No display-scale title on the screen",
      fix: "Raise the primary title to 44px."
    }]);
    expect(blocked.scores.craft).toBe(2);
    expect(blocked.scores.hierarchy).toBe(2);
  });

  it("does not allow a passing critic to ignore finishing warnings", () => {
    const passingReview: DesignReview = {
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 5 },
      strengths: [], issues: []
    };
    const enforced = enforceAuditFindings(passingReview, [{
      rule: "empty_tail",
      severity: "warning",
      nodeId: "screen",
      message: "120px empty before the tab bar",
      fix: "Remove the dead tail."
    }]);
    expect(enforced.verdict).toBe("refine");
    expect(enforced.issues[0].nodeIds).toEqual(["screen"]);
  });

  it("does not send a passed site back to be rebuilt over tall narrative bands", () => {
    // 9aa7670e: critic scored Calma 5/5. oversized_section_height on 650px
    // story/pricing bands then forced a revision that deleted Main.
    const passingReview: DesignReview = {
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 4 },
      strengths: ["Complete information architecture"],
      issues: []
    };
    const enforced = enforceAuditFindings(passingReview, [{
      rule: "oversized_section_height",
      severity: "warning",
      nodeId: "band-story",
      message: "Story is 654px tall",
      fix: "Make the card compact (380px–520px)"
    }, {
      rule: "accent_overuse",
      severity: "warning",
      nodeId: "n1",
      message: "9 separate roles",
      fix: "Pick the 2 that mean the most"
    }]);
    expect(enforced.verdict).toBe("pass");
    expect(enforced.issues).toEqual([]);
  });
});
