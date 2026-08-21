/* ------------------------------------------------------------------ *
 * The eval driver.
 *
 * Runs every brief N times against one model and writes one JSON row
 * per run. Nothing here judges the design; it records what came out so
 * two runs of the harness can be subtracted from each other. Without
 * this, "the prompt is better now" is an anecdote.
 *
 *   bun eval/run.ts --model gpt-5.6-luna --repeats 3
 *   bun eval/run.ts --brief horses --repeats 5 --out eval/runs/before.json
 * ------------------------------------------------------------------ */

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { createHash } from "crypto";
import { loadProvider } from "../src/agent/credentials";
import { runSession } from "../src/agent/session";
import { auditDocument } from "../src/design/evaluator";
import { createDefaultDocument } from "../src/model/defaultDocument";
import { BRIEFS, type Brief } from "./briefs";
import { craftMetrics, type CraftMetrics } from "./metrics";

export interface RunRow {
  brief: string;
  surface: Brief["surface"];
  attempt: number;
  ok: boolean;
  error?: string;
  seconds: number;
  turns: number;
  /** Tool calls by name. */
  calls: Record<string, number>;
  /** Tool calls whose result began with "error:". */
  toolErrors: number;
  /** Where the finished document was saved, when --docs was given. */
  docPath?: string;
  blockers: number;
  warnings: number;
  /** Blocker count by rule, so a regression names itself. */
  byRule: Record<string, number>;
  metrics: CraftMetrics;
}

export interface RunFile {
  provider: string;
  model: string;
  briefHash: string;
  at: string;
  rows: RunRow[];
}

export function briefSetHash(briefs: Array<{ id: string; text: string }>): string {
  const payload = [...briefs]
    .map((b) => `${b.id}\n${b.text}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function rowKey(row: RunRow): string {
  return `${row.brief}#${row.attempt}`;
}

export function duplicateRowKey(rows: RunRow[]): string | undefined {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) return key;
    seen.add(key);
  }
}

export function rowKeys(rows: RunRow[]): string[] {
  return [...new Set(rows.map(rowKey))].sort();
}

/** Longest a single run may take before the harness gives up on it. */
const RUN_TIMEOUT_MS = 240_000;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function runOne(
  brief: Brief,
  attempt: number,
  providerId: string,
  model: string,
  docDir?: string
): Promise<RunRow> {
  const provider = loadProvider(providerId, undefined, model, "none");
  if (!provider) throw new Error(`no credentials for provider "${providerId}"`);

  // A run with no ceiling stalls the whole batch and looks identical to a slow
  // one. Nothing downstream can tell the difference, so the harness sets it.
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), RUN_TIMEOUT_MS);

  const started = Date.now();
  const calls: Record<string, number> = {};
  let toolErrors = 0;
  let turns = 0;
  let doc = createDefaultDocument();
  let ok = false;
  let error: string | undefined;

  try {
    for await (const ev of runSession(provider, [{ role: "user", content: brief.text }], doc, {
      maxTurns: 14,
      signal: abort.signal
    })) {
      if (ev.type === "tool") {
        calls[ev.name] = (calls[ev.name] ?? 0) + 1;
        if (/^error:/i.test(ev.result)) toolErrors += 1;
        if (ev.doc) doc = ev.doc;
      } else if (ev.type === "done") {
        doc = ev.doc;
        turns = ev.messages.filter((m) => m.role === "assistant").length;
        ok = true;
      } else if (ev.type === "error") {
        error = ev.message;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(deadline);
  }

  if (abort.signal.aborted) {
    ok = false;
    error = `run exceeded ${RUN_TIMEOUT_MS / 1000}s`;
  }

  // The audit itself can throw on malformed model output. A crash here used to
  // take the whole batch with it, losing every run already paid for.
  let findings: ReturnType<typeof auditDocument> = [];
  try {
    findings = auditDocument(doc);
  } catch (e) {
    error = `audit crashed: ${e instanceof Error ? e.message : String(e)}`;
    ok = false;
  }
  const byRule: Record<string, number> = {};
  for (const f of findings) {
    if (f.severity !== "blocker") continue;
    byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  }

  // An empty document has no clipped text, no collisions and no contrast
  // failures. Scoring it as a clean run is how ten dead runs read as perfect.
  const built = doc.children.length > 0;
  if (ok && !built) {
    ok = false;
    error = error ?? "finished with an empty canvas";
  }

  // Keep the document. A row saying "8 clipped" is a fact without a cause; the
  // document is what turns it into one.
  let docPath: string | undefined;
  if (docDir) {
    mkdirSync(docDir, { recursive: true });
    docPath = `${docDir}/${brief.id}-${attempt}.json`;
    writeFileSync(docPath, JSON.stringify(doc, null, 2));
  }

  return {
    brief: brief.id,
    surface: brief.surface,
    attempt,
    ok,
    docPath,
    error,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    turns,
    calls,
    toolErrors,
    blockers: findings.filter((f) => f.severity === "blocker").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    byRule,
    metrics: craftMetrics(doc)
  };
}

async function main() {
  const providerId = arg("provider", "openai")!;
  const model = arg("model")!;
  const repeats = Number(arg("repeats", "3"));
  const only = arg("brief");
  const out = arg("out", `eval/runs/${model}-${Date.now()}.json`)!;
  const docDir = process.argv.includes("--docs") ? out.replace(/\.json$/, "-docs") : undefined;

  if (!model) {
    console.error("--model is required. It is never guessed: a baseline against the wrong model is worse than none.");
    process.exit(1);
  }

  const briefs = only ? BRIEFS.filter((b) => b.id === only) : BRIEFS;
  if (briefs.length === 0) {
    console.error(`no brief named "${only}". Known: ${BRIEFS.map((b) => b.id).join(", ")}`);
    process.exit(1);
  }

  const rows: RunRow[] = [];
  const total = briefs.length * repeats;
  let n = 0;

  for (const brief of briefs) {
    for (let attempt = 1; attempt <= repeats; attempt += 1) {
      n += 1;
      process.stderr.write(`[${n}/${total}] ${brief.id} #${attempt} ... `);
      const row = await runOne(brief, attempt, providerId, model, docDir);
      rows.push(row);
      // Written after every run, not at the end. The first batch lost ten runs
      // to a crash on the eleventh.
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify({
        provider: providerId,
        model,
        briefHash: briefSetHash(briefs),
        at: new Date().toISOString(),
        rows
      } satisfies RunFile, null, 2));
      process.stderr.write(
        row.ok
          ? `${row.blockers} blockers, ${row.metrics.screens} screens, ${row.seconds}s\n`
          : `FAILED: ${row.error}\n`
      );
    }
  }

  console.error(`\nwrote ${out} — ${rows.filter((r) => r.ok).length}/${rows.length} runs completed`);
}

if (import.meta.main) await main();
