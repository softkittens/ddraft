import type { Document, TextNode } from "../model/types";
import { walkNodes } from "../model/tree";
import { resolveVariable } from "../model/variables";
import { clearTextMetricsCaches } from "../layout/text";

const SYSTEM_FONTS = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "-apple-system",
  "blinkmacsystemfont"
]);

const loaded = new Set<string>();
const inFlight = new Map<string, Promise<boolean>>();

export function isSystemFont(family: string): boolean {
  return SYSTEM_FONTS.has(family.replace(/['"]/g, "").trim().toLowerCase());
}

export function googleFontUrl(family: string): string {
  const name = encodeURIComponent(family.replace(/['"]/g, "").trim()).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${name}&display=swap`;
}

export function clearLoadedFontCache(): void {
  loaded.clear();
  inFlight.clear();
}

export function loadGoogleFont(family: string): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(true);

  const clean = family.replace(/['"]/g, "").trim();
  if (!clean || isSystemFont(clean) || loaded.has(clean)) return Promise.resolve(true);

  const existing = inFlight.get(clean);
  if (existing) return existing;

  const promise = new Promise<boolean>((resolve) => {
    const slug = clean.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const linkId = `gfont-${slug}`;

    if (document.getElementById(linkId)) {
      loaded.add(clean);
      resolve(true);
      return;
    }

    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = googleFontUrl(clean);

    link.onload = async () => {
      try {
        if (document.fonts?.load) {
          const faces = await document.fonts.load(`16px "${clean}"`);
          if (!faces || (Array.isArray(faces) && faces.length === 0)) {
            link.remove();
            resolve(false);
            return;
          }
        }
        loaded.add(clean);
        resolve(true);
      } catch {
        link.remove();
        resolve(false);
      }
    };

    link.onerror = () => {
      link.remove();
      resolve(false);
    };

    document.head.appendChild(link);
  }).finally(() => inFlight.delete(clean));

  inFlight.set(clean, promise);
  return promise;
}

export async function ensureDocumentFonts(doc: Document): Promise<boolean> {
  if (typeof document === "undefined" || !doc) return false;

  const families = new Set<string>();
  walkNodes(doc.children, (node) => {
    if (node.type === "text") {
      const raw = resolveVariable((node as TextNode).fontFamily || "Inter", doc.variables);
      if (raw && !isSystemFont(raw)) {
        families.add(raw.replace(/['"]/g, "").trim());
      }
    }
  });

  const unloads = Array.from(families).filter((f) => !loaded.has(f));
  if (unloads.length === 0) return false;

  const results = await Promise.all(unloads.map(loadGoogleFont));
  if (results.some(Boolean)) {
    clearTextMetricsCaches();
    return true;
  }
  return false;
}
