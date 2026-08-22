/**
 * Read an agent trace and report how the run spent itself.
 *
 * The point is to make the next diagnosis cheap. Reading one 7MB log by hand
 * turned up a measure/nudge loop, a property written five times, an icon
 * catalog that silently collapsed to 28 names, and a search that could not
 * match a two-word query. None of that was visible without counting, and
 * counting by hand does not survive contact with the next run.
 *
 *   bun scripts/analyze-log.ts agent-logs/<id>.jsonl
 *   bun scripts/analyze-log.ts agent-logs            # newest in the directory
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface Event { type?: string; [key: string]: unknown }

/** Tools that answer a question rather than change the canvas. */
const READ_ONLY = new Set(["read_digest", "measure", "search_icons"]);
/** Tools that put something on the canvas, as opposed to adjusting it. */
const BUILDING = new Set(["insert_node", "create_screen", "place_instances", "generate_image", "insert_icon", "duplicate_node"]);

function newestLog(dir: string): string {
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  if (files.length === 0) throw new Error(`no .jsonl files in ${dir}`);
  return join(dir, files.sort((a, b) =>
    statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs)[0]);
}

function parseArgs(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw !== "string") return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function bar(n: number, max: number, width = 24): string {
  return "█".repeat(Math.max(0, Math.round((n / Math.max(max, 1)) * width)));
}

const target = process.argv[2] ?? "agent-logs";
const path = statSync(target).isDirectory() ? newestLog(target) : target;
const raw = readFileSync(path, "utf-8").split("\n").filter(Boolean);
const events: Event[] = raw.map((line) => { try { return JSON.parse(line); } catch { return {}; } });

console.log(`${path}  —  ${raw.length} events, ${(readFileSync(path).length / 1e6).toFixed(2)} MB\n`);

// One file can hold several runs; report each.
const runs: Event[][] = [];
for (const event of events) {
  if (event.type === "session_start" || runs.length === 0) runs.push([]);
  runs[runs.length - 1].push(event);
}

