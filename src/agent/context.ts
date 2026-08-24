import type { Document, PenNode } from "../model/types";
import { currentDirection } from "../design/styleSystem";
import { findNode } from "../model/tree";

export type SurfaceTarget = "mobile" | "desktop" | "both" | "unspecified";

export type ProductArchetype =
  | "site"         // Marketing, landing page, portfolio, booking, editorial
  | "tool"         // Console, dashboard, workbench, telemetry, admin
  | "app"          // Mobile-first single-view or tabbed application
  | "unspecified";

export type DomainTrait =
  | "commerce_ordering"   // Cart badges, itemized pricing, quick-add (+), promo banners
  | "swipe_discovery"     // Swipe cards, action docks (pass/like), bio tags
  | "data_visualization"  // Charts, gauges, real-time status indicators
  | "editorial";          // Pull-quotes, photo mosaics, spaces

export type SessionLifecycle = "initial_build" | "revision_edit";

export interface ResolvedContext {
  surface: SurfaceTarget;
  archetype: ProductArchetype;
  traits: DomainTrait[];
  lifecycle: SessionLifecycle;
}

const MOBILE_PATTERNS = /\b(mobile|phone|ios|android|app screen|handheld)\b/i;
const DESKTOP_SITE_PATTERNS = /\b(desktop|site|website|landing page|web page|homepage|web)\b/i;

/**
 * Split deliberately, because these two used to be one list and the seam is
 * where "landing page for an analytics dashboard" became an operations
 * console. An ARTIFACT word names the thing being built; a DOMAIN word only
 * names what the product is about. A domain word may colour the traits. It may
 * never reach past an explicit artifact word and pick the archetype.
 */
const TOOL_ARTIFACT_PATTERNS = /\b(dashboard|dashboards|console|consoles|workbench|admin|crm|control room|status monitor)\b/i;
const DATA_DOMAIN_PATTERNS = /\b(telemetry|metrics|analytics|ops|logs|monitoring)\b/i;

/**
 * Commerce and swipe are mutually exclusive templates — a screen is a
 * storefront or a discovery deck, and dealing both produced pet shops with a
 * cart badge above a Pass/Like dock. STRONG words name the capability itself;
 * WEAK words are just entity nouns that often appear near it, and they only
 * decide when nothing stronger is on the table.
 */
const COMMERCE_STRONG = /\b(order|orders|ordering|cart|checkout|shop|shops|store|stores|storefront|buy|retail|ecommerce|menu|menus)\b/i;
const COMMERCE_WEAK = /\b(cake|cakes|bakery|food|foods|restaurant|restaurants|cafe|cafes|coffee|drop|drops)\b/i;
const SWIPE_STRONG = /\b(tinder|swipe|swipes|swiping|dating|match|matches|matching|adopt|adoption)\b/i;
const SWIPE_WEAK = /\b(discovery|pet|pets|cat|cats|dog|dogs)\b/i;

const DATA_VIZ_PATTERNS = /\b(chart|charts|gauge|gauges|telemetry|metric|metrics|graph|graphs|kpi|series|plot)\b/i;
const EDITORIAL_PATTERNS = /\b(editorial|magazine|article|story|journal|retreat|luxury|boutique|architectural)\b/i;

/**
 * Whether the sentence is asking for something new to exist.
 *
 * Lifecycle used to hang on a list of edit verbs, which meant "make it more
 * polished", "improve the hierarchy" and "revise the hero" were all read as
 * first builds on a canvas that already held a design. Asking the opposite
 * question is far more robust: a new brief names what it wants built, and a
 * revision names a part of what is already there.
 */
const NEW_BUILD_PATTERNS = /\b(create|creates|build|builds|design|generate|start over|from scratch)\b/i;

function hasScreenOfKind(doc: Document | undefined, kind: "mobile" | "desktop"): boolean {
  if (!doc || !Array.isArray(doc.children)) return false;
  return doc.children.some((node: PenNode) => {
    if (node.type !== "frame") return false;
    const metaKind = (node as any).metadata?.screenKind;
    if (kind === "mobile") return metaKind === "mobile" || node.width === 390;
    if (kind === "desktop") return metaKind === "desktop" || node.width === 1440;
    return false;
  });
}

