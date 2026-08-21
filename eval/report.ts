/* ------------------------------------------------------------------ *
 * Reporting and comparison.
 *
 * A mean hides the run that produced one screen when the others
 * produced four. Spread is reported next to every number because
 * run-to-run variance is a defect in its own right.
 *
 *   bun eval/report.ts eval/runs/after.json
 *   bun eval/report.ts eval/runs/after.json --against eval/runs/before.json
 * ------------------------------------------------------------------ */

import { readFileSync } from "fs";
import type { RunRow } from "./run";

interface RunFile {
  model: string;
  at: string;
  rows: RunRow[];
}

export interface Stat {
  median: number;
  min: number;
  max: number;
}

export function stat(values: number[]): Stat {
  if (values.length === 0) return { median: 0, min: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  return { median: Number(median.toFixed(2)), min: s[0], max: s[s.length - 1] };
}

/** Every number the harness tracks, with the direction that counts as better. */
const TRACKED: { key: string; label: string; pick: (r: RunRow) => number; better: "low" | "high" | "none" }[] = [
  { key: "blockers", label: "blockers", pick: (r) => r.blockers, better: "low" },
  { key: "warnings", label: "warnings", pick: (r) => r.warnings, better: "low" },
  { key: "toolErrors", label: "tool errors", pick: (r) => r.toolErrors, better: "low" },
  { key: "screens", label: "screens", pick: (r) => r.metrics.screens, better: "none" },
  { key: "nodes", label: "nodes", pick: (r) => r.metrics.nodes, better: "none" },
  { key: "depth", label: "tree depth", pick: (r) => r.metrics.depth, better: "none" },
  { key: "spacingValues", label: "distinct spacing", pick: (r) => r.metrics.spacingValues, better: "low" },
  { key: "spacingOffGrid", label: "off-grid spacing", pick: (r) => r.metrics.spacingOffGrid, better: "low" },
  { key: "typeSizes", label: "type sizes", pick: (r) => r.metrics.typeSizes, better: "none" },
  { key: "typeRange", label: "type range", pick: (r) => r.metrics.typeRange, better: "high" },
  { key: "accentFills", label: "accent fills", pick: (r) => r.metrics.accentFills, better: "none" },
  { key: "tokenCoverage", label: "token coverage", pick: (r) => r.metrics.tokenCoverage, better: "high" },
  { key: "components", label: "components", pick: (r) => r.metrics.components, better: "high" },
  { key: "reuseRatio", label: "reuse ratio", pick: (r) => r.metrics.reuseRatio, better: "high" },
  { key: "unwrappedProse", label: "unwrapped prose", pick: (r) => r.metrics.unwrappedProse, better: "low" },
  { key: "emptyFrames", label: "empty frames", pick: (r) => r.metrics.emptyFrames, better: "low" },
  { key: "seconds", label: "seconds", pick: (r) => r.seconds, better: "low" }
];

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

export function summarize(rows: RunRow[]): string {
  const lines: string[] = [];
  const failed = rows.filter((r) => !r.ok);

  lines.push(`${rows.length} runs, ${rows.length - failed.length} completed.`);
  for (const f of failed) lines.push(`  ${f.brief} #${f.attempt} did not finish: ${f.error}`);
  lines.push("");

  lines.push(`${pad("", 18)}${padL("median", 8)}${padL("min", 7)}${padL("max", 7)}`);
  for (const t of TRACKED) {
    const s = stat(rows.map(t.pick));
    lines.push(`${pad(t.label, 18)}${padL(String(s.median), 8)}${padL(String(s.min), 7)}${padL(String(s.max), 7)}`);
  }

  const ruleTotals: Record<string, number> = {};
  for (const r of rows) for (const [rule, n] of Object.entries(r.byRule)) ruleTotals[rule] = (ruleTotals[rule] ?? 0) + n;
  const ranked = Object.entries(ruleTotals).sort((a, b) => b[1] - a[1]);
  lines.push("");
  lines.push(ranked.length === 0 ? "No blockers survived on any run." : "Blockers by rule:");
  for (const [rule, n] of ranked) lines.push(`  ${pad(rule, 18)}${padL(String(n), 5)}`);

  lines.push("");
  lines.push("Per brief (median blockers, screen range):");
  const briefs = [...new Set(rows.map((r) => r.brief))];
  for (const b of briefs) {
    const sub = rows.filter((r) => r.brief === b);
    const bl = stat(sub.map((r) => r.blockers));
    const sc = stat(sub.map((r) => r.metrics.screens));
    lines.push(`  ${pad(b, 14)}${padL(String(bl.median), 4)} blockers   screens ${sc.min}-${sc.max}`);
  }

  return lines.join("\n");
}

export function compare(after: RunRow[], before: RunRow[]): string {
  const lines: string[] = [];
  lines.push(`${pad("", 18)}${padL("before", 9)}${padL("after", 9)}${padL("delta", 9)}`);
  for (const t of TRACKED) {
    const b = stat(before.map(t.pick)).median;
    const a = stat(after.map(t.pick)).median;
    const d = Number((a - b).toFixed(2));
    // A metric with no better direction gets no verdict. Fewer screens is not
    // automatically worse, and neither is a deeper tree.
    const mark = t.better === "none" || d === 0 ? "" : (t.better === "low") === d < 0 ? "  better" : "  worse";
    const sign = d > 0 ? `+${d}` : String(d);
    lines.push(`${pad(t.label, 18)}${padL(String(b), 9)}${padL(String(a), 9)}${padL(sign, 9)}${mark}`);
  }
  return lines.join("\n");
}

function load(path: string): RunFile {
  return JSON.parse(readFileSync(path, "utf8")) as RunFile;
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: bun eval/report.ts <runs.json> [--against <baseline.json>]");
    process.exit(1);
  }
  const after = load(path);
  console.log(`${after.model} — ${after.at}`);
  console.log("");
  console.log(summarize(after.rows));

  const i = process.argv.indexOf("--against");
  if (i >= 0 && process.argv[i + 1]) {
    const before = load(process.argv[i + 1]);
    console.log("");
    console.log(`Against ${before.model} — ${before.at}`);
    console.log("");
    console.log(compare(after.rows, before.rows));
  }
}
