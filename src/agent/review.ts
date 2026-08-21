import { z } from "zod";
import type { Message } from "./provider";

export const designReviewSchema = z.object({
  verdict: z.enum(["pass", "refine"]),
  scores: z.object({
    specificity: z.number().int().min(1).max(5),
    hierarchy: z.number().int().min(1).max(5),
    usability: z.number().int().min(1).max(5),
    craft: z.number().int().min(1).max(5)
  }),
  strengths: z.array(z.string()).max(2),
  issues: z.array(z.object({
    title: z.string(),
    reason: z.string(),
    instruction: z.string(),
    nodeIds: z.array(z.string()).optional()
  })).max(3)
});

export type DesignReview = z.infer<typeof designReviewSchema>;

export const CRITIC_PROMPT = [
  "You are an independent visual design critic. You cannot edit the document.",
  "Judge only what is visible in the screenshot, using the brief and the compact digest for names and ids.",
  "Every issue must cite visible evidence and give a concrete revision instruction.",
  "Return JSON only, matching this shape:",
  '{ "verdict": "pass" | "refine", "scores": { "specificity": 1-5, "hierarchy": 1-5, "usability": 1-5, "craft": 1-5 }, "strengths": string[0-2], "issues": [{ "title", "reason", "instruction", "nodeIds"?: string[] }][0-3] }',
  "Do not invent node ids. Omit nodeIds when the digest does not contain them."
].join("\n");

export function criticMessages(input: {
  brief: string;
  screenshotDataUrl: string;
  digest: string;
}): Message[] {
  return [
    { role: "system", content: CRITIC_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: `Brief:\n${input.brief}\n\nDigest:\n${input.digest}` },
        { type: "image_url", image_url: { url: input.screenshotDataUrl, detail: "high" } }
      ]
    }
  ];
}

export function knownNodeIds(digestText: string): Set<string> {
  const ids = new Set<string>();
  for (const line of digestText.split("\n")) {
    const token = line.trim().split(/\s+/)[0];
    if (token && token !== "Variables:") ids.add(token);
  }
  return ids;
}

export function parseDesignReview(raw: unknown, digestText: string): DesignReview {
  const parsed = designReviewSchema.parse(raw);
  const known = knownNodeIds(digestText);
  return {
    ...parsed,
    issues: parsed.issues.map((issue) => ({
      ...issue,
      nodeIds: issue.nodeIds?.filter((id) => known.has(id))
    }))
  };
}

export function applyReviewMessage(brief: string, review: DesignReview): string {
  const lines = [
    `Original brief: ${brief}`,
    "Revise the current document using these critic instructions:"
  ];
  for (const issue of review.issues) {
    const where = issue.nodeIds && issue.nodeIds.length > 0 ? ` (${issue.nodeIds.join(", ")})` : "";
    lines.push(`- ${issue.title}${where}: ${issue.instruction}`);
  }
  return lines.join("\n");
}
