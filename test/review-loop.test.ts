import { describe, it, expect } from "bun:test";
import { reviewLoopNext } from "../src/ui/chat/reviewLoop";

describe("visual review loop", () => {
  it("applies a refine that lands on the last review instead of stopping on it", () => {
    // 3fbe82f2: Visual review 3 said refine and the agent stopped.
    expect(
      reviewLoopNext({ pass: 2, maxRevisions: 2, verdict: "refine", hasReview: true })
    ).toBe("apply_last");
  });

  it("keeps revising while the cap still has room", () => {
    expect(
      reviewLoopNext({ pass: 0, maxRevisions: 2, verdict: "refine", hasReview: true })
    ).toBe("revise");
    expect(
      reviewLoopNext({ pass: 1, maxRevisions: 2, verdict: "refine", hasReview: true })
    ).toBe("revise");
  });

  it("stops on a pass, even if reviews remain", () => {
    expect(
      reviewLoopNext({ pass: 0, maxRevisions: 2, verdict: "pass", hasReview: true })
    ).toBe("stop");
  });

  it("stops when there is no review to act on", () => {
    expect(
      reviewLoopNext({ pass: 1, maxRevisions: 2, verdict: "refine", hasReview: false })
    ).toBe("stop");
  });

  it("still revises from a refine even if a later screenshot aborted", () => {
    // 5f5d9706: DeepSeek's follow-up screenshot aborted and dropped the refine.
    expect(
      reviewLoopNext({ pass: 1, maxRevisions: 2, verdict: "refine", hasReview: true })
    ).toBe("revise");
  });
});