for (const [index, run] of runs.entries()) {
  const start = run.find((e) => e.type === "session_start");
  const outcome = run.find((e) => e.type === "outcome");
  const end = run.find((e) => e.type === "session_end");
  const calls = run.filter((e) => e.type === "tool_call");
  const results = run.filter((e) => e.type === "tool_result");

  const brief = run
    .filter((e) => e.type === "prompt")
    .flatMap((e) => ((e.messages as any[]) ?? []))
    .filter((m) => m?.role === "user")
    .map((m) => typeof m.content === "string" ? m.content
      : (m.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join(" "))
    .filter(Boolean)
    .pop();

  console.log(`─── run ${index + 1}/${runs.length} ${"─".repeat(46)}`);
  if (brief) console.log(`brief    ${brief.replace(/\s+/g, " ").slice(0, 68)}`);
  console.log(`model    ${start?.model ?? "?"}  ·  ${Math.round(Number(end?.elapsedMs ?? 0) / 1000)}s  ·  ${calls.length} tool calls`);

  /**
   * How the calls were spread over rounds, which is what a run is actually
   * charged for. A round replays the whole conversation; the calls inside it
   * are free. This was invisible here, and the run that made it worth adding
   * spent thirty rounds on thirty-eight calls — twenty-five of those rounds
   * carried a single call, so it paid thirty round-trips for one afternoon of
   * edits and was cut off before the design was finished.
   */
  const rounds = new Map<number, number>();
  for (const call of calls) rounds.set(Number(call.turn), (rounds.get(Number(call.turn)) ?? 0) + 1);
  const solo = [...rounds.values()].filter((n) => n === 1).length;
  if (rounds.size > 0) {
    console.log(
      `rounds   ${rounds.size}  ·  ${(calls.length / rounds.size).toFixed(1)} calls per round  ·  ` +
      `${solo} carried one call`
    );
  }

  /**
   * Rounds the provider cut off at the output cap, and how much of each was
   * spent thinking.
   *
   * Invisible here until now, and it is the difference between a model that
   * chose to stop and one that never got to speak. The run that made this worth
   * printing spent 20,291 characters reasoning, was cut off mid-word with no
   * tool call, and was recorded as "model finished" with four empty screens.
   */
  const replies = run.filter((e) => e.type === "model_response");
  const cutOff = replies.filter((e) => e.truncated);
  const reasoningChars = replies.reduce((n, e) => n + String(e.reasoning ?? "").length, 0);
  const silent = replies.filter(
    (e) => ((e.toolCalls as unknown[]) ?? []).length === 0 && !String(e.content ?? "").trim()
  );
  if (reasoningChars > 0 || cutOff.length > 0) {
    console.log(
      `replies  ${replies.length}  ·  ${Math.round(reasoningChars / 1000)}k chars reasoning  ·  ` +
      `${cutOff.length} cut off  ·  ${silent.length} said nothing`
    );
  }

  // Where the budget went.
  const tally = new Map<string, number>();
  for (const call of calls) tally.set(String(call.name), (tally.get(String(call.name)) ?? 0) + 1);
  const max = Math.max(...tally.values(), 1);
  console.log("\nbudget");
  for (const [name, n] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(22)}${String(n).padStart(3)}  ${bar(n, max)}`);
  }
  const build = calls.filter((c) => BUILDING.has(String(c.name))).length;
  const read = calls.filter((c) => READ_ONLY.has(String(c.name))).length;
  const adjust = calls.length - build - read;
  const pct = (n: number) => `${Math.round((n / Math.max(calls.length, 1)) * 100)}%`;
  console.log(`  ${"—".repeat(25)}`);
  console.log(`  building ${pct(build)} · adjusting ${pct(adjust)} · reading ${pct(read)}`);

  const flags: string[] = [];
  if (cutOff.length > 0) {
    flags.push(`${cutOff.length} repl${cutOff.length === 1 ? "y was" : "ies were"} cut off at the output cap — the model ran out of room before it could act.`);
  }
  if (silent.length > 0 && calls.length > 0) {
    flags.push(`${silent.length} round(s) produced no tool call and no text. Check whether the reply was truncated.`);
  }
  if (rounds.size >= 8 && solo / rounds.size > 0.6) {
    flags.push(`${solo} of ${rounds.size} rounds carried a single tool call — the run is paying a round-trip per edit.`);
  }
  if (build > 0 && (adjust + read) / build > 3) {
    flags.push(`${adjust + read} adjust/read calls against ${build} that built something — the run is nudging, not designing.`);
  }

  // Re-measuring the same thing over and over.
  const measured = new Map<string, number>();
  for (const call of calls.filter((c) => c.name === "measure")) {
    const id = String(parseArgs(call.arguments).id ?? "(all)");
    measured.set(id, (measured.get(id) ?? 0) + 1);
  }
  const remeasured = [...measured].filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]);
  if (remeasured.length > 0) {
    flags.push(`measure re-run on ${remeasured.length} id(s): ${remeasured.slice(0, 4).map(([id, n]) => `${id}x${n}`).join(", ")}.`);
  }

  // The same property written again and again.
  const writes = new Map<string, unknown[]>();
  for (const call of calls) {
    const args = parseArgs(call.arguments);
    // Keyed the way the tools key them: where a node lives is a slot like any
    // other, and a node moved back and forth between two parents is the same
    // failure as a value toggled between two settings.
    const updates = call.name === "set_property" ? [args]
      : call.name === "batch_set_properties" ? (args.updates ?? [])
      : call.name === "move_node" ? [{ id: args.id, property: "parent", value: args.newParentId }]
      : [];
    for (const u of updates) {
      if (!u?.id || !u?.property) continue;
      const key = `${u.id}.${u.property}`;
      writes.set(key, [...(writes.get(key) ?? []), u.value]);
    }
  }
  const thrashed = [...writes].filter(([, v]) => v.length > 2).sort((a, b) => b[1].length - a[1].length);
  if (thrashed.length > 0) {
    console.log("\nthrash");
    for (const [key, values] of thrashed.slice(0, 6)) {
      console.log(`  ${key.padEnd(26)} ${values.map((v) => JSON.stringify(v)).join(" → ")}`);
    }
    flags.push(`${thrashed.length} propert${thrashed.length === 1 ? "y" : "ies"} written 3+ times.`);
  }

  // Tool results that told the model something went wrong.
  const errors = results.filter((r) => typeof r.result === "string" && r.result.startsWith("error:"));
  const noops = results.filter((r) => typeof r.result === "string" && r.result.includes("no change:"));
  if (errors.length > 0) {
    console.log("\nerrors");
    const kinds = new Map<string, number>();
    for (const e of errors) {
      const kind = String(e.result).slice(0, 60);
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`  x${String(n).padEnd(3)} ${kind}`);
    }
  }
  if (noops.length > 0) flags.push(`${noops.length} write(s) changed nothing.`);

  // Queries that came back empty. A vocabulary the tools do not share with the
  // model is invisible in a success/failure count: search_icons answered "no
  // such icon" for info, bookmark and calendar — all real — while every call
  // was recorded as a normal result.
  const emptySearches = results
    .filter((r) => typeof r.result === "string" && /^No .* matching/.test(r.result))
    .map((r) => {
      const call = calls.find((c) => c.id === r.id);
      return String(parseArgs(call?.arguments).query ?? "?");
    });
  if (emptySearches.length > 0) {
    console.log(`\nempty answers`);
    console.log(`  search found nothing for: ${emptySearches.join(", ")}`);
    flags.push(`${emptySearches.length} search(es) returned nothing — check the catalog before blaming the query.`);
  }

  if (outcome) {
    console.log(`\noutcome  ${outcome.reason} · ${outcome.screens} screens · ${outcome.nodes} nodes · ${outcome.turnsUsed} turns`);
    console.log(`audit    ${outcome.blockers} blockers · ${outcome.warnings} warnings · ${outcome.infos} info`);
    for (const finding of (outcome.findings as string[] ?? []).slice(0, 8)) {
      console.log(`  ${finding.slice(0, 116)}`);
    }
  } else {
    console.log("\noutcome  (not recorded — this trace predates the outcome event)");
  }

  /*
   * The review that followed this run, and who ran it.
   *
   * These events land after session_end and before the next session_start, so
   * they belong to the run they judged. They were the least readable part of a
   * trace: a review that never happened left one review_error line among five
   * hundred events, and the panel showed the user a provider notice with no way
   * to tell whether the model had no eyes, timed out, or answered nonsense.
   */
  const reviews = run.filter((e) => e.type === "review_result");
  const handoffs = run.filter((e) => e.type === "review_handoff");
  const reviewErrors = run.filter((e) => e.type === "review_error");
  if (reviews.length > 0 || reviewErrors.length > 0) {
    console.log("\nreview");
    for (const handoff of handoffs) {
      console.log(`  handoff ${handoff.from} → ${handoff.to}  (${String(handoff.reason).slice(0, 60)})`);
    }
    const requested = run.filter((e) => e.type === "review_request");
    for (const [n, entry] of reviews.entries()) {
      const review = entry.review as any;
      const scores = Object.entries(review?.scores ?? {})
        .map(([name, value]) => `${name.slice(0, 4)} ${value}`)
        .join(" · ");
      // Traces written before the handoff existed carry the model on the
      // request only.
      const model = entry.model ?? requested[n]?.model ?? "?";
      console.log(`  ${review?.verdict ?? "?"} by ${model}  ${scores}`);
      if (entry.handoff) console.log(`    reason: ${entry.handoff}`);
      for (const issue of (review?.issues ?? []).slice(0, 3)) {
        console.log(`    issue: ${String(issue.title).slice(0, 100)}`);
      }
      const fixes = (review?.fixes ?? []).length;
      if (fixes > 0) console.log(`    ${fixes} direct fix(es)`);
    }
    for (const failure of reviewErrors) {
      console.log(`  failed on ${failure.model ?? "?"}: ${String(failure.error).slice(0, 90)}`);
    }
    // A failing model is not the same as a failing review: the first is worth
    // one handoff, the second means the canvas went unjudged.
    if (reviews.length === 0) {
      flags.push(`review never produced a verdict (${reviewErrors.length} provider failure(s)).`);
    } else if (handoffs.length > 0) {
      flags.push(`${handoffs.length} vision handoff(s) — the chosen model did not read the screenshot.`);
    }
  }

  if (flags.length > 0) {
    console.log("\nflags");
    for (const flag of flags) console.log(`  · ${flag}`);
  }
  console.log();
}
