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

const MOBILE_PATTERNS = /\b(mobile|iphone|ios|android|phone|app|apps|swipe|tinder|bottom nav|tab bar|touch)\b/i;
const DESKTOP_SITE_PATTERNS = /\b(landing page|website|site|sites|homepage|portfolio|company|storefront|coworking|hotel|retreat|spaces)\b/i;
const TOOL_DASHBOARD_PATTERNS = /\b(dashboard|dashboards|console|consoles|workbench|telemetry|metrics|analytics|admin|crm|ops|control room|status monitor|logs)\b/i;
const COMMERCE_PATTERNS = /\b(order|orders|ordering|cake|cakes|bakery|food|foods|restaurant|restaurants|menu|menus|cafe|cafes|coffee|shop|shops|store|stores|buy|retail|ecommerce|cart|checkout|drop|drops)\b/i;
const SWIPE_PATTERNS = /\b(tinder|match|matches|matching|dating|swipe|swipes|swiping|discovery|adopt|adoption|pet|pets|cat|cats|dog|dogs)\b/i;
const DATA_VIZ_PATTERNS = /\b(chart|charts|gauge|gauges|telemetry|metric|metrics|graph|graphs|kpi|series|plot)\b/i;
const EDITORIAL_PATTERNS = /\b(editorial|magazine|article|story|journal|retreat|luxury|boutique|architectural)\b/i;

const EDIT_INSTRUCTION_PATTERNS = /\b(change|fix|update|move|resize|adjust|recolor|replace|make the|set the|align|tweak|remove|delete|add an icon)\b/i;

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
 * Resolves context through prioritized signals:
 * 1. Explicit Prompt Intent (e.g. "create mobile version" on an existing desktop canvas)
 * 2. Active Selection Surface (which screen the user is currently focused on)
 * 3. Ground Truth Canvas State (existing screens on canvas)
 * 4. Session Lifecycle (initial build vs revision edit)
 * 5. Direction Metadata & Multi-turn Trait Continuity
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

  // Signal 2: Session Lifecycle
  const isIncrementalEdit = hasExistingContent && EDIT_INSTRUCTION_PATTERNS.test(query);
  const lifecycle: SessionLifecycle = isIncrementalEdit ? "revision_edit" : "initial_build";

  // Signal 3: Direction Metadata
  const direction = doc ? currentDirection(doc) : undefined;

  // Signal 4: Semantic Matching
  const matchesMobile = MOBILE_PATTERNS.test(query);
  const matchesDesktopSite = DESKTOP_SITE_PATTERNS.test(query);
  const matchesTool = TOOL_DASHBOARD_PATTERNS.test(query);

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
  let archetype: ProductArchetype = "unspecified";
  if (matchesTool || TOOL_DASHBOARD_PATTERNS.test(fullText)) {
    archetype = "tool";
  } else if (surface === "mobile" || (matchesMobile && !matchesDesktopSite)) {
    archetype = "app";
  } else if (matchesDesktopSite || (!matchesTool && surface === "desktop")) {
    archetype = "site";
  } else if (direction?.thesis) {
    const thesis = direction.thesis.toLowerCase();
    if (thesis.includes("console") || thesis.includes("tool") || thesis.includes("dashboard")) {
      archetype = "tool";
    } else if (thesis.includes("app") || thesis.includes("mobile")) {
      archetype = "app";
    } else {
      archetype = "site";
    }
  }

  // Resolve Domain Traits (across query + multi-turn session history)
  const traits: DomainTrait[] = [];
  if (COMMERCE_PATTERNS.test(fullText)) {
    traits.push("commerce_ordering");
  }
  if (SWIPE_PATTERNS.test(fullText)) {
    traits.push("swipe_discovery");
  }
  if (DATA_VIZ_PATTERNS.test(fullText) || archetype === "tool") {
    traits.push("data_visualization");
  }
  if (EDITORIAL_PATTERNS.test(fullText) || (archetype === "site" && !COMMERCE_PATTERNS.test(fullText))) {
    traits.push("editorial");
  }

  return {
    surface,
    archetype,
    traits,
    lifecycle
  };
}