function hasContentNodes(doc: Document | undefined): boolean {
  if (!doc || !Array.isArray(doc.children) || doc.children.length === 0) return false;
  return doc.children.some((screen) => {
    if (screen.type !== "frame") return true;
    return Array.isArray(screen.children) && screen.children.length > 1;
  });
}

function selectedScreenSurface(doc: Document | undefined, selection: string[]): SurfaceTarget | undefined {
  if (!doc || !selection || selection.length === 0) return undefined;
  for (const selId of selection) {
    for (const screen of doc.children) {
      if (screen.type !== "frame") continue;
      if (screen.id === selId || findNode([screen], selId)) {
        if (screen.width === 390 || (screen as any).metadata?.screenKind === "mobile") return "mobile";
        if (screen.width === 1440 || (screen as any).metadata?.screenKind === "desktop") return "desktop";
      }
    }
  }
  return undefined;
}

/**
 * Resolves context through prioritized signals, highest first:
 * 1. Explicit Prompt Intent (e.g. "create mobile version" on an existing desktop canvas)
 * 2. Active Selection Surface (which screen the user is currently focused on)
 * 3. Ground Truth Canvas State (existing screens on canvas)
 * 4. Direction Metadata recorded by an earlier set_style
 * 5. Session history — traits only, and only for a request that names no
 *    artifact of its own
 *
 * The ordering is the point. Every one of these signals used to be able to win,
 * so a product noun from three turns ago could decide what today's request was
 * for. Anything the user said in this message outranks anything they said
 * before it.
 */
