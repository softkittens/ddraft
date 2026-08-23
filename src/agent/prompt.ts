import type { Document, PenNode } from "../model/types";
import { digest, digestSubtree } from "../digest/digest";
import { findNode } from "../model/tree";
import { currentDirection, styleCatalog, styleGuidelines, currentStyle } from "../design/styleSystem";
import type { Message } from "./provider";
import { avoidanceNote, type StyleRun } from "../design/history";
import { rules } from "./rules";

function describe(node: PenNode): string {
  const name = node.name ? ` "${node.name}"` : "";
  const fill = (node as any).fill;
  const isImg =
    fill?.type === "image" || (Array.isArray(fill) && fill.some((f: any) => f?.type === "image"));
  return `${node.id} (${node.type}${name})${isImg ? " [has an image fill]" : ""}`;
}

function selectionLines(doc: Document, selection: string[]): string[] {
  const found = selection
    .map((id) => findNode(doc.children, id))
    .filter((n): n is PenNode => n !== null);

  if (found.length === 0) {
    return ['Selection: nothing is selected. "this" and "the canvas" mean the whole document.'];
  }
  if (found.length === 1) {
    return [
      `Selection: ${describe(found[0])}. "this", "the selection" and "it" mean that node.`,
      "Selected subtree:",
      digestSubtree(doc, found[0].id)
    ];
  }
  return [
    `Selection: ${found.length} nodes — ${found.map(describe).join(", ")}.`,
    '"this" and "the selection" mean those nodes.'
  ];
}

/**
 * How many replies the model gets before the run is cut off.
 *
 * It lives here because the prompt states it and the session enforces it, and
 * the two used to be different quantities: the prompt asked for "about 25 tool
 * calls" while the loop counted 30 model rounds. A model batching four calls
 * into one reply was over the budget it had been given and nowhere near the one
 * that would stop it, and a run that ended at the ceiling had exceeded neither
 * in any way it could have seen coming.
 */
export const MAX_MODEL_ROUNDS = 100;

import { resolvePromptContext, type ResolvedContext } from "./context";

export { resolvePromptContext, type ResolvedContext };

export function composeRuleBlocks(ctx: ResolvedContext): string[] {
  const blocks: string[] = [];

  // 1. Surface Blueprints
  if (ctx.surface === "mobile" || ctx.surface === "both" || ctx.surface === "unspecified") {
    blocks.push(rules("surface-mobile"));
  }
  if (ctx.surface === "desktop" || ctx.surface === "both" || ctx.surface === "unspecified") {
    blocks.push(rules("surface-desktop"));
  }

  // 2. Archetype Guidelines
  if (ctx.archetype === "site") {
    blocks.push(rules("archetype-site"));
  } else if (ctx.archetype === "tool") {
    blocks.push(rules("archetype-tool"));
  } else if (ctx.archetype === "unspecified" && (ctx.surface === "desktop" || ctx.surface === "unspecified")) {
    blocks.push(rules("archetype-site"));
    blocks.push(rules("archetype-tool"));
  }

  // 3. Domain Traits
  if (ctx.traits.includes("commerce_ordering")) {
    blocks.push(rules("trait-commerce"));
  }
  if (ctx.traits.includes("swipe_discovery")) {
    blocks.push(rules("trait-swipe"));
  }

  return blocks;
}

function orderOfWork(ctx: ResolvedContext): string[] {
  if (ctx.lifecycle === "revision_edit") {
    return [
      "ORDER OF WORK — REVISION & INCREMENTAL EDITS",
      "  1. Inspect the selection and document digest to locate target nodes.",
      "  2. Apply precise edits with batch_set_properties, set_properties, or insert_node.",
      "  3. Maintain existing style tokens ($surface-*, $foreground-*, $accent-*, $radius-*) and alignment.",
      "  4. Keep edits focused directly on the user request without rebuilding unrelated screens."
    ];
  }
  return [
    "ORDER OF WORK — DESIGN REQUESTS ONLY",
    "  1. Decide SITE (persuade) vs TOOL (operate) from the surface, not the product.",
    "     A landing page is still SITE. Write THESIS, OWN-WORLD and FIRST VIEWPORT.",
    "  2. set_style — commit to that contract and pick the visual system that supports it.",
    "  3. Screen creation discipline:",
    "     - SINGLE-SCREEN DEFAULT: Build ONE primary screen per request (Desktop 1440 for websites, web tools, dashboards, and landing pages; Mobile 390 for mobile-only apps). Do NOT build a companion mobile screen unless the user explicitly requests mobile or responsive in their brief.",
    "     - When mobile is explicitly requested: Build the Desktop screen FIRST. Only after Desktop is complete, create Mobile by reusing the exact image fills (fill: { type: 'image', url: '...' }) and copy from desktop without generating new images.",
    "  4. Insert whole subtrees. Site: fill topBar; leave rail and aside empty; stack 6–8 varied narrative bands in main to explore the product's full substance (hero, philosophy, spaces/catalog, specs/amenities, photo story, pricing, deep footer).",
    "     Tool: fill only the slots needed. Empty is better than costume. Mobile: content or bleed.",
    "  5. Finish once the screens hold the product. An unused desktop slot is allowed."
  ];
}

