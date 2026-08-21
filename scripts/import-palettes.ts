/**
 * Convert OpenDesign design systems into pen palettes.
 *
 *   bun run palettes [path-to-open-design]
 *
 * Source: https://github.com/nexu-io/open-design (Apache-2.0). Every system
 * there declares the same sixteen colour tokens, so the mapping is mechanical.
 * Only the aesthetic-named systems are imported — brand impressions are left
 * out, because a cat app should not arrive dressed as a payments company.
 *
 * Writes src/design/palettes.imported.json, which is committed. Nothing reads
 * OpenDesign at runtime.
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

/** Worlds, not brands. Each names a material or a graphic tradition. */
const WANTED = [
  "agentic", "application", "artistic", "atelier-zero", "bento", "bold", "brutalism",
  "cafe", "clean", "claymorphism", "colorful", "contemporary", "corporate", "cosmic",
  "creative", "dashboard", "dithered", "doodle", "dramatic", "editorial", "elegant",
  "energetic", "enterprise", "expressive", "fantasy", "flat", "friendly", "futuristic",
  "glassmorphism", "gradient", "hud", "luxury", "minimal", "mission-control", "modern",
  "mono", "neobrutalism", "neon", "neumorphism", "paper", "perspective", "premium",
  "professional", "publication", "refined", "retro", "simple", "skeumorphism", "sleek",
  "spacious", "storytelling", "totality-festival", "trading-terminal", "urdu",
  "vibrant", "vintage", "warm-editorial"
];

/** pen role ← OpenDesign token. */
const ROLE_MAP: Record<string, string> = {
  "surface-primary": "--bg",
  "surface-secondary": "--surface",
  "foreground-primary": "--fg",
  "foreground-secondary": "--fg-2",
  "foreground-muted": "--muted",
  "border-subtle": "--border",
  "accent-primary": "--accent"
};

/**
 * $accent-secondary is pen's signal colour: status, badges, at most a few
 * instances per screen. OpenDesign ships three semantic signals and no second
 * brand hue, so the palette picks whichever of them is legible on the ground
 * and reads as a different colour from the primary accent. Fixing this to one
 * token dropped a third of the catalog on a mapping choice, not a defect.
 */
const SIGNAL_TOKENS = ["--danger", "--warn", "--success"];

type Rgb = [number, number, number];

