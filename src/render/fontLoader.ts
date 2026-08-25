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

const CURATED_FONT_AXES: Record<string, string> = {
  "inter": "family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900",
  "geist": "family=Geist:wght@100..900",
  "dm sans": "family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000",
  "space grotesk": "family=Space+Grotesk:wght@300..700",
  "funnel display": "family=Funnel+Display:wght@300..800",
  "newsreader": "family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800",
  "playfair display": "family=Playfair+Display:ital,wght@0,400..900;1,400..900",
  "instrument serif": "family=Instrument+Serif:ital@0;1",
  "fraunces": "family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900",
  "cormorant garamond": "family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700",
  "eb garamond": "family=EB+Garamond:ital,wght@0,400..800;1,400..800",
  "cardo": "family=Cardo:ital,wght@0,400;0,700;1,400",
  "dm serif display": "family=DM+Serif+Display:ital@0;1",
  "bodoni moda": "family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..900;1,6..96,400..900",
  "spectral": "family=Spectral:ital,wght@0,200..800;1,200..800",
  "crimson pro": "family=Crimson+Pro:ital,wght@0,200..900;1,200..900",
  "source serif 4": "family=Source+Serif+4:ital,opsz,wght@0,8..60,200..900;1,8..60,200..900",
  "cinzel": "family=Cinzel:wght@400..900",
  "bricolage grotesque": "family=Bricolage+Grotesque:opsz,wght@12..96,200..800",
  "syne": "family=Syne:wght@400..800",
  "unbounded": "family=Unbounded:wght@200..900",
  "plus jakarta sans": "family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800",
  "outfit": "family=Outfit:wght@100..900",
  "big shoulders display": "family=Big+Shoulders+Display:wght@100..900",
  "chivo": "family=Chivo:ital,wght@0,100..900;1,100..900",
  "epilogue": "family=Epilogue:ital,wght@0,100..900;1,100..900",
  "hanken grotesk": "family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900",
  "anton": "family=Anton",
  "geist mono": "family=Geist+Mono:wght@100..900",
  "ibm plex mono": "family=IBM+Plex+Mono:ital,wght@0,400..700;1,400..700",
  "jetbrains mono": "family=JetBrains+Mono:ital,wght@0,100..800;1,100..800",
  "space mono": "family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700",
  "fira code": "family=Fira+Code:wght@300..700",
  "dm mono": "family=DM+Mono:ital,wght@0,300..500;1,300..500"
};

export const DEFAULT_FONT_TIMEOUT_MS = 3000;

const loadedLinks = new Set<string>();
const loadedFaces = new Set<string>();
const inFlightLinks = new Map<string, Promise<boolean>>();

export function isSystemFont(family: string): boolean {
  return SYSTEM_FONTS.has(family.replace(/['"]/g, "").trim().toLowerCase());
}

export function googleFontUrl(family: string): string {
  const clean = family.replace(/['"]/g, "").trim();
  const key = clean.toLowerCase();
  const query = CURATED_FONT_AXES[key];
  if (query) {
    return `https://fonts.googleapis.com/css2?${query}&display=swap`;
  }
  const name = encodeURIComponent(clean).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${name}&display=swap`;
}

export function faceKey(family: string, weight?: string | number, fontStyle?: string): string {
  const clean = family.replace(/['"]/g, "").trim().toLowerCase();
  const w = weight ? String(weight) : "400";
  const s = fontStyle === "italic" ? "italic" : "normal";
  return `${clean}:${w}:${s}`;
}

export function clearLoadedFontCache(): void {
  loadedLinks.clear();
  loadedFaces.clear();
  inFlightLinks.clear();
}

export async function loadGoogleStylesheet(clean: string, timeoutMs = DEFAULT_FONT_TIMEOUT_MS): Promise<boolean> {
  if (typeof document === "undefined") return true;
  const linkKey = clean.toLowerCase();
  if (loadedLinks.has(linkKey)) return true;

  const existing = inFlightLinks.get(linkKey);
  if (existing) return existing;

  const slug = clean.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const linkId = `gfont-${slug}`;

  if (document.getElementById(linkId)) {
    loadedLinks.add(linkKey);
    return true;
  }

  const p = new Promise<boolean>((resolve) => {
    let settled = false;
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = googleFontUrl(clean);

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        link.onload = null;
        link.onerror = null;
        link.remove();
        resolve(false);
      }, timeoutMs);
    }

    link.onload = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      loadedLinks.add(linkKey);
      resolve(true);
    };

    link.onerror = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      link.remove();
      resolve(false);
    };

    document.head.appendChild(link);
  }).finally(() => inFlightLinks.delete(linkKey));

  inFlightLinks.set(linkKey, p);
  return p;
}

export async function loadGoogleFont(
  family: string,
  weight?: string | number,
  fontStyle?: string,
  timeoutMs = DEFAULT_FONT_TIMEOUT_MS
): Promise<boolean> {
  if (typeof document === "undefined") return true;

  const clean = family.replace(/['"]/g, "").trim();
  if (!clean || isSystemFont(clean)) return true;

  const fKey = faceKey(clean, weight, fontStyle);
  if (loadedFaces.has(fKey)) return true;

  const stylesheetOk = await loadGoogleStylesheet(clean, timeoutMs);
  if (!stylesheetOk) return false;

  let fontTimer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    if (timeoutMs > 0) {
      fontTimer = setTimeout(() => resolve(false), timeoutMs);
    }
  });

  const fontLoadPromise = (async () => {
    try {
      if (document.fonts?.load) {
        const stylePrefix = fontStyle === "italic" ? "italic " : "";
        const weightStr = weight ? `${weight} ` : "";
        const fontDescriptor = `${stylePrefix}${weightStr}16px "${clean}"`.trim();
        const faces = await document.fonts.load(fontDescriptor);
        if (!faces || (Array.isArray(faces) && faces.length === 0)) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  })();

  const ok = await Promise.race([fontLoadPromise, timeoutPromise]);
  if (fontTimer) clearTimeout(fontTimer);

  if (ok) {
    loadedFaces.add(fKey);
    return true;
  }
  return false;
}

export async function ensureDocumentFonts(doc: Document, timeoutMs = DEFAULT_FONT_TIMEOUT_MS): Promise<boolean> {
  if (typeof document === "undefined" || !doc) return false;

  interface FaceSpec {
    family: string;
    weight?: string | number;
    fontStyle?: string;
  }

  const usedFaces: FaceSpec[] = [];
  const seen = new Set<string>();

  walkNodes(doc.children, (node) => {
    if (node.type === "text") {
      const text = node as TextNode;
      const raw = resolveVariable(text.fontFamily || "Inter", doc.variables);
      if (raw && !isSystemFont(raw)) {
        const family = raw.replace(/['"]/g, "").trim();
        const key = faceKey(family, text.fontWeight, text.fontStyle);
        if (!seen.has(key)) {
          seen.add(key);
          usedFaces.push({
            family,
            weight: text.fontWeight,
            fontStyle: text.fontStyle
          });
        }
      }
    }
  });

  const unloads = usedFaces.filter((f) => !loadedFaces.has(faceKey(f.family, f.weight, f.fontStyle)));
  if (unloads.length === 0) return false;

  const results = await Promise.all(unloads.map((f) => loadGoogleFont(f.family, f.weight, f.fontStyle, timeoutMs)));
  if (results.some(Boolean)) {
    clearTextMetricsCaches();
    return true;
  }
  return false;
}
