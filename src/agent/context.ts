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

const MOBILE_SURFACE_PATTERNS = /\b(mobile|phone|ios|android|handheld)\b/i;
const DESKTOP_SURFACE_PATTERNS = /\b(desktop|web|mac|windows|browser)\b/i;

const SITE_ARTIFACT_PATTERNS = /\b(site|website|landing page|web page|homepage|portfolio|storefront)\b/i;
const TOOL_ARTIFACT_PATTERNS = /\b(dashboard|dashboards|console|consoles|workbench|admin|crm|control room|status monitor)\b/i;
const APP_ARTIFACT_PATTERNS = /\b(app|apps|application|deck|player)\b/i;

const DATA_DOMAIN_PATTERNS = /\b(telemetry|metrics|analytics|ops|logs|monitoring|charts|gauges)\b/i;
const EDITORIAL_PATTERNS = /\b(editorial|magazine|article|story|journal|retreat|luxury|boutique|architectural)\b/i;

const EXPLICIT_NEW_BUILD_PATTERNS =
  /\b(create|creates|creating|build|builds|building|generate|generates|start over|from scratch)\b|^\s*design\s+(a|an|the|new|another)\s+(\w+\s+)?(screen|companion|app|site|dashboard|console|page|portfolio|website|version|landing)\b|\bdesign\s+(a|an|new|another)\s+(\w+\s+)?(screen|companion|app|site|dashboard|console|page|portfolio|website|version|landing)\b/i;
const COMPANION_SCREEN_PATTERNS = /\b(companion screen|another screen|new screen|additional screen|mobile version|desktop version)\b/i;
const NEW_BRIEF_PATTERNS = /^\s*(a\s+|an\s+|the\s+)?(landing page|website|portfolio|site|mobile app|app|dashboard|console)\s+for\s+/i;

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

  // Signal 3: Semantic Matching
  const matchesMobileSurface = MOBILE_SURFACE_PATTERNS.test(query);
  const matchesDesktopSurface = DESKTOP_SURFACE_PATTERNS.test(query);

  const matchesSiteArtifact = SITE_ARTIFACT_PATTERNS.test(query);
  const matchesToolArtifact = TOOL_ARTIFACT_PATTERNS.test(query);
  const matchesAppArtifact = APP_ARTIFACT_PATTERNS.test(query);

  const isExplicitNewBuild =
    EXPLICIT_NEW_BUILD_PATTERNS.test(query) ||
    COMPANION_SCREEN_PATTERNS.test(query) ||
    NEW_BRIEF_PATTERNS.test(query);

  // Signal 4: Session Lifecycle
  // On a populated canvas, default to revision_edit unless an explicit build/reset instruction is given.
  const lifecycle: SessionLifecycle =
    hasExistingContent && !isExplicitNewBuild
      ? "revision_edit"
      : "initial_build";

  // Resolve Surface
  let surface: SurfaceTarget = "unspecified";
  if (matchesMobileSurface && (!matchesDesktopSurface || query.includes("mobile") || query.includes("phone"))) {
    surface = "mobile";
  } else if (matchesDesktopSurface && (!matchesMobileSurface || query.includes("desktop") || query.includes("web page") || query.includes("website"))) {
    surface = "desktop";
  } else if (matchesSiteArtifact || matchesToolArtifact) {
    surface = "desktop";
  } else if (matchesAppArtifact && !matchesDesktopSurface) {
    surface = "mobile";
  } else if (selectedSurface) {
    surface = selectedSurface;
  } else if (hasMobile && !hasDesktop) {
    surface = "mobile";
  } else if (hasDesktop && !hasMobile) {
    surface = "desktop";
  } else if (hasMobile && hasDesktop) {
    surface = "both";
  }

  // Resolve Archetype
  let archetype: ProductArchetype = "unspecified";
  if (matchesSiteArtifact) {
    archetype = "site";
  } else if (matchesToolArtifact) {
    archetype = "tool";
  } else if (surface === "mobile" || matchesAppArtifact) {
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

  // Resolve Traits
  const traits: DomainTrait[] = [];
  if (DATA_DOMAIN_PATTERNS.test(fullText) || archetype === "tool") {
    traits.push("data_visualization");
  }
  if (EDITORIAL_PATTERNS.test(fullText) || archetype === "site") {
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
