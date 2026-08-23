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

import { resolvePromptContext } from "./context";

export const BASE_CRITIC_PROMPT = rules("critic", {
  fixableProperties: Object.keys(SAFE_FIX_PROPERTIES).join(", ")
});

export const CRITIC_PROMPT = BASE_CRITIC_PROMPT;

export function buildCriticSystemPrompt(brief: string): string {
  const ctx = resolvePromptContext(brief, undefined, undefined, undefined);
  const sections = [BASE_CRITIC_PROMPT];
  const domainAdditions: string[] = [];

  if (ctx.traits.includes("commerce_ordering")) {
    domainAdditions.push(
      `DOMAIN-SPECIFIC CRITERIA — E-COMMERCE & FOOD ORDERING APP:`,
      `- Scroll Affordance vs Clipping: Multi-section commerce & food ordering feeds are SCROLLABLE feeds (1100–1600px tall). On scrollable feeds, having product cards or the catalog heading peek across the first 844px fold is INTENDED scroll affordance, NOT clipped content! Do NOT ask the agent to squish the catalog or shrink product cards into a single 844px screen.`,
      `- Sibling Card Action Consistency: Every product card offering an item must have matching circular quick-add (+) button containers and bold itemized prices (e.g. "€8.50"). Never accept one card with a styled circular button and a sibling card with a naked text "+" glyph!`,
      `- Real Photography: Every product card MUST show real generated food photography (no blank tinted placeholder boxes).`,
      `- Compact Hero: The hero card must be compact (220px–340px) so the catalog preview starts above the 844px fold.`
    );
  }

  if (ctx.traits.includes("swipe_discovery")) {
    domainAdditions.push(
      `DOMAIN-SPECIFIC CRITERIA — CARD SWIPE / SOCIAL DISCOVERY:`,
      `- Single-Viewport Ceiling: All elements (header, photo card, bio/tags, thumb dock, and tab bar) MUST fit within the 844px viewport without vertical scrolling.`,
      `- Thumb Dock Reach: Centered horizontal action bar with distinct circular buttons (Pass, Star, Like in solid accent).`
    );
  }

  if (ctx.archetype === "site") {
    domainAdditions.push(
      `DOMAIN-SPECIFIC CRITERIA — MARKETING SITE & LANDING PAGE:`,
      `- Information Architecture Depth: The site must have substance and rhythm across 6–8 distinct narrative sections (First Viewport, Spaces/Showcase, Amenities/Specs, Stories, Pricing comparison, Multi-column footer). Do not pass an under-generated site stub with only 2–3 sections.`
    );
  }

  if (ctx.archetype === "tool") {
    domainAdditions.push(
      `DOMAIN-SPECIFIC CRITERIA — DASHBOARD & OPERATIONS CONSOLE:`,
      `- Density & Complete Columns: Multi-column layout with sidebar navigation, metric tiles visibly encoding numbers, operational tables/queues, and columns reaching the bottom of the viewport.`
    );
  }

  if (domainAdditions.length > 0) {
    sections.push("\n\n" + domainAdditions.join("\n"));
  }

  return sections.join("\n");
}

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
    { role: "system", content: buildCriticSystemPrompt(input.brief) },
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
