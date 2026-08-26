/**
 * The visual review request, and the parsing of what comes back.
 *
 * Separate from review.ts because only the server sends it. review.ts is
 * imported by the chat panel — it applies the critic's property fixes on the
 * client — and this half reads rules.md off disk, which the browser cannot do.
 */
import type { Message } from "./provider";
import { designReviewSchema, type DesignReview } from "./review";
import { rules } from "./rules";

import { resolvePromptContext, type ResolvedContext } from "./context";

export const BASE_CRITIC_PROMPT = rules("critic");

export const CRITIC_PROMPT = BASE_CRITIC_PROMPT;

/**
 * @param resolved What the builder actually resolved for this run. The server
 *   has only the brief, and re-deriving from it alone let the reviewer judge a
 *   mobile app against the dashboard criteria the builder never received.
 */
export function buildCriticSystemPrompt(brief: string, resolved?: ResolvedContext): string {
  const ctx = resolved ?? resolvePromptContext(brief, undefined, undefined, undefined);
  const sections = [BASE_CRITIC_PROMPT];
  const domainAdditions: string[] = [];

  if (ctx.archetype === "site") {
    domainAdditions.push(
      `DOMAIN-SPECIFIC CRITERIA — MARKETING SITE & LANDING PAGE:`,
      `- Narrative Substance & Composition: The site must have substance and rhythm tailored to the offer's capabilities (First Viewport, concrete offerings/showcase, specifications or atmospheric story, relevant action, and grounding footer when helpful). Do not pass an under-generated site stub with only 1–2 sparse blocks, but do not mandate generic filler furniture like canned testimonials or forced 3-tier pricing on non-commercial offerings.`,
      `- Copy Conciseness & Fit: Text is judged on visual fit, length, and hierarchy (e.g. trimming bloated blurbs, ensuring labels fit containers cleanly, keeping numbers and units readable). Fictional and illustrative mockup copy (realistic transit times, hours, desk counts, quotes) is encouraged and must NOT be flagged as unsupported.`,
      `- Conversion Proportionality: Repeated actions are not automatically consistency. Refine a discovery site that multiplies the same strong booking action across every item and then repeats it in the hero or footer, unless choosing individual items is clearly the central interaction.`,
      `- Direction & Composition as Hypothesis: Faithful execution of the original direction or chosen composition does not make it correct. Return refine if the chosen composition archetype (e.g. attempting a modular bento on a luxury retreat, or a monumental editorial on an operational tool) or visual system contradicts the product's positioning, passenger trust, or actual use scene.`
    );
  }

  if (ctx.archetype === "tool") {
    domainAdditions.push(
      `DOMAIN-SPECIFIC CRITERIA — DASHBOARD & OPERATIONS CONSOLE:`,
      `- Judge capabilities, not template compliance: the operator can read current state, the numbers are specific to this system, and the primary operational action is reachable. Do not require a sidebar, a metric tile row, a table, or an alert queue.`,
      `- Density where there is substance: a column that carries data should reach the bottom rather than stopping halfway. An unused rail or aside is a legitimate choice — inventing telemetry to fill it is the defect, not leaving it empty.`,
      `- Every chart, gauge and track must visibly encode its numbers, and the values it encodes must vary.`
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
  screenshots?: { id?: string; name?: string; dataUrl: string; kind?: "screen" | "section" | "viewport"; parentId?: string }[];
  digest: string;
  audit?: string;
  context?: ResolvedContext;
}): Message[] {
  const audit = input.audit ? `\n\n${input.audit}` : "";

  const contentParts: any[] = [];
  if (input.screenshots && input.screenshots.length > 0) {
    const overviewScreens = input.screenshots.filter((s) => s.kind === "screen" || s.kind === "viewport");
    const sectionScreens = input.screenshots.filter((s) => s.kind === "section");

    let chosenSections = sectionScreens;
    if (sectionScreens.length > 4) {
      const step = (sectionScreens.length - 1) / 3;
      const indices = [0, Math.round(step), Math.round(2 * step), sectionScreens.length - 1];
      chosenSections = Array.from(new Set(indices)).map((i) => sectionScreens[i]);
    }
    const screensToSend = [...overviewScreens, ...chosenSections];
    const hasSections = chosenSections.length > 0;

    contentParts.push({
      type: "text",
      text: `Brief:\n${input.brief}\n\nDigest:\n${input.digest}\n\nAttached screenshots (full screen overview${hasSections ? " and representative section close-ups in layout order" : ""}):`
    });
    for (const s of screensToSend) {
      const header = s.kind === "section"
        ? `--- [Close-up Section: "${s.name || s.id}" (id: #${s.id || "unknown"}, parent: #${s.parentId || "screen"})] ---`
        : s.kind === "viewport"
        ? `--- [Contextual Viewport Crop: "${s.name || s.id}" (parent: #${s.parentId || "screen"}). The crop boundary is not a canvas boundary: content cut by its top or bottom edge is expected and must not be reported as clipping.] ---`
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
      { type: "text", text: `Brief:\n${input.brief}\n\nDigest:\n${input.digest}` },
      { type: "image_url", image_url: { url: input.screenshotDataUrl || "", detail: "high" } }
    );
  }

  if (audit) contentParts.push({ type: "text", text: audit.trim() });

  return [
    { role: "system", content: buildCriticSystemPrompt(input.brief, input.context) },
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
3. Heading clearance: Section titles visibly colliding with, overlapping, or becoming unreadably crowded against adjacent cards. Do not enforce a fixed spacing value when the grouping is visually clear.
4. Typography & Copy: Clipped text lines, stray placeholder punctuation (like lone "-" or "•"), or unreadable contrast (< 3:1).

Return JSON only:
{
  "verdict": "pass" | "refine",
  "scores": { "specificity": 1-5, "hierarchy": 1-5, "usability": 1-5, "craft": 1-5 },
  "strengths": string[0-2],
  "issues": [{ "title": string, "reason": string, "instruction": string, "nodeIds"?: string[] }][0-3]
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
    }))
  };
}
