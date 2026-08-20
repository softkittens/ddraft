import { parseDocument } from "./model/parse";
import { layoutDocument } from "./layout/layout";
import { parseBoundsFile, compareWithTruth } from "../test/oracle";


import aPen from "../fixtures/A_control_r1.pen?raw";
import aBounds from "../probes/A_control_r1.bounds.txt?raw";

import dPen from "../fixtures/D_hires_r2.pen?raw";
import dBounds from "../probes/D_hires_r2.bounds.txt?raw";

import p3Pen from "../probes/layout-probe3.pen?raw";
import p3Bounds from "../probes/layout-probe3.bounds.txt?raw";

interface TestEntry {
  name: string;
  pen: string;
  bounds: string;
}

const entries: TestEntry[] = [
  { name: "A_control_r1", pen: aPen, bounds: aBounds },
  { name: "D_hires_r2", pen: dPen, bounds: dBounds },
  { name: "layout-probe3", pen: p3Pen, bounds: p3Bounds }
];

async function runAgreement() {
  const container = document.getElementById("results");
  if (!container) return;

  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  let html = `<table><thead><tr><th>Document</th><th>Matches</th><th>Total</th><th>Status</th></tr></thead><tbody>`;
  let diffsHtml = `<h2>Failed Nodes</h2><table class="diffs-table"><thead><tr><th>Document</th><th>Node ID</th><th>Field</th><th>Expected</th><th>Actual</th><th>Diff</th></tr></thead><tbody>`;
  let hasDiffs = false;

  for (const entry of entries) {
    const doc = parseDocument(entry.pen);
    const layoutTree = layoutDocument(doc);
    const truth = parseBoundsFile(entry.bounds);
    const diffs = compareWithTruth(layoutTree, truth);

    const failedIds = new Set(diffs.map((d) => d.id));
    const passedCount = truth.length - failedIds.size;
    const isPass = passedCount === truth.length;
    const statusClass = isPass ? "pass" : "fail";
    const statusText = isPass ? "PASS" : "FAIL";

    html += `<tr><td>${entry.name}</td><td>${passedCount}</td><td>${truth.length}</td><td class="${statusClass}">${statusText}</td></tr>`;

    for (const d of diffs) {
      hasDiffs = true;
      diffsHtml += `<tr><td>${entry.name}</td><td>${d.id}</td><td>${d.field}</td><td>${d.expected}</td><td>${d.actual}</td><td>${d.diff.toFixed(2)}</td></tr>`;
    }
  }

  html += `</tbody></table>`;
  diffsHtml += `</tbody></table>`;

  container.innerHTML = html + (hasDiffs ? diffsHtml : "");
}

runAgreement();
