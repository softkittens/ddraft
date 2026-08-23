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
  screenshotDataUrl?: string;
  screenshots?: { id?: string; name?: string; dataUrl: string; kind?: "screen" | "section"; parentId?: string }[];
  digest: string;
  direction?: DesignDirection;
  audit?: string;
}): Message[] {
  const direction = input.direction
    ? `\n\nDirection contract:\nTHESIS: ${input.direction.thesis}\nOWN-WORLD: ${input.direction.ownWorld}\nFIRST VIEWPORT: ${input.direction.firstViewport}\nAudit whether the screenshot visibly fulfills each claim.`
    : "";
  const audit = input.audit ? `\n\nDeterministic measurements:\n${input.audit}` : "";

  const contentParts: any[] = [];
  if (input.screenshots && input.screenshots.length > 0) {
    contentParts.push({
      type: "text",
      text: `Brief:\n${input.brief}${direction}${audit}\n\nDigest:\n${input.digest}\n\nAttached screenshots (full screens and high-resolution section close-ups):`
    });
    for (const s of input.screenshots) {
      const header = s.kind === "section"
        ? `--- [Close-up Section: "${s.name || s.id}" (id: #${s.id || "unknown"}, parent: #${s.parentId || "screen"})] ---`
        : `--- [Full Screen: "${s.name || s.id || "Frame"}" (id: #${s.id || "unknown"})] ---`;
      contentParts.push({
        type: "text",
        text: header
      });
      contentParts.push({
        type: "image_url",
        image_url: { url: s.dataUrl, detail: "high" }
      });
    }
  } else {
    contentParts.push(
      { type: "text", text: `Brief:\n${input.brief}${direction}${audit}\n\nDigest:\n${input.digest}` },
      { type: "image_url", image_url: { url: input.screenshotDataUrl || "", detail: "high" } }
    );
  }

  return [
    { role: "system", content: CRITIC_PROMPT },
    {
      role: "user",
      content: contentParts
    }
  ];
}

export function sectionCriticMessages(input: {
  brief: string;
  section: { id?: string; name?: string; dataUrl: string; parentId?: string };
  digest: string;
}): Message[] {
  const sectionName = input.section.name || input.section.id || "Section";
  return [
    {
      role: "system",
      content: `You are an expert visual design critic evaluating ONE specific section of a design: "${sectionName}".
You cannot edit the document. Judge what is visible in the provided section close-up image.

MANDATORY REFINE CRITERIA FOR THIS SECTION:
1. Element containment: Any button, text block, or badge extending, bleeding, or clipped outside its parent card/frame border.
2. Sibling card balance: Sibling cards in a horizontal row having uneven card heights or vertically staggered CTA button baselines.
3. Heading clearance: Section titles colliding with or touching the top borders of cards (needs >= 24px clearance).
4. Typography & Copy: Clipped text lines, stray placeholder punctuation (like lone "-" or "•"), or unreadable contrast (< 3:1).

Return JSON only:
{
  "verdict": "pass" | "refine",
  "scores": { "specificity": 1-5, "hierarchy": 1-5, "usability": 1-5, "craft": 1-5 },
  "strengths": string[0-2],
  "issues": [{ "title": string, "reason": string, "instruction": string, "nodeIds"?: string[] }][0-3],
  "fixes": [{ "nodeId": string, "property": string, "value": any }][0-8]
}`
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Section: "${sectionName}" (id: #${input.section.id || "unknown"})\nBrief: ${input.brief}\n\nSection Digest:\n${input.digest}\n\nInspect this section close-up image carefully:`
        },
        {
          type: "image_url",
          image_url: { url: input.section.dataUrl, detail: "high" }
        }
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