export function resolvePromptContext(
  userPrompt = "",
  doc?: Document,
  selection: string[] = [],
  sessionContext = ""
): ResolvedContext {
  const query = userPrompt.trim().toLowerCase();
  const fullText = (query + " " + sessionContext).trim().toLowerCase();

  // Signal 1: Ground Truth Canvas State & Selection
  const hasMobile = hasScreenOfKind(doc, "mobile");
  const hasDesktop = hasScreenOfKind(doc, "desktop");
  const hasExistingContent = hasContentNodes(doc);
  const selectedSurface = selectedScreenSurface(doc, selection);

  // Signal 2: Direction Metadata
  const direction = doc ? currentDirection(doc) : undefined;

  // Signal 3: Semantic Matching — the current request only. Session history is
  // consulted below, and only for traits.
  const matchesMobile = MOBILE_PATTERNS.test(query);
  const matchesDesktopSite = DESKTOP_SITE_PATTERNS.test(query);
  const matchesToolArtifact = TOOL_ARTIFACT_PATTERNS.test(query);
  const matchesTool = matchesToolArtifact || DATA_DOMAIN_PATTERNS.test(query);

  /** The request names the thing it wants built, rather than a part of what exists. */
  const namesOwnArtifact = matchesMobile || matchesDesktopSite || matchesTool;

  // Signal 4: Session Lifecycle
  const lifecycle: SessionLifecycle =
    hasExistingContent && !namesOwnArtifact && !NEW_BUILD_PATTERNS.test(query)
      ? "revision_edit"
      : "initial_build";

  // Resolve Surface
  let surface: SurfaceTarget = "unspecified";
  if (matchesMobile && (!matchesDesktopSite || query.includes("mobile") || query.includes("app screen"))) {
    surface = "mobile";
  } else if (matchesDesktopSite && (!matchesMobile || query.includes("desktop") || query.includes("landing page") || query.includes("website"))) {
    surface = "desktop";
  } else if (matchesTool) {
    surface = "desktop";
  } else if (selectedSurface) {
    surface = selectedSurface;
  } else if (hasMobile && !hasDesktop) {
    surface = "mobile";
  } else if (hasDesktop && !hasMobile) {
    surface = "desktop";
  } else if (hasMobile && hasDesktop) {
    surface = "both";
  } else if (matchesMobile) {
    surface = "mobile";
  }

  // Resolve Archetype
  //
  // Strict precedence: the surface the user asked for, then the artifact the
  // current request names, then the recorded direction, then a bare inference
  // from the canvas. Session history is not consulted at all — a portfolio
  // asked for after a telemetry console is a portfolio.
  let archetype: ProductArchetype = "unspecified";
  if (surface === "mobile") {
    // Both archetype blueprints are 1440-wide compositions. A mobile request
    // that happens to be about telemetry is still a mobile app; the subject
    // matter reaches the traits instead.
    archetype = "app";
  } else if (matchesToolArtifact && !matchesDesktopSite) {
    archetype = "tool";
  } else if (matchesDesktopSite) {
    archetype = "site";
  } else if (matchesMobile) {
    archetype = "app";
  } else if (direction?.thesis) {
    const thesis = direction.thesis.toLowerCase();
    if (thesis.includes("console") || thesis.includes("tool") || thesis.includes("dashboard")) {
      archetype = "tool";
    } else if (thesis.includes("app") || thesis.includes("mobile")) {
      archetype = "app";
    } else {
      archetype = "site";
    }
  } else if (surface === "desktop") {
    archetype = "site";
  }

  // Resolve Domain Traits.
  //
  // A request that names its own artifact is a fresh brief and reads its traits
  // from itself. A follow-up that names none ("make the button darker") is
  // still talking about the last thing built, so it inherits them.
  const traitText = namesOwnArtifact ? query : fullText;
  const traits: DomainTrait[] = [];

  const commerceStrong = COMMERCE_STRONG.test(traitText);
  const swipeStrong = SWIPE_STRONG.test(traitText);
  const commerceAny = commerceStrong || COMMERCE_WEAK.test(traitText);
  const swipeAny = swipeStrong || SWIPE_WEAK.test(traitText);
  if (commerceStrong !== swipeStrong) {
    traits.push(commerceStrong ? "commerce_ordering" : "swipe_discovery");
  } else if (commerceAny !== swipeAny) {
    traits.push(commerceAny ? "commerce_ordering" : "swipe_discovery");
  } else if (commerceAny) {
    // Both, or neither, named their capability. A transaction is the more
    // concrete of the two, and it is the one a shop that also browses needs.
    traits.push("commerce_ordering");
  }

  if (DATA_VIZ_PATTERNS.test(traitText) || DATA_DOMAIN_PATTERNS.test(traitText) || archetype === "tool") {
    traits.push("data_visualization");
  }
  if (EDITORIAL_PATTERNS.test(traitText) || (archetype === "site" && !traits.includes("commerce_ordering"))) {
    traits.push("editorial");
  }

  return {
    surface,
    archetype,
    traits,
    lifecycle
  };
}

const SURFACES: SurfaceTarget[] = ["mobile", "desktop", "both", "unspecified"];
const ARCHETYPES: ProductArchetype[] = ["site", "tool", "app", "unspecified"];
const TRAITS: DomainTrait[] = [
  "commerce_ordering",
  "swipe_discovery",
  "data_visualization",
  "editorial"
];
const LIFECYCLES: SessionLifecycle[] = ["initial_build", "revision_edit"];

/**
 * The context as it arrives over the wire.
 *
 * The critic runs on the server, which has the brief and nothing else — no
 * document, no selection, no session. Re-resolving from the brief alone gave
 * the reviewer a different archetype than the builder had used on the very
 * same run, so the client sends what it resolved and this checks it back into
 * the type. Anything malformed returns undefined and the caller re-resolves.
 */
export function parseResolvedContext(raw: unknown): ResolvedContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const surface = SURFACES.find((v) => v === o.surface);
  const archetype = ARCHETYPES.find((v) => v === o.archetype);
  const lifecycle = LIFECYCLES.find((v) => v === o.lifecycle);
  if (!surface || !archetype || !lifecycle) return undefined;
  const traits = Array.isArray(o.traits)
    ? TRAITS.filter((t) => (o.traits as unknown[]).includes(t))
    : [];
  return { surface, archetype, traits, lifecycle };
}
