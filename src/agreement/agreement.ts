/**
 * # Differential agreement harness
 *
 * The premise of this project is that our layout engine can be checked against a
 * numeric oracle: Pen reports `ctx.bounds` for every node, we lay the same document
 * out ourselves, and the two must agree. This page is the instrument that performs
 * that comparison in a browser, where a real font engine exists.
 *
 * It has a second job. While it measures, it records every text advance width Chrome
 * produced. Press "Copy recording" (or read `window.__penMetrics`) and save the result
 * to `probes/text-metrics.json`. `bun test` then replays that file and can run the
 * same comparison with no browser at all — see `test/agreement.test.ts`.
 */
import { parseDocument } from "../model/parse";
import { layoutDocument } from "../layout/layout";
import { parseBoundsFile, compareWithTruth, type BoundsDiff } from "../layout/bounds";
import { startRecording, stopRecording, type RecordedMetrics } from "../layout/metrics";


const penFiles = import.meta.glob("../../{fixtures,probes}/*.pen", {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

const boundsFiles = import.meta.glob("../../probes/*.bounds.txt", {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

const basename = (p: string) => p.split("/").pop()!;

/** Pairs a `<name>.pen` with `<name>.bounds.txt`, wherever each of them lives. */
function pairs(): { name: string; pen: string; bounds: string }[] {
  const byName = new Map<string, string>();
  for (const [path, text] of Object.entries(penFiles)) {
    byName.set(basename(path).replace(/\.pen$/, ""), text);
  }
  const out: { name: string; pen: string; bounds: string }[] = [];
  for (const [path, bounds] of Object.entries(boundsFiles)) {
    const name = basename(path).replace(/\.bounds\.txt$/, "");
    const pen = byName.get(name);
    if (pen) out.push({ name, pen, bounds });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

interface Result {
  name: string;
  total: number;
  agreed: number;
  diffs: BoundsDiff[];
}

async function run() {
  const container = document.getElementById("results")!;
  if (document.fonts?.ready) await document.fonts.ready;

  startRecording();

  const results: Result[] = [];

  for (const entry of pairs()) {
    const doc = parseDocument(entry.pen);
    const tree = layoutDocument(doc);
    const truth = parseBoundsFile(entry.bounds);
    const diffs = compareWithTruth(tree, truth);
    const failed = new Set(diffs.map((d) => d.id));
    results.push({ name: entry.name, total: truth.length, agreed: truth.length - failed.size, diffs });
  }

  const metrics: RecordedMetrics = stopRecording();
  (window as any).__penMetrics = metrics;
  (window as any).__penAgreement = results.map((r) => ({
    name: r.name,
    total: r.total,
    agreed: r.agreed,
    diffs: r.diffs
  }));

  render(container, results, metrics);
}

function render(container: HTMLElement, results: Result[], metrics: RecordedMetrics) {
  const totalNodes = results.reduce((s, r) => s + r.total, 0);
  const totalAgreed = results.reduce((s, r) => s + r.agreed, 0);

  const rows = results
    .map((r) => {
      const ok = r.agreed === r.total;
      return `<tr>
        <td>${r.name}</td>
        <td>${r.agreed} / ${r.total}</td>
        <td>${((r.agreed / r.total) * 100).toFixed(1)}%</td>
        <td class="${ok ? "pass" : "fail"}">${ok ? "AGREE" : `${r.total - r.agreed} DIFFER`}</td>
      </tr>`;
    })
    .join("");

  const allDiffs = results.flatMap((r) => r.diffs.map((d) => ({ doc: r.name, ...d })));
  const diffRows = allDiffs
    .map(
      (d) =>
        `<tr><td>${d.doc}</td><td>${d.id}</td><td>${d.field}</td><td>${d.expected}</td><td>${d.actual}</td><td>${d.diff.toFixed(2)}</td></tr>`
    )
    .join("");

  container.innerHTML = `
    <div class="summary ${totalAgreed === totalNodes ? "pass" : "fail"}">
      ${totalAgreed} / ${totalNodes} nodes agree with the oracle
      (${((totalAgreed / totalNodes) * 100).toFixed(1)}%)
    </div>
    <table>
      <thead><tr><th>Document</th><th>Agreed</th><th>Rate</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <h2>Recording</h2>
    <p class="note">
      ${Object.keys(metrics.widths).length} text measurements and
      ${Object.keys(metrics.lineHeightRatios).length} line-height ratios captured from this browser.
      Save to <code>probes/text-metrics.json</code> so <code>bun test</code> can replay them.
    </p>
    <button id="copy">Copy recording to clipboard</button>
    <span id="copied" class="note"></span>

    ${
      allDiffs.length
        ? `<h2>Nodes that differ (${allDiffs.length} fields)</h2>
           <table class="diffs">
             <thead><tr><th>Document</th><th>Node</th><th>Field</th><th>Oracle</th><th>Ours</th><th>Δ</th></tr></thead>
             <tbody>${diffRows}</tbody>
           </table>`
        : `<h2 class="pass">No differences.</h2>`
    }`;

  document.getElementById("copy")!.addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify(metrics, null, 2));
    document.getElementById("copied")!.textContent = " copied";
  });
}

run();
