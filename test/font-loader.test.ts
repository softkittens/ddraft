import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  googleFontUrl,
  isSystemFont,
  loadGoogleFont,
  ensureDocumentFonts,
  clearLoadedFontCache
} from "../src/render/fontLoader";
import { waitForPaintInputs } from "../src/render/paintInputs";
import { resolveFontFamily, formatFontString, clearTextMetricsCaches } from "../src/layout/text";
import { measureKey } from "../src/layout/metrics";
import { resolveInstances } from "../src/model/instance";
import type { Document } from "../src/model/types";

describe("Google Fonts URL generation", () => {
  it("encodes font families and formats CSS2 display=swap URL", () => {
    expect(googleFontUrl("Roboto")).toBe("https://fonts.googleapis.com/css2?family=Roboto&display=swap");
    expect(googleFontUrl("Plus Jakarta Sans")).toBe("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans&display=swap");
  });

  it("uses verified multi-axis queries for curated families", () => {
    expect(googleFontUrl("Inter")).toContain("family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900");
    expect(googleFontUrl("Geist")).toContain("family=Geist:wght@100..900");
    expect(googleFontUrl("DM Sans")).toContain("family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000");
    expect(googleFontUrl("Space Grotesk")).toContain("family=Space+Grotesk:wght@300..700");
    expect(googleFontUrl("Newsreader")).toContain("family=Newsreader:ital,opsz,wght@0,6..72,200..800;1,6..72,200..800");
    expect(googleFontUrl("Playfair Display")).toContain("family=Playfair+Display:ital,wght@0,400..900;1,400..900");
    expect(googleFontUrl("Instrument Serif")).toContain("family=Instrument+Serif:ital@0;1");
    expect(googleFontUrl("Anton")).toBe("https://fonts.googleapis.com/css2?family=Anton&display=swap");
    expect(googleFontUrl("Geist Mono")).toContain("family=Geist+Mono:wght@100..900");
    expect(googleFontUrl("IBM Plex Mono")).toContain("family=IBM+Plex+Mono:ital,wght@0,400..700;1,400..700");
  });
});

describe("System font filtering", () => {
  it("filters generic CSS aliases and allows web fonts", () => {
    expect(isSystemFont("sans-serif")).toBe(true);
    expect(isSystemFont("monospace")).toBe(true);
    expect(isSystemFont("system-ui")).toBe(true);
    expect(isSystemFont("Roboto")).toBe(false);
    expect(isSystemFont("Inter")).toBe(false);
    expect(isSystemFont("Outfit")).toBe(false);
  });
});

describe("Fallback stack resolution & font string formatting", () => {
  it("resolves built-in and arbitrary font stacks", () => {
    expect(resolveFontFamily("Inter")).toBe("Inter, sans-serif");
    expect(resolveFontFamily("Fira Code")).toBe("'Fira Code', monospace");
    expect(resolveFontFamily("Newsreader")).toBe("Newsreader, serif");
    expect(resolveFontFamily("Plus Jakarta Sans")).toBe("'Plus Jakarta Sans', sans-serif");
    expect(resolveFontFamily("Outfit")).toBe("Outfit, sans-serif");
  });

  it("formats canonical canvas font strings", () => {
    expect(formatFontString(16, "Inter", "bold", "normal")).toBe("bold 16px Inter, sans-serif");
    expect(formatFontString(24, "Playfair Display", 700, "italic")).toBe("italic 700 24px 'Playfair Display', serif");
    expect(formatFontString(12, "Fira Code", undefined, undefined)).toBe("12px 'Fira Code', monospace");
  });
});

