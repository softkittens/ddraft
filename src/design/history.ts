/**
 * What the last few runs already chose.
 *
 * The dealt hand stops the model reaching for the same palette because it
 * always saw the same list. It cannot stop the model reaching for the same
 * palette twice in a row when the dice offer it twice in a row — dice do not
 * remember what they rolled. This does.
 *
 * Kept deliberately small and deliberately out of the deal: the hand stays a
 * pure function of the brief seed, so an eval run is still comparable to the
 * one before it. History only reaches the model as a line telling it what it
 * has already used.
 */

export interface StyleRun {
  /** ISO timestamp, so a stale entry is visible rather than silently ranked. */
  at: string;
  brief: string;
  composition?: string;
  palette: string;
  headings: string;
  elevation: string;
  roundness?: string;
  thesis?: string;
  firstViewport?: string;
}

/** Enough to see a habit forming, few enough that the model can hold them. */
export const HISTORY_LIMIT = 5;

/** Newest last. Older entries fall off the front. */
export function recordRun(history: readonly StyleRun[], entry: StyleRun): StyleRun[] {
  return [...history, entry].slice(-HISTORY_LIMIT);
}

const BRIEF_EXCERPT = 40;

/**
 * The line the prompt carries, or nothing. Phrased as evidence rather than a
 * ban: repeating a palette is right when the brief asks for the same product,
 * and wrong when the model simply did not look at the rest of the hand.
 */
function sameBrief(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
}

export function avoidanceNote(history: readonly StyleRun[], currentBrief = ""): string {
  if (history.length === 0) return "";
  const repeated = currentBrief ? history.filter((run) => sameBrief(run.brief, currentBrief)) : [];
  const relevant = repeated.length > 0 ? repeated : history;
  const lines = relevant
    .slice()
    .reverse()
    .map((run) => {
      const brief = run.brief.length > BRIEF_EXCERPT
        ? `${run.brief.slice(0, BRIEF_EXCERPT).trimEnd()}...`
        : run.brief;
      const composition = run.composition ? ` [${run.composition}]` : "";
      const viewport = run.firstViewport
        ? `\n    first viewport: ${run.firstViewport.slice(0, 180)}`
        : "";
      return `  "${brief}" — ${run.palette}, ${run.headings}, ${run.elevation}${composition}${viewport}`;
    });
  return [
    repeated.length > 0
      ? "PREVIOUS RESULTS FOR THIS SAME BRIEF (most recent first)"
      : "ALREADY USED (most recent first)",
    ...lines,
    repeated.length > 0
      ? "  Aim for fresh expression: vary visual details, rhythm, and headline angle. Avoid copying the exact rendered signature if another suitable direction fits, but maintain the interaction model appropriate for this product."
      : "  Reaching for one of these again needs a reason from this brief, not habit."
  ].join("\n");
}

const STORAGE_KEY = "pen.styleHistory";

/** Reads through a guard: this module is imported by the agent server too. */
function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    // Storage can throw on access under a blocked-cookies policy.
    return undefined;
  }
}

export function loadHistory(storage = browserStorage()): StyleRun[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (run): run is StyleRun =>
          !!run &&
          typeof run === "object" &&
          ["at", "brief", "palette", "headings", "elevation"].every(
            (key) => typeof (run as Record<string, unknown>)[key] === "string"
          ) &&
          ["composition", "roundness", "thesis", "firstViewport"].every(
            (key) =>
              (run as Record<string, unknown>)[key] === undefined ||
              typeof (run as Record<string, unknown>)[key] === "string"
          )
      )
      .slice(-HISTORY_LIMIT);
  } catch {
    // A corrupt entry is not worth failing a run over.
    return [];
  }
}

export function saveHistory(history: readonly StyleRun[], storage = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    /* quota or private mode; history is an optimisation, not state */
  }
}
