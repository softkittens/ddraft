import { describe, it, expect } from "bun:test";
import { applyReviewMessage, applyReviewFixes, enforceAuditFindings, type DesignReview } from "../src/agent/review";
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
    expect(String(foodMessages[0].content)).toContain("Scroll Affordance vs Clipping");
    expect(String(foodMessages[0].content)).toContain("Sibling Card Action Consistency");

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
    expect(Array.isArray(content) && content[0].type === "text" && content[0].text).toContain("THESIS: A journal, not a dashboard");
    expect(Array.isArray(content) && content[0].type === "text" && content[0].text).toContain("Audit whether the screenshot visibly fulfills each claim");
    expect(Array.isArray(content) && content[0].type === "text" && content[0].text).toContain("Deterministic measurements:");
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
    expect(enforced.scores.craft).toBeLessThanOrEqual(2);
    expect(enforced.issues).toHaveLength(1);
    expect(enforced.issues[0].title).toBe("Cropped photograph out of proportion");
    expect(enforced.issues[0].nodeIds).toEqual(["m-hero-photo"]);
  });
});
