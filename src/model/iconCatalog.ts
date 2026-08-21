/**
 * The Lucide catalog, read from the installed package.
 *
 * A generated module used to sit here holding 1,776 baked path strings. It was
 * written because the loader before it called `require` — present under Bun,
 * absent in the Vite dev middleware that actually serves the agent — and fell
 * back to a 28-icon core map wherever `require` was missing, silently. Baking
 * the catalog fixed the symptom. The cause was guessing where the package
 * lives: createRequire resolves one known icon through lucide-solid's own
 * export map, which yields the directory holding all of them, from any working
 * directory and any runtime that can read a file.
 *
 * Names come from one directory listing; geometry is read per icon on demand
 * and cached by icons.ts, so a run that draws nine icons reads nine files.
 *
 * Import this from anywhere that resolves icon geometry outside the browser.
 * It stays its own module so the import is a deliberate line in a server file
 * rather than a side effect of touching icons.ts, which the browser bundles.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join } from "node:path";
import { elementToPath, registerIconCatalog } from "./icons";

// The ESM build resolves to .mjs and the CJS build to .js; both declare the
// same iconNode literal, so the extension is read off the anchor rather than
// assumed.
const anchor = createRequire(import.meta.url).resolve("lucide-solid/icons/heart");
const dir = dirname(anchor);
const ext = extname(anchor);

let names: string[] | null = null;

/** The `iconNode` literal an icon module declares, as one SVG path string. */
function geometry(source: string): string {
  const match = source.match(/iconNode\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return "";
  try {
    const nodes = JSON.parse(
      match[1]
        .replace(/key:\s*['"]\w+['"]/g, "")
        .replace(/,\s*}/g, "}")
        .replace(/,\s*\]/g, "]")
        .replace(/([a-zA-Z0-9_]+):/g, '"$1":')
        .replace(/'/g, '"')
    ) as [string, Record<string, unknown>][];
    return nodes.map(([tag, attrs]) => elementToPath(tag, attrs)).filter(Boolean).join(" ");
  } catch {
    // An icon that will not parse is absent rather than broken.
    return "";
  }
}

registerIconCatalog({
  names: () =>
    (names ??= readdirSync(dir)
      .filter((file) => extname(file) === ext)
      .map((file) => basename(file, ext))
      .filter((name) => name !== "index")
      .sort()),
  path: (name) => {
    try {
      return geometry(readFileSync(join(dir, name + ext), "utf8")) || undefined;
    } catch {
      return undefined;
    }
  }
});
