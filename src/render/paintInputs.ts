import type { Document, Fill, ImageFill } from "../model/types";
import { walkNodes } from "../model/tree";
import { preloadCachedImage } from "./imageCache";
import { ensureDocumentFonts } from "./fontLoader";

export const FONT_WAIT_MS = 3000;
export const IMAGE_WAIT_MS = 1500;

export function imageUrlOf(fill: Fill | Fill[] | undefined): string | undefined {
  const fills = Array.isArray(fill) ? fill : fill ? [fill] : [];
  for (const f of fills) {
    if (f && typeof f === "object" && f.type === "image") {
      const image = f as ImageFill;
      return image.url || image.data;
    }
  }
  return undefined;
}

export function imageUrls(doc: Document): string[] {
  const urls: string[] = [];
  walkNodes(doc.children, (n) => {
    const url = imageUrlOf(n.fill);
    if (url) urls.push(url);
  });
  return urls;
}

/**
 * Ensures all external dependencies (Google Fonts, images) required to accurately
 * paint and layout the document are fetched and ready.
 * Expects a resolved document (with component instances resolved).
 */
export async function waitForPaintInputs(
  resolvedDoc: Document,
  options?: { fontTimeoutMs?: number; imageTimeoutMs?: number }
): Promise<void> {
  const fontTimeout = options?.fontTimeoutMs ?? FONT_WAIT_MS;
  const imageTimeout = options?.imageTimeoutMs ?? IMAGE_WAIT_MS;

  // 1. Font loading with timeout (the explicit loader promise is the readiness authority)
  const fontPromise = ensureDocumentFonts(resolvedDoc);
  const fontWithTimeout = Promise.race([
    fontPromise,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), fontTimeout))
  ]);

  // 2. Image preloading with timeout
  const imagePromise = Promise.all(imageUrls(resolvedDoc).map((url) => preloadCachedImage(url, imageTimeout)));

  // Await both concurrently
  await Promise.all([fontWithTimeout, imagePromise]);
}