export function agentSystemPrompt(
  doc: Document,
  selection: string[] = [],
  modelName?: string,
  paletteSeed = 0,
  recentStyles: readonly StyleRun[] = [],
  userPrompt = "",
  sessionContext = ""
): string {
  const style = currentStyle(doc);
  const direction = currentDirection(doc);
  const resolvedCtx = resolvePromptContext(userPrompt, doc, selection, sessionContext);
  const dynamicRules = composeRuleBlocks(resolvedCtx);

  const styleSection = style
    ? [
        "The document already has a style. Keep it for normal edits.",
        "For a new product, redesign or visual exploration, call set_style and",
        "choose a materially different direction.",
        "",
        styleGuidelines(style)
      ]
    : [
        "No style is set on this document yet.",
        "Call set_style first. Choose the combination that suits the product in the",
        "brief — a safety-critical tool and a children's app should not land on the",
        "same palette. Read the feel of each option and commit to one.",
        "",
        styleCatalog(paletteSeed),
        ...(avoidanceNote(recentStyles) ? ["", avoidanceNote(recentStyles)] : [])
      ];

  return [
    `You are a product designer working directly on a .pen canvas${modelName ? ` (model: ${modelName})` : ""}.`,
    "Decide whether the request requires design work. If it does, use canvas tools",
    "to produce screens with real content and a consistent visual system. Otherwise,",
    "call answer_user with the complete reply and do not change the canvas. Never",
    "combine answer_user with a canvas tool.",
    "",
    ...orderOfWork(resolvedCtx),
    "",
    ...styleSection,
    ...(direction ? [
      "",
      "RECORDED DIRECTION CONTRACT",
      `  THESIS: ${direction.thesis}`,
      `  OWN-WORLD: ${direction.ownWorld}`,
      `  FIRST VIEWPORT: ${direction.firstViewport}`,
      "Build and review against these claims. A claim not visible on the canvas is unfinished."
    ] : []),
    "",
    // Dynamically composed surface blueprints, archetype guides & domain traits
    ...dynamicRules.flatMap((r) => [r, ""]),
    rules("craft-rules"),
    "",
    rules("canvas-api"),
    "",
    "BUDGET",
    `  ${MAX_MODEL_ROUNDS} rounds. A round is one reply, however many tool calls it carries,`,
    "  so send the whole next step at once. When tweaking multiple properties,",
    "  use batch_set_properties or multiple tool calls in one round. Reuse ids from earlier tool results",
    "  instead of reading the canvas again to find them.",
    "",
    "REPLY",
    "  Say what the product is, what each screen does, and why the layout is the way",
    "  it is. Two or three sentences. Do not list the nodes you created.",
    "",
    ...selectionLines(doc, selection),
    "",
    "Current document digest:",
    digest(doc)
  ].join("\n");
}

function extractUserPrompts(messages: Message[]): { latest: string; all: string } {
  const userTexts: string[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (typeof m.content === "string" && m.content.trim()) {
        userTexts.push(m.content.trim());
      } else if (Array.isArray(m.content)) {
        const text = m.content
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => part.text.trim())
          .filter(Boolean)
          .join(" ");
        if (text) userTexts.push(text);
      }
    }
  }
  const latest = userTexts[userTexts.length - 1] ?? "";
  const all = userTexts.join(" ");
  return { latest, all };
}

/**
 * The brief picks the hand. Two different products see two different sets of
 * palettes; the same brief re-run sees the same set, so an eval stays
 * comparable.
 */
function paletteSeedFor(messages: Message[]): number {
  const { latest } = extractUserPrompts(messages);
  let hash = 0x811c9dc5;
  for (let i = 0; i < latest.length; i++) {
    hash = Math.imul(hash ^ latest.charCodeAt(i), 0x01000193);
  }
  return hash | 0;
}

export function withSystemPrompt(
  messages: Message[],
  doc: Document,
  selection: string[] = [],
  modelName?: string,
  recentStyles: readonly StyleRun[] = []
): Message[] {
  const { latest, all } = extractUserPrompts(messages);
  return [
    {
      role: "system",
      content: agentSystemPrompt(doc, selection, modelName, paletteSeedFor(messages), recentStyles, latest, all)
    },
    ...messages.filter((m) => m.role !== "system")
  ];
}