function parseColor(raw: string | undefined, all: Record<string, string>, depth = 0): Rgb | null {
  if (!raw || depth > 4) return null;
  const value = raw.trim();

  const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (alias) return parseColor(all[alias[1]], all, depth + 1);

  const six = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (six) {
    const v = six[1];
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }
  const three = /^#([0-9a-fA-F]{3})$/.exec(value);
  if (three) {
    const v = three[1];
    return [0, 1, 2].map((i) => parseInt(v[i] + v[i], 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

const hex = (c: Rgb) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * pen's shipped-palette invariants, copied from the two tests that enforce them
 * (test/audit.test.ts "every palette clears its contrast requirements" and
 * test/scaffold.test.ts "holds every token that may carry text to 4.5:1 on both
 * surfaces"). A palette that fails any of them is dropped here rather than
 * shipped and caught later: headings are held to 7:1 and anything that can
 * carry small text to 4.5:1. $accent-primary is held to 3:1 instead — it draws
 * icons, indicators, focus rings and solid fills, never small text. Holding it
 * to a text ratio is what kept every bright-accent world out of the catalog.
 */
const GATES: { label: string; from: string; on: string; min: number }[] = [
  { label: "heading on ground", from: "foreground-primary", on: "surface-primary", min: 7 },
  { label: "heading on panel", from: "foreground-primary", on: "surface-secondary", min: 7 },
  { label: "body on ground", from: "foreground-secondary", on: "surface-primary", min: 4.5 },
  { label: "body on panel", from: "foreground-secondary", on: "surface-secondary", min: 4.5 },
  { label: "muted on ground", from: "foreground-muted", on: "surface-primary", min: 3 },
  { label: "muted on panel", from: "foreground-muted", on: "surface-secondary", min: 3 },
  { label: "accent on ground", from: "accent-primary", on: "surface-primary", min: 3 },
  { label: "accent on panel", from: "accent-primary", on: "surface-secondary", min: 3 },
  { label: "signal on ground", from: "accent-secondary", on: "surface-primary", min: 3 }
];

function hue([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

function hueGap(a: Rgb, b: Rgb): number {
  const raw = Math.abs(hue(a) - hue(b));
  return raw > 180 ? 360 - raw : raw;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

function describe(dir: string, root: string): string {
  const path = join(root, dir, "DESIGN.md");
  if (!existsSync(path)) return "";
  for (const line of readFileSync(path, "utf8").split("\n").slice(0, 12)) {
    const text = line.trim();
    if (!text.startsWith(">")) continue;
    const body = text.replace(/^>\s*/, "");
    if (!body || body.startsWith("Category:")) continue;
    return body.replace(/\s+/g, " ").trim();
  }
  return "";
}

function title(id: string): string {
  return id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const root = process.argv[2] || join(process.env.HOME || "", "Sites/open-design/design-systems");
if (!existsSync(root)) {
  console.error(`No OpenDesign catalog at ${root}. Pass the path as an argument.`);
  process.exit(1);
}

const kept: unknown[] = [];
const dropped: string[] = [];

for (const id of WANTED) {
  const tokensPath = join(root, id, "design-tokens.json");
  if (!existsSync(tokensPath)) {
    dropped.push(`${id}: no design-tokens.json`);
    continue;
  }

  const raw = JSON.parse(readFileSync(tokensPath, "utf8")) as {
    tokens: { name: string; value: string; type?: string }[];
  };
  const all: Record<string, string> = {};
  for (const token of raw.tokens) if (token.type === "color") all[token.name] = token.value;

  const rgb: Record<string, Rgb> = {};
  let missing = "";
  for (const [role, token] of Object.entries(ROLE_MAP)) {
    const parsed = parseColor(all[token], all);
    if (!parsed) {
      missing = `${token} (${all[token] ?? "absent"})`;
      break;
    }
    rgb[role] = parsed;
  }
  if (missing) {
    dropped.push(`${id}: could not resolve ${missing}`);
    continue;
  }

  const signal = SIGNAL_TOKENS
    .map((token) => parseColor(all[token], all))
    .filter((c): c is Rgb => c !== null)
    .filter((c) => contrast(c, rgb["surface-primary"]) >= 3)
    .sort((a, b) => hueGap(b, rgb["accent-primary"]) - hueGap(a, rgb["accent-primary"]))[0];
  if (!signal) {
    dropped.push(`${id}: no signal colour reaches 3:1 on the ground`);
    continue;
  }
  rgb["accent-secondary"] = signal;

  const failed = GATES.filter((g) => contrast(rgb[g.from], rgb[g.on]) < g.min);
  const onAccent = Math.max(contrast(WHITE, rgb["accent-primary"]), contrast(BLACK, rgb["accent-primary"]));
  if (onAccent < 4.5) failed.push({ label: "label on accent fill", from: "", on: "", min: 4.5 });
  if (failed.length > 0) {
    const worst = failed
      .map((g) => (g.from
        ? `${g.label} ${contrast(rgb[g.from], rgb[g.on]).toFixed(2)}:1 < ${g.min}`
        : `${g.label} ${onAccent.toFixed(2)}:1 < ${g.min}`))
      .join(", ");
    dropped.push(`${id}: ${worst}`);
    continue;
  }

  const mood = describe(id, root);
  if (!mood) {
    dropped.push(`${id}: no description line in DESIGN.md`);
    continue;
  }

  kept.push({
    name: title(id),
    scheme: luminance(rgb["surface-primary"]) < 0.35 ? "dark" : "light",
    mood,
    tokens: Object.fromEntries(
      [...Object.keys(ROLE_MAP), "accent-secondary"].map((role) => [role, hex(rgb[role])])
    )
  });
}

const target = join(import.meta.dir, "../src/design/palettes.imported.json");
writeFileSync(target, JSON.stringify(kept, null, 2) + "\n", "utf8");

console.log(`imported ${kept.length} palettes -> src/design/palettes.imported.json`);
if (dropped.length > 0) {
  console.log(`\ndropped ${dropped.length}:`);
  for (const line of dropped) console.log(`  ${line}`);
}
