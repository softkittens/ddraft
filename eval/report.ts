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
import type { RunFile, RunRow } from "./run";
import { duplicateRowKey, rowKey, rowKeys } from "./run";

interface LoadedRunFile {
  model: string;
  at: string;
  rows: RunRow[];
  provider?: string;
  briefHash?: string;
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
  { key: "infos", label: "info", pick: (r) => r.infos ?? 0, better: "low" },
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

export function compare(after: RunFile, before: RunFile): string {
  if (!after.provider || !before.provider) {
    return "Cannot compare: missing provider metadata.";
  }
  if (after.provider !== before.provider) {
    return `Cannot compare: provider "${after.provider}" vs "${before.provider}".`;
  }
  if (!after.model || !before.model) {
    return "Cannot compare: missing model metadata.";
  }
  if (after.model !== before.model) {
    return `Cannot compare: model "${after.model}" vs "${before.model}".`;
  }
  if (!after.briefHash || !before.briefHash) {
    return "Cannot compare: missing brief-set hash.";
  }
  if (after.briefHash !== before.briefHash) {
    return `Cannot compare: brief set changed (${after.briefHash} vs ${before.briefHash}).`;
  }

  const duplicate = duplicateRowKey(after.rows) ?? duplicateRowKey(before.rows);
  if (duplicate) {
    return `Cannot compare: duplicate row key (${duplicate}).`;
  }

  const afterKeys = rowKeys(after.rows);
  const beforeKeys = rowKeys(before.rows);
  if (afterKeys.join("\n") !== beforeKeys.join("\n")) {
    return `Cannot compare: row keys differ (${before.rows.length} baseline rows vs ${after.rows.length} candidate rows). Pair by brief + attempt.`;
  }

  const beforeByKey = new Map(before.rows.map((r) => [rowKey(r), r]));
  const pairs: Array<{ after: RunRow; before: RunRow }> = [];
  const failed: Array<{ after: RunRow; before: RunRow }> = [];
  for (const row of after.rows) {
    const matched = beforeByKey.get(rowKey(row));
    if (!matched) {
      return `Cannot compare: missing baseline for ${row.brief} #${row.attempt}.`;
    }
    if (!row.ok || !matched.ok) failed.push({ after: row, before: matched });
    else pairs.push({ after: row, before: matched });
  }

  const lines: string[] = [];
  if (failed.length > 0) {
    lines.push(`${failed.length} paired run${failed.length === 1 ? "" : "s"} failed and ${failed.length === 1 ? "is" : "are"} excluded from quality medians:`);
    for (const p of failed) {
      const err = !p.after.ok ? p.after.error : p.before.error;
      lines.push(`  ${p.after.brief} #${p.after.attempt}: ${err ?? "did not finish"}`);
    }
    lines.push("");
  }

  const matchedAfter = pairs.map((p) => p.after);
  const matchedBefore = pairs.map((p) => p.before);

  lines.push(`Comparing ${pairs.length} completed pairs:`);
  lines.push(`${pad("", 18)}${padL("before", 9)}${padL("after", 9)}${padL("delta", 9)}`);
  for (const t of TRACKED) {
    const b = stat(matchedBefore.map(t.pick)).median;
    const a = stat(matchedAfter.map(t.pick)).median;
    const d = Number((a - b).toFixed(2));
    const mark = t.better === "none" || d === 0 ? "" : (t.better === "low") === d < 0 ? "  better" : "  worse";
    const sign = d > 0 ? `+${d}` : String(d);
    lines.push(`${pad(t.label, 18)}${padL(String(b), 9)}${padL(String(a), 9)}${padL(sign, 9)}${mark}`);
  }
  return lines.join("\n");
}

function load(path: string): RunFile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as LoadedRunFile;
  return {
    provider: raw.provider || "",
    model: raw.model,
    briefHash: raw.briefHash || "",
    at: raw.at,
    rows: raw.rows
  };
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
    console.log(compare(after, before));
  }
}