describe("Simulated browser font loading", () => {
  let createdLinks: any[] = [];
  let fontLoadsCalled: string[] = [];
  let originalDocument: any;

  beforeEach(() => {
    clearLoadedFontCache();
    clearTextMetricsCaches();
    createdLinks = [];
    fontLoadsCalled = [];
    originalDocument = (globalThis as any).document;

    (globalThis as any).document = {
      head: {
        appendChild: (el: any) => {
          createdLinks.push(el);
          setTimeout(() => {
            if (el._shouldFail) el.onerror?.(new Event("error"));
            else el.onload?.(new Event("load"));
          }, 5);
          return el;
        }
      },
      getElementById: (id: string) => createdLinks.find((l) => l.id === id) || null,
      createElement: (tag: string) => {
        if (tag === "link") {
          const linkObj: any = {
            id: "",
            rel: "",
            href: "",
            onload: null,
            onerror: null,
            _shouldFail: false,
            remove: () => {
              const idx = createdLinks.indexOf(linkObj);
              if (idx !== -1) createdLinks.splice(idx, 1);
            }
          };
          return linkObj;
        }
        return {};
      },
      fonts: {
        load: (desc: string) => {
          fontLoadsCalled.push(desc);
          return Promise.resolve([{ family: "mock", status: "loaded" }]);
        }
      }
    };
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    clearLoadedFontCache();
  });

  it("injects link element and triggers font loading", async () => {
    const ok = await loadGoogleFont("Outfit");
    expect(ok).toBe(true);
    expect(createdLinks.length).toBe(1);
    expect(createdLinks[0].id).toBe("gfont-outfit");
    expect(createdLinks[0].href).toBe("https://fonts.googleapis.com/css2?family=Outfit&display=swap");
    expect(fontLoadsCalled).toContain('16px "Outfit"');
  });

  it("deduplicates concurrent requests for the same family", async () => {
    const [res1, res2] = await Promise.all([loadGoogleFont("DM Sans"), loadGoogleFont("DM Sans")]);
    expect(res1).toBe(true);
    expect(res2).toBe(true);
    expect(createdLinks.length).toBe(1);
  });

  it("cleans up failed link element on error and permits retry", async () => {
    let fail = true;
    const origAppend = (globalThis as any).document.head.appendChild;
    (globalThis as any).document.head.appendChild = (el: any) => {
      if (fail) el._shouldFail = true;
      return origAppend(el);
    };

    const firstTry = await loadGoogleFont("BrokenFont");
    expect(firstTry).toBe(false);
    expect(createdLinks.length).toBe(0);

    fail = false;
    const retry = await loadGoogleFont("BrokenFont");
    expect(retry).toBe(true);
    expect(createdLinks.length).toBe(1);
  });

  it("cleans up link and returns false when document.fonts.load rejects", async () => {
    (globalThis as any).document.fonts.load = () => Promise.reject(new Error("Font binary network error"));

    const ok = await loadGoogleFont("FailedBinaryFont");
    expect(ok).toBe(false);
  });

  it("times out cleanly when document.fonts.load never settles", async () => {
    (globalThis as any).document.fonts.load = () => new Promise(() => {}); // Never settles

    const ok = await loadGoogleFont("HangingFont", undefined, undefined, 50);
    expect(ok).toBe(false);
  });

  it("ignores late link onload after timeout and does not update loaded cache", async () => {
    let lateOnload: (() => void) | null = null;
    const origAppend = (globalThis as any).document.head.appendChild;
    (globalThis as any).document.head.appendChild = (el: any) => {
      // Don't call onload immediately; capture it to fire later
      setTimeout(() => {
        lateOnload = () => el.onload?.(new Event("load"));
      }, 5);
      return el;
    };

    const ok = await loadGoogleFont("LateFont", undefined, undefined, 20);
    expect(ok).toBe(false);

    // Fire late onload after timeout has already settled
    if (lateOnload) (lateOnload as any)();

    // Restore origAppend so retry can succeed normally
    (globalThis as any).document.head.appendChild = origAppend;

    // The late event must not have marked the font as loaded; retry succeeds
    const retry = await loadGoogleFont("LateFont", undefined, undefined, 100);
    expect(retry).toBe(true);
    expect(createdLinks.filter((l) => l.id === "gfont-latefont").length).toBe(1);
  });

  it("ensures all fonts in a document load and reports new arrivals", async () => {
    const doc: Document = {
      version: "1.0",
      children: [
        {
          id: "screen1",
          type: "frame",
          children: [
            { id: "t1", type: "text", content: "Title", fontFamily: "$font-heading", fontWeight: 700 },
            { id: "t2", type: "text", content: "Code", fontFamily: "Fira Code" }
          ]
        }
      ],
      variables: {
        "font-heading": { type: "string", value: "Playfair Display" }
      }
    };

    const resolved = resolveInstances(doc);
    const loadedFirst = await ensureDocumentFonts(resolved);
    expect(loadedFirst).toBe(true);
    expect(createdLinks.length).toBe(2);
    expect(fontLoadsCalled).toContain('700 16px "Playfair Display"');

    const loadedSecond = await ensureDocumentFonts(resolved);
    expect(loadedSecond).toBe(false);

    // Introducing a new italic face on the same Playfair Display family triggers load
    (doc.children[0] as any).children.push({
      id: "t3",
      type: "text",
      content: "Subtitle",
      fontFamily: "$font-heading",
      fontStyle: "italic",
      fontWeight: 400
    });
    const loadedThird = await ensureDocumentFonts(resolveInstances(doc));
    expect(loadedThird).toBe(true);
    expect(fontLoadsCalled).toContain('italic 400 16px "Playfair Display"');
  });

  it("integrates with waitForPaintInputs", async () => {
    const doc: Document = {
      version: "1.0",
      children: [{ id: "t1", type: "text", content: "Hi", fontFamily: "Space Grotesk" }]
    };

    await waitForPaintInputs(resolveInstances(doc), { fontTimeoutMs: 500, imageTimeoutMs: 500 });
    expect(createdLinks.some((l) => l.id === "gfont-space-grotesk")).toBe(true);
  });
});

describe("Italic measurement key separation", () => {
  it("differentiates measureKey and width cache between normal and italic text", () => {
    const keyNormal = measureKey("Sample", 16, "Inter, sans-serif", 400, 0, "normal");
    const keyItalic = measureKey("Sample", 16, "Inter, sans-serif", 400, 0, "italic");

    expect(keyNormal).toBe("400|16|Inter, sans-serif|0|Sample");
    expect(keyItalic).toBe("italic|400|16|Inter, sans-serif|0|Sample");
    expect(keyNormal).not.toBe(keyItalic);
  });
});
