/**
 * The visual review request, and the parsing of what comes back.
 *
 * Separate from review.ts because only the server sends it. review.ts is
 * imported by the chat panel — it applies the critic's property fixes on the
 * client — and this half reads rules.md off disk, which the browser cannot do.
 */
import type { Message } from "./provider";
import type { DesignDirection } from "../design/styleSystem";
import { designReviewSchema, isValidFixValue, SAFE_FIX_PROPERTIES, type DesignReview } from "./review";
import { rules } from "./rules";

export const CRITIC_PROMPT = rules("critic", {
  fixableProperties: Object.keys(SAFE_FIX_PROPERTIES).join(", ")
});

export function criticMessages(input: {
  brief: string;
  screenshotDataUrl: string;
  digest: string;
  direction?: DesignDirection;
  audit?: string;
}): Message[] {
  const direction = input.direction
    ? `\n\nDirection contract:\nTHESIS: ${input.direction.thesis}\nOWN-WORLD: ${input.direction.ownWorld}\nFIRST VIEWPORT: ${input.direction.firstViewport}\nAudit whether the screenshot visibly fulfills each claim.`
    : "";
  const audit = input.audit ? `\n\nDeterministic measurements:\n${input.audit}` : "";
  return [
    { role: "system", content: CRITIC_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: `Brief:\n${input.brief}${direction}${audit}\n\nDigest:\n${input.digest}` },
        { type: "image_url", image_url: { url: input.screenshotDataUrl, detail: "high" } }
      ]
    }
  ];
}

/** Every node id the digest names, so a critic cannot cite one that is not there. */
function knownNodeIds(digestText: string): Set<string> {
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
    })),
    // A fix naming a node that is not on the canvas, a property outside the
    // allowlist, or a value of the wrong shape is dropped rather than applied.
    // The critic cannot see the schema, so it will occasionally invent one.
    fixes: parsed.fixes?.filter((fix) => known.has(fix.nodeId) && isValidFixValue(fix.property, fix.value))
  };
}
