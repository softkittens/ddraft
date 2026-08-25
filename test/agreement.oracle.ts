import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { parseDocument } from "../src/model/parse";
import { layoutDocument } from "../src/layout/layout";
import { useRecordedMetrics, type RecordedMetrics } from "../src/layout/metrics";
import { compareWithTruth, parseBoundsFile, type BoundsDiff } from "../src/layout/bounds";

/**
 * # Differential agreement, headless
 *
 * The oracle is Pen's own `ctx.bounds`, recorded per node in `probes/*.bounds.txt`.
 * We lay the same document out and compare. This is the test the whole project rests on.
 *
 * It could not run under `bun` before, because layout needs text widths and `bun` has
 * no font engine. `probes/text-metrics.json` closes that gap: it holds what Chrome
 * measured, captured by `/agreement.html`. Replaying it makes this run identical to
 * the browser run, with no browser.
 *
 * Two rules keep this test honest:
 *   1. Every input must exist. A missing file fails the test; it is never skipped.
 *   2. Replay is strict. A string the recording does not cover throws, instead of
 *      silently falling back to a guess.
 */

const ROOT = join(import.meta.dir, "..");
const PROBES = join(ROOT, "probes");
const METRICS = join(PROBES, "text-metrics.json");

/**
 * Nodes where Pen and Chrome resolve the same font differently.
 *
 * Every one of these strings starts with U+25CF BLACK CIRCLE. Inter has no such glyph,
 * so both engines fall back — to different fonts. Chrome's fallback advance for `●` at
 * Inter bold 11px is 6.644px; solving the four widths for exactness puts Pen's at about
 * 10.0px. This is a property of font fallback, not of our layout, and `ctx.bounds`
 * cannot observe it. Overriding the glyph width by hand would fit the oracle rather
 * than model the engine, so we record the ceiling instead of hiding it.
 */
const KNOWN_FONT_FALLBACK: Record<string, string[]> = {
  D_hires_r2: ["wyPrJ", "F67hn1", "sy9nd", "bVpQB"]
};

/** Agreement each document must still reach. Raise these when a real fix lands. */
const BASELINE: Record<string, { agreed: number; total: number }> = {
  A_control_r1: { agreed: 156, total: 156 },
  D_hires_r2: { agreed: 80, total: 84 },
  "layout-probe3": { agreed: 16, total: 16 },
  rotation: { agreed: 6, total: 6 }
};


function findPairs(): { name: string; pen: string; bounds: string }[] {
  const boundsNames = readdirSync(PROBES).filter((f) => f.endsWith(".bounds.txt"));
  expect(boundsNames.length).toBeGreaterThan(0);

  return boundsNames.map((file) => {
    const name = file.replace(".bounds.txt", "");
    const candidates = [join(ROOT, "fixtures", `${name}.pen`), join(PROBES, `${name}.pen`)];
    const pen = candidates.find(existsSync);
    if (!pen) {
      throw new Error(`${file} has no matching .pen document. Looked in:\n  ${candidates.join("\n  ")}`);
    }
    return { name, pen, bounds: join(PROBES, file) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

describe("Differential agreement with the Pen oracle", () => {
  beforeAll(() => {
    if (!existsSync(METRICS)) {
      throw new Error(
        `Missing ${METRICS}. Run \`bun run dev\`, open /agreement.html, and save the recording.`
      );
    }
    const metrics: RecordedMetrics = JSON.parse(readFileSync(METRICS, "utf-8"));
    useRecordedMetrics(metrics, true);
  });

  afterAll(() => useRecordedMetrics(null));

  it("has a recording, a bounds file, and a document for every case", () => {
    const found = findPairs().map((p) => p.name);
    // Every baseline entry must have real files behind it. A renamed or moved probe
    // fails here rather than disappearing from the run.
    for (const name of Object.keys(BASELINE)) {
      expect(found).toContain(name);
    }
  });

  it("reproduces the browser's text measurements exactly", () => {
    // If this throws, the recording no longer covers the fixtures. Recapture it.
    for (const { pen } of findPairs()) {
      expect(() => layoutDocument(parseDocument(readFileSync(pen, "utf-8")))).not.toThrow();
    }
  });

  for (const name of Object.keys(BASELINE)) {
    it(`agrees with the oracle on ${name}`, () => {
      const pair = findPairs().find((p) => p.name === name)!;
      const tree = layoutDocument(parseDocument(readFileSync(pair.pen, "utf-8")));
      const truth = parseBoundsFile(readFileSync(pair.bounds, "utf-8"));

      const diffs: BoundsDiff[] = compareWithTruth(tree, truth);
      const differing = [...new Set(diffs.map((d) => d.id))];
      const known = KNOWN_FONT_FALLBACK[name] ?? [];
      const unexpected = differing.filter((id) => !known.includes(id));

      // Any node that differs and is not a recorded font-fallback case is a regression.
      expect(unexpected.map((id) => {
        const d = diffs.find((x) => x.id === id)!;
        return `${id} ${d.field}: oracle ${d.expected}, ours ${d.actual}`;
      })).toEqual([]);

      expect(truth.length).toBe(BASELINE[name].total);
      expect(truth.length - differing.length).toBe(BASELINE[name].agreed);
    });
  }

  it("agrees on 258 of 262 nodes overall", () => {
    let agreed = 0;
    let total = 0;
    for (const pair of findPairs()) {
      const tree = layoutDocument(parseDocument(readFileSync(pair.pen, "utf-8")));
      const truth = parseBoundsFile(readFileSync(pair.bounds, "utf-8"));
      const differing = new Set(compareWithTruth(tree, truth).map((d) => d.id));
      agreed += truth.length - differing.size;
      total += truth.length;
    }
    expect(total).toBe(262);
    expect(agreed).toBe(258);
  });

});

describe("Layout purity", () => {
  // Regression guard for the Task 12 class of defect: a trial edit must be
  // discardable, so laying a document out must not change it.
  it("does not mutate the source document during layout", () => {
    const text = readFileSync(join(ROOT, "fixtures", "A_control_r1.pen"), "utf-8");
    const doc = parseDocument(text);
    const before = JSON.stringify(doc);
    layoutDocument(doc);
    layoutDocument(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
