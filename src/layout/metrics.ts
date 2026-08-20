/**
 * # Recorded text metrics
 *
 * Why this module exists:
 * Layout of a `fit_content` frame depends on how wide its text is. Text width comes
 * from the font engine, and the font engine only exists inside a browser. Under `bun`
 * there is no canvas, so `measureTextWidth` falls back to a crude characters-per-em
 * guess and every width in the tree is wrong. That is why the differential oracle
 * could not run headlessly, and that is why it was quietly switched off.
 *
 * The fix is to treat font metrics as an INPUT to layout, not as an ambient capability.
 * The browser harness records what Chrome measured. `bun test` replays that recording.
 * Layout itself does not change, and neither does its result.
 *
 * This is not overfitting to the oracle. We record the advance width of a string in a
 * font — a property of the font. We never record a node's position, which is the thing
 * under test.
 */

export interface RecordedMetrics {
  /** Font families seen, with the browser's "normal" line-height ratio for each. */
  lineHeightRatios: Record<string, number>;
  /** measureKey() -> advance width in CSS pixels, as Chrome reported it. */
  widths: Record<string, number>;
  capturedAt?: string;
  userAgent?: string;
}

/**
 * Canonical key for one text measurement. Every input that changes the advance
 * width appears in the key; nothing else does.
 */
export function measureKey(
  text: string,
  fontSize: number,
  resolvedFamily: string,
  fontWeight: string | number,
  letterSpacing: number
): string {
  return `${fontWeight}|${fontSize}|${resolvedFamily}|${letterSpacing}|${text}`;
}

let recorded: RecordedMetrics | null = null;
let strict = false;
let recorder: Map<string, number> | null = null;
let ratioRecorder: Map<string, number> | null = null;

/**
 * Replay a recording. Pass null to go back to live measurement.
 *
 * `strictReplay` closes the trap that hid the last failure: if the recording does
 * not cover a string, measurement silently falls back to a characters-per-em guess
 * and every width downstream is wrong but plausible. In strict mode a miss throws,
 * so a stale recording fails the test instead of quietly changing the answer.
 */
export function useRecordedMetrics(metrics: RecordedMetrics | null, strictReplay = false): void {
  recorded = metrics;
  strict = metrics !== null && strictReplay;
}

export function lookupWidth(key: string): number | undefined {
  const hit = recorded?.widths[key];
  if (hit === undefined && strict) {
    throw new Error(
      `No recorded text metric for ${JSON.stringify(key)}.\n` +
        "The recording in probes/text-metrics.json is stale. Open /agreement.html " +
        "in a browser and save a fresh one."
    );
  }
  return hit;
}

export function lookupLineHeightRatio(family: string): number | undefined {
  return recorded?.lineHeightRatios[family];
}

export function hasRecordedMetrics(): boolean {
  return recorded !== null;
}

/** Start capturing every live measurement so it can be written to a recording. */
export function startRecording(): void {
  recorder = new Map();
  ratioRecorder = new Map();
}

export function noteMeasurement(key: string, width: number): void {
  recorder?.set(key, width);
}

export function noteLineHeightRatio(family: string, ratio: number): void {
  ratioRecorder?.set(family, ratio);
}

function sortedEntries(m: Map<string, number> | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of [...(m?.keys() ?? [])].sort()) out[k] = m!.get(k)!;
  return out;
}

/**
 * Recording captures the family names layout actually asked for, after variable
 * resolution. Collecting them from the document instead would record `$font-mono`,
 * a key that is never looked up.
 */
export function stopRecording(): RecordedMetrics {
  const widths = sortedEntries(recorder);
  const lineHeightRatios = sortedEntries(ratioRecorder);
  recorder = null;
  ratioRecorder = null;
  return {
    lineHeightRatios,
    widths,
    capturedAt: new Date().toISOString(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown"
  };
}
