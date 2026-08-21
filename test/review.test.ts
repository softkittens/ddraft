import { describe, it, expect } from "bun:test";
import {
  applyReviewMessage,
  criticMessages,
  parseDesignReview,
  type DesignReview
} from "../src/agent/review";

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

  it("turns review issues into a visible user revision message", () => {
    const text = applyReviewMessage("A reading site", parseDesignReview(review, "title Home"));
    expect(text).toContain("Original brief: A reading site");
    expect(text).toContain("Weak hierarchy (title)");
    expect(text).toContain("Make the heading 28px");
    expect(text).not.toContain("ghost");
  });
});
