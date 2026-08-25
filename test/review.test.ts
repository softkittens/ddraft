import { describe, it, expect } from "bun:test";
import {
  applyReviewMessage,
  finalizeReview,
  enforceAuditFindings,
  type DesignReview
} from "../src/agent/review";
import {
  CRITIC_PROMPT,
  criticMessages,
  enforceSourceGrounding,
  parseDesignReview,
  sourceGroundingIssue
} from "../src/agent/critic";
import { reviewLoopNext } from "../src/ui/chat/reviewLoop";
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

const readyGate = {
  distinctive: true,
  proportional: true,
  presentationReady: true,
  reason: "The overview has a clear signature and balanced visual rhythm."
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

    const siteMessages = criticMessages({
      brief: "Warm booking site for a Lisbon coworking house",
      screenshotDataUrl: "data:image/png;base64,xx",
      digest: "title Home"
    });
    expect(String(siteMessages[0].content)).toContain("Source Grounding");
    expect(String(siteMessages[0].content)).toContain("Conversion Proportionality");
    expect(String(siteMessages[0].content)).toContain("GESTALT GATE");
    expect(String(siteMessages[0].content)).toContain("qualityGate.distinctive");
  });

  it("deterministically flags unsupported high-risk authority claims", () => {
    const digest = [
      'badge "B Corp Pending"',
      'rating "4.9 / 5 stars based on 1,200 verified reviews"'
    ].join("\n");
    const issue = sourceGroundingIssue("Warm booking site for a Lisbon coworking house", digest);
    expect(issue?.title).toBe("Unsupported authority claims");
    expect(issue?.reason).toContain("B Corp Pending");

    const unready: DesignReview = {
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 5 },
      strengths: [],
      issues: []
    };
    const enforced = enforceSourceGrounding(unready, "Warm booking site for Lisbon", digest);
    expect(enforced.verdict).toBe("refine");
    expect(enforced.issues[0].title).toBe("Unsupported authority claims");
  });

  it("accepts concrete business facts that the user supplied", () => {
    const brief = "Show that the company is B Corp Pending.";
    const digest = 'badge "B Corp Pending"';
    expect(sourceGroundingIssue(brief, digest)).toBeUndefined();
  });

  it("allows standard fictional mockup content like hours, availability, and policies", () => {
    const digest = 'status "Live"\nhours "08:30–20:00 weekdays"\npolicy "Instant confirmation · No booking fee · Cancel anytime"\naccess "24/7 access"';
    const issue = sourceGroundingIssue("Warm Lisbon coworking site", digest);
    expect(issue).toBeUndefined();
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

  it("omits builder thesis/direction from critic to prevent confirmation bias", () => {
    const messages = criticMessages({
      brief: "A reading site",
      screenshotDataUrl: "data:image/png;base64,xx",
      digest: "title Home",
      audit: "[warning] empty_tail screen: 180px empty"
    });
    const content = messages[1].content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as { type: string; text?: string }[];
    // The brief and digest come before the screenshot; measurements come after it.
    // The reviewer sees the visual design first without reading its own thesis.
    expect(parts[0].text).not.toContain("Deterministic measurements:");
    expect(parts[0].text).not.toContain("THESIS:");

    const lastImage = parts.map((part) => part.type).lastIndexOf("image_url");
    const afterImage = parts.slice(lastImage + 1).map((part) => part.text ?? "").join("\n");
    expect(afterImage).toContain("empty_tail");
    expect(afterImage).not.toContain("THESIS:");
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

  it("omits redundant subtree dumps because system prompt already carries document digest", () => {
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
    expect(text).not.toContain("The nodes it named, as they stand now:");
    expect(text).toContain("Weak hierarchy (title): Make the heading 28px and the body 16px.");
  });

  it("says a revision is a revision", () => {
    const text = applyReviewMessage("A reading site", parseDesignReview(review, "title Home"));
    // The run that read this instruction spent 45 tool calls against the 33 the
    // build had used, most of them nudging regions the critic never mentioned.
    expect(text).toContain("leave the rest of the canvas alone");
    expect(text).toContain("Never delete a create_screen slot");
  });

  it("tags direction mismatch in review revision message when issues cite direction or style mismatch", () => {
    const mismatchReview: DesignReview = {
      verdict: "refine",
      scores: { specificity: 3, hierarchy: 3, usability: 3, craft: 3 },
      strengths: [],
      issues: [{
        title: "Direction mismatch",
        reason: "The visual style contradicts the product's trust and positioning.",
        instruction: "Call set_style to select a credible aerospace palette."
      }]
    };
    const text = applyReviewMessage("Private space tourism landing page", mismatchReview);
    expect(text).toContain("[Visual review revision - Direction mismatch: restyle permitted]");
    expect(text).toContain("call set_style or recompose the visual foundation");
  });
});

describe("Review finalization and pass normalization", () => {
  it("normalizes a passing review when all scores >= 4 and no issues or severe findings exist", () => {
    const passingReview: DesignReview = {
      verdict: "pass",
      scores: { specificity: 4, hierarchy: 4, usability: 5, craft: 4 },
      qualityGate: readyGate,
      strengths: ["Clean hierarchy"],
      issues: []
    };
    const finalized = finalizeReview(passingReview, []);
    expect(finalized.verdict).toBe("pass");
  });

  it("turns an otherwise clean pass into refine when the gestalt gate is absent", () => {
    const finalized = finalizeReview({
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 5 },
      strengths: [],
      issues: []
    }, []);
    expect(finalized.verdict).toBe("refine");
  });

  it("turns pass into refine if any score is below 4", () => {
    const weakCraft: DesignReview = {
      verdict: "pass",
      scores: { specificity: 4, hierarchy: 4, usability: 4, craft: 3 },
      strengths: [],
      issues: []
    };
    const finalized = finalizeReview(weakCraft, []);
    expect(finalized.verdict).toBe("refine");
  });

  it("turns pass into refine if issues are present", () => {
    const withIssues: DesignReview = {
      verdict: "pass",
      scores: { specificity: 4, hierarchy: 4, usability: 4, craft: 4 },
      strengths: [],
      issues: [{
        title: "Contrast issue",
        reason: "Button text contrast low",
        instruction: "Change to white text",
        nodeIds: ["btn"]
      }]
    };
    const finalized = finalizeReview(withIssues, []);
    expect(finalized.verdict).toBe("refine");
  });

  it("judges use-scene and leftover viewport, not a factory costume", () => {
    expect(CRITIC_PROMPT).toContain("Uncentered chips");
    expect(CRITIC_PROMPT).toContain("Unused viewport");
    expect(CRITIC_PROMPT).toContain("house as an operations console");
    expect(CRITIC_PROMPT).toContain("Photography that fails its frame");
    expect(CRITIC_PROMPT).toContain("not a real share of the viewport");
    expect(CRITIC_PROMPT).toContain("only a sliver of the subject survives the crop");
    expect(CRITIC_PROMPT).toContain("Catalog as page");
    expect(CRITIC_PROMPT).toContain("Data That Is Not Drawn");
    expect(CRITIC_PROMPT).toContain("Pasted-On Overlays");
    expect(CRITIC_PROMPT).toContain("Do not award 5 merely because");
    expect(CRITIC_PROMPT).not.toContain("SYSTEMS NOMINAL");
    expect(CRITIC_PROMPT).not.toContain("Shift Handoff");
    expect(CRITIC_PROMPT).not.toContain("requires dark/mission-critical");
  });

  it("overrides a passing critic verdict to refine when blocker audit findings exist", () => {
    const passingReview: DesignReview = {
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 5 },
      qualityGate: readyGate,
      strengths: ["Great photo"],
      issues: []
    };

    const enforced = enforceAuditFindings(passingReview, [
      {
        rule: "missing_display",
        severity: "blocker",
        nodeId: "title",
        message: "No display-scale title on the screen",
        fix: "Raise the primary title to 44px."
      }
    ]);

    expect(enforced.verdict).toBe("refine");
    expect(enforced.scores.craft).toBe(2);
    expect(enforced.scores.hierarchy).toBe(2);
    expect(enforced.issues).toHaveLength(1);
    expect(enforced.issues[0].title).toBe("missing display");
    expect(enforced.issues[0].nodeIds).toEqual(["title"]);
  });

  it("does not let audit warnings override a passing visual critic review", () => {
    const passingReview: DesignReview = {
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 5 },
      qualityGate: readyGate,
      strengths: ["Great layout"],
      issues: []
    };

    const enforced = enforceAuditFindings(passingReview, [
      {
        rule: "cropped_photography",
        severity: "warning",
        nodeId: "hero-photo",
        message: "1440x240 frame throws away photograph overflow",
        fix: "Resize to 1440x810"
      },
      {
        rule: "empty_tail",
        severity: "warning",
        nodeId: "screen",
        message: "120px empty before the tab bar",
        fix: "Remove the dead tail."
      },
      {
        rule: "uneven_card_heights",
        severity: "warning",
        nodeId: "card1",
        message: "Sibling cards have uneven heights",
        fix: "Set height: fill_container"
      },
      {
        rule: "misaligned_inputs",
        severity: "warning",
        nodeId: "input1",
        message: "Form input fields have inconsistent alignment",
        fix: "Set justifyContent: start"
      }
    ]);

    expect(enforced.verdict).toBe("pass");
    expect(enforced.issues).toHaveLength(0);
  });

  it("scores an enforced finding at its own severity, not at blocker level", () => {
    const refineReview: DesignReview = {
      verdict: "refine",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 5 },
      strengths: [], issues: [{ title: "Alignment issue", reason: "bad alignment", instruction: "fix", nodeIds: ["row"] }]
    };

    const blocked = enforceAuditFindings(refineReview, [{
      rule: "missing_display",
      severity: "blocker",
      nodeId: "title",
      message: "No display-scale title on the screen",
      fix: "Raise the primary title to 44px."
    }]);
    expect(blocked.scores.craft).toBe(2);
    expect(blocked.scores.hierarchy).toBe(2);
  });

  it("does not send a passed site back to be rebuilt over tall narrative bands", () => {
    // 9aa7670e: critic scored Calma 5/5. oversized_section_height on 650px
    // story/pricing bands then forced a revision that deleted Main.
    const passingReview: DesignReview = {
      verdict: "pass",
      scores: { specificity: 5, hierarchy: 5, usability: 5, craft: 4 },
      qualityGate: readyGate,
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

describe("visual review loop", () => {
  it("stops on refine once the 1-pass revision cap is reached", () => {
    expect(
      reviewLoopNext({ pass: 1, maxRevisions: 1, verdict: "refine", hasReview: true })
    ).toBe("stop");
  });

  it("permits one automatic revision on initial build refine", () => {
    expect(
      reviewLoopNext({ pass: 0, maxRevisions: 1, verdict: "refine", hasReview: true })
    ).toBe("revise");
  });

  it("stops immediately on a pass", () => {
    expect(
      reviewLoopNext({ pass: 0, maxRevisions: 1, verdict: "pass", hasReview: true })
    ).toBe("stop");
  });

  it("stops when there is no review to act on", () => {
    expect(
      reviewLoopNext({ pass: 0, maxRevisions: 1, verdict: "refine", hasReview: false })
    ).toBe("stop");
  });
});
