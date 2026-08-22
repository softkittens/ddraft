import { describe, it, expect } from "bun:test";
import { buildScreen, STATUS_BAR_HEIGHT, TAB_BAR_HEIGHT, MOBILE_HEIGHT, MOBILE_WIDTH } from "../src/design/scaffold";
import { auditDesign } from "../src/design/evaluator";
import { layoutResolvedDocument } from "../src/layout/layout";
import { createDocumentTools } from "../src/agent/tools";
import { resolveStyle } from "../src/design/styleSystem";
import { walkNodes, childrenOf } from "../src/model/tree";
import type { Document, PenNode } from "../src/model/types";
import { makeDoc, frame } from "./harness";

function ids() {
  let n = 0;
  return () => `n${n++}`;
}

function find(node: PenNode, name: string): PenNode | undefined {
  let hit: PenNode | undefined;
  walkNodes([node], (n) => {
    if (!hit && n.name === name) hit = n;
  });
  return hit;
}

/**
 * The active tab is marked twice — accent on the icon, full foreground at 600
 * on the label — because colour alone is the weakest way to carry a state and
 * an 11px accent label is unreadable in the brightest palettes.
 */
function tabStates(roots: unknown[]): { label: string; accentIcon: boolean; boldLabel: boolean }[] {
  const tabs: { label: string; accentIcon: boolean; boldLabel: boolean }[] = [];
  walkNodes(roots as never, (node: any) => {
    if (typeof node?.name !== "string" || !node.name.startsWith("Tab ")) return;
    const children = node.children ?? [];
    const icon = children.find((c: any) => c?.type === "icon");
    const label = children.find((c: any) => c?.type === "text");
    if (!icon || !label) return;
    tabs.push({
      label: label.content,
      accentIcon: icon.stroke === "$accent-primary",
      boldLabel: label.fill === "$foreground-primary" && label.fontWeight === 600
    });
  });
  return tabs;
}

describe("screen scaffold", () => {
  it("applies the chrome numbers the prompt used to ask for", () => {
    const { node } = buildScreen(
      { name: "Home", kind: "mobile", tabs: [{ label: "Home", icon: "house", active: true }, { label: "Saved", icon: "heart" }] },
      ids()
    );
    expect(node.width).toBe(MOBILE_WIDTH);
    expect(node.height).toBe(MOBILE_HEIGHT);
    expect(find(node, "Status Bar")?.height).toBe(STATUS_BAR_HEIGHT);
    const bar = find(node, "Tab Bar")!;
    expect(bar.height).toBe(TAB_BAR_HEIGHT);
    expect(bar.cornerRadius).toBe(TAB_BAR_HEIGHT / 2);
    expect(find(node, "Tab Bar Inset")?.padding).toEqual([0, 16, 12, 16]);
  });

  it("gives every tab an icon, which a hand-built bar keeps losing", () => {
    const { node } = buildScreen(
      { name: "Home", kind: "mobile", tabs: [{ label: "A", icon: "house" }, { label: "B", icon: "heart" }, { label: "C", icon: "user" }] },
      ids()
    );
    const bar = find(node, "Tab Bar")!;
    const items = childrenOf(bar);
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(childrenOf(item).some((c) => c.type === "icon")).toBe(true);
      expect(childrenOf(item).some((c) => c.type === "text")).toBe(true);
    }
  });

  it("marks exactly one tab active", () => {
    const { node } = buildScreen(
      { name: "Home", kind: "mobile", tabs: [{ label: "A", icon: "house", active: true }, { label: "B", icon: "heart" }] },
      ids()
    );
    expect(tabStates([node])).toEqual([
      { label: "A", accentIcon: true, boldLabel: true },
      { label: "B", accentIcon: false, boldLabel: false }
    ]);
  });

  it("omits the tab bar when no destinations are given", () => {
    const { node, slots } = buildScreen({ name: "Onboarding", kind: "mobile" }, ids());
    expect(find(node, "Tab Bar")).toBeUndefined();
    expect(slots.tabBar).toBeUndefined();
    expect(slots.content).toBeTruthy();
  });

  it("counts a desktop screen as a screen", () => {
    // Read for a status bar alone, the screen-level rules skipped every desktop
    // document: no accent check, no nested-screen check, and the harness
    // reported desktop runs as having built nothing.
    const { craftMetrics } = require("../eval/metrics");
    const { node } = buildScreen({ name: "Board", kind: "desktop" }, ids());
    const doc: Document = { version: "1.0", children: [node], variables: {} };
    expect(craftMetrics(doc).screens).toBe(1);

    const withAccents: Document = {
      version: "1.0", variables: {},
      children: [{ ...node, children: [
        ...(node.children ?? []),
        { type: "frame", id: "x1", width: 100, height: 40, fill: "$accent-primary", children: [] },
        { type: "frame", id: "x2", width: 100, height: 40, fill: "$accent-primary", children: [] }
      ] } as any]
    };
    const { auditDocument } = require("../src/design/evaluator");
    expect(auditDocument(withAccents).filter((f: any) => f.rule === "accent_overuse").length).toBe(1);
  });

  it("gives the desktop dominant region the remaining width and the rails a fixed one", () => {
    const { node, slots } = buildScreen({ name: "Board", kind: "desktop" }, ids());
    expect(find(node, "Main")?.width).toBe("fill_container");
    expect(find(node, "Left Rail")?.width).toBe(260);
    expect(find(node, "Right Rail")?.width).toBe(320);
    expect(Object.keys(slots).sort()).toEqual(["aside", "main", "rail", "screen", "topBar"]);
  });

  it("produces a screen the auditor passes, so the floor is clean before content", () => {
    const style = resolveStyle({
      palette: "Warm Linen", roundness: "Rounded", elevation: "Soft Lift",
      headings: "Funnel Display", body: "Inter", captions: "Inter"
    });
    const { node } = buildScreen(
      { name: "Home", kind: "mobile", tabs: [{ label: "Home", icon: "house", active: true }, { label: "Saved", icon: "heart" }, { label: "You", icon: "user" }] },
      ids()
    );
    const doc: Document = { version: "1.0", children: [node], variables: style.variables };
    // Warnings too, not only blockers. The scaffold emits on every screen of
    // every run, so a warning it causes is a warning the model can never clear.
    //
    // scaffold_only is the exception and is asserted separately below: it is
    // not a defect in the chrome, it is the statement that no content has been
    // put on the screen yet, and the model clears it by doing the work.
    const findings = auditDesign(layoutResolvedDocument(doc), doc).filter(
      (f) => f.rule !== "scaffold_only"
    );
    expect(findings.map((b) => `${b.severity} ${b.rule} ${b.nodeId}: ${b.message}`)).toEqual([]);
  });

  it("blocks a screen that is still only the scaffold, and stops once it holds content", () => {
    // The gap that let four empty screens ship. create_screen returns chrome
    // and empty slots; the run was cut off before it filled them, and the audit
    // scored the result a clean pass, so the completion check had nothing to
    // send back.
    const style = resolveStyle({
      palette: "Warm Linen", roundness: "Rounded", elevation: "Soft Lift",
      headings: "Funnel Display", body: "Inter", captions: "Inter"
    });
    const { node, slots } = buildScreen(
      { name: "Home", kind: "mobile", tabs: [{ label: "Home", icon: "house", active: true }, { label: "Saved", icon: "heart" }] },
      ids()
    );
    const bare: Document = { version: "1.0", children: [node], variables: style.variables };

    const blocked = auditDesign(layoutResolvedDocument(bare), bare).filter(
      (f) => f.rule === "scaffold_only"
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0].severity).toBe("blocker");
    expect(blocked[0].nodeId).toBe(node.id);
    expect(blocked[0].message).toContain("Home");

    // One real line of copy in the content slot is enough: the screen is being
    // built now, and the rule must not keep firing while that is under way.
    const content = find(node, "Inset Content") ?? find(node, slots.content ?? "") ;
    (content as any).children = [
      { type: "text", id: "copy", content: "Tonight's plan", fontSize: 28, fontFamily: "$font-heading", fill: "$foreground-primary", width: "fill_container", textGrowth: "fixed-width" }
    ];
    const filled: Document = { version: "1.0", children: [node], variables: style.variables };

    expect(
      auditDesign(layoutResolvedDocument(filled), filled).some((f) => f.rule === "scaffold_only")
    ).toBe(false);
  });
});

describe("create_screen tool", () => {
  const empty = (): Document => ({ version: "1.0", children: [], variables: {} });

  it("places screens side by side rather than inside each other", async () => {
    const session = createDocumentTools(empty());
    await session.execute("create_screen", { name: "One", kind: "mobile" });
    await session.execute("create_screen", { name: "Two", kind: "mobile" });
    expect(session.doc.children.length).toBe(2);
    expect(session.doc.children[0].x).toBe(0);
    expect(session.doc.children[1].x).toBe(MOBILE_WIDTH + 80);
  });

  it("gives fresh ids to the second screen", async () => {
    const session = createDocumentTools(empty());
    await session.execute("create_screen", { name: "One", kind: "mobile", tabs: [{ label: "A", icon: "house" }] });
    await session.execute("create_screen", { name: "Two", kind: "mobile", tabs: [{ label: "A", icon: "house" }] });
    const seen = new Set<string>();
    let duplicates = 0;
    walkNodes(session.doc.children, (n) => {
      if (seen.has(n.id)) duplicates += 1;
      seen.add(n.id);
    });
    expect(duplicates).toBe(0);
  });

  it("returns the slot ids the caller has to fill", async () => {
    const session = createDocumentTools(empty());
    const out = await session.execute("create_screen", { name: "Home", kind: "mobile" });
    expect(out).toContain("content:");
    expect(out).toContain("bleed:");
    expect(out).toContain("screen:");
  });

  it("offers inset and full-bleed mobile composition", () => {
    const { node, slots } = buildScreen({ name: "Discover", kind: "mobile" }, ids());
    const bleed = find(node, "Bleed Content")!;
    const content = find(node, "Inset Content")!;

    expect(bleed.id).toBe(slots.bleed);
    expect(bleed.padding).toBeUndefined();
    expect(bleed.width).toBe("fill_container");
    expect(content.id).toBe(slots.content);
    expect(content.padding).toEqual([0, 20]);
  });

  it("keeps mobile screen roots at one device size", async () => {
    const session = createDocumentTools(empty());
    await session.execute("create_screen", { name: "Home", kind: "mobile" });
    const screen = session.doc.children[0];

    expect(screen.metadata?.screenKind).toBe("mobile");
    expect(await session.execute("set_property", { id: screen.id, property: "height", value: 1200 })).toContain("fixed");
    expect(await session.execute("batch_set_properties", {
      updates: [{ id: screen.id, property: "width", value: 430 }]
    })).toContain("fixed");
    expect(screen.width).toBe(MOBILE_WIDTH);
    expect(screen.height).toBe(MOBILE_HEIGHT);
  });

  it("does not mistake a hand-built status bar for a scaffolded mobile screen", async () => {
    const session = createDocumentTools(makeDoc(frame("custom", 390, 900, [frame("status", 390, 62, [], {
      name: "Status Bar"
    })])));

    expect(await session.execute("set_property", {
      id: "custom",
      property: "height",
      value: 844
    })).not.toContain("error:");
  });

  it("refuses a kind it does not build", async () => {
    const session = createDocumentTools(empty());
    expect(await session.execute("create_screen", { name: "X", kind: "watch" })).toContain("error:");
    expect(await session.execute("create_screen", { kind: "mobile" })).toContain("error:");
  });

  it("makes the first tab active when none was marked", async () => {
    const session = createDocumentTools(empty());
    const out = await session.execute("create_screen", {
      name: "Home", kind: "mobile",
      tabs: [{ label: "A", icon: "house" }, { label: "B", icon: "heart" }]
    });
    expect(out).not.toContain("error:");
    expect(tabStates(session.doc.children)).toEqual([
      { label: "A", accentIcon: true, boldLabel: true },
      { label: "B", accentIcon: false, boldLabel: false }
    ]);
  });
});

describe("engine-side defaults", () => {
  const empty = (): Document => ({ version: "1.0", children: [], variables: {} });
  const prose = "A sentence that is comfortably longer than forty characters.";

  it("sets a wrapping mode on spanning prose so it cannot be clipped", async () => {
    const session = createDocumentTools(empty());
    const out = await session.execute("insert_node", {
      node: { type: "frame", id: "f", width: 390, height: 200, layout: "vertical",
              children: [{ type: "text", id: "t", content: prose, width: "fill_container", fontSize: 14 }] }
    });
    expect(out).toContain("filled in");
    const text = childrenOf(session.doc.children[0])[0] as any;
    expect(text.textGrowth).toBe("fixed-width");
  });

  it("leaves a short label and an explicit choice alone", async () => {
    const session = createDocumentTools(empty());
    await session.execute("insert_node", {
      node: { type: "frame", id: "f", width: 390, height: 200, layout: "vertical",
              children: [
                { type: "text", id: "short", content: "Save", width: "fill_container" },
                { type: "text", id: "mine", content: prose, width: "fill_container", textGrowth: "auto" }
              ] }
    });
    const kids = childrenOf(session.doc.children[0]) as any[];
    expect(kids[0].textGrowth).toBeUndefined();
    expect(kids[1].textGrowth).toBe("auto");
  });

  it("leaves prose with no width to wrap into alone, since guessing one would be a design decision", async () => {
    const session = createDocumentTools(empty());
    await session.execute("insert_node", {
      node: { type: "frame", id: "f", width: 390, height: 200, layout: "vertical",
              children: [{ type: "text", id: "t", content: prose, width: "fit_content" }] }
    });
    expect((childrenOf(session.doc.children[0])[0] as any).textGrowth).toBeUndefined();
  });
});

/* A style system that recommends a token the auditor rejects is the same defect
 * as an audit that cannot fail: the model is sent to do something, then marked
 * down for doing it. These tests hold the two halves to the same numbers. */
describe("guidelines agree with the auditor", () => {
  it("never points small text at a token that cannot carry it", () => {
    const { PALETTES, styleGuidelines, resolveStyle } = require("../src/design/styleSystem");
    for (const palette of PALETTES) {
      const style = resolveStyle({
        palette: palette.name, roundness: "Rounded", elevation: "Flat",
        headings: "Inter", body: "Inter", captions: "Inter"
      });
      const text = styleGuidelines(style);
      // The line that names muted must not offer it for small text.
      const line = text.split("\n").find((l: string) => l.includes("$foreground-muted"))!;
      expect(line).toBeTruthy();
      expect(line).not.toMatch(/timestamps|inactive tab labels|caption/i);
    }
  });

  it("holds every token that may carry text to 4.5:1 on both surfaces", () => {
    // Not just the one that failed last time. $accent-primary is deliberately
    // absent: it stopped carrying text when the active tab moved to weight, and
    // holding it to a text ratio is what excluded every bright-accent world
    // from the catalog. It is measured as a graphic below, and any accent text
    // the model writes anyway is caught at runtime by the low_contrast rule.
    const { PALETTES } = require("../src/design/styleSystem");
    const { contrastRatio } = require("../src/design/evaluator");
    const carriesText = ["foreground-primary", "foreground-secondary"];
    for (const p of PALETTES) {
      for (const token of carriesText) {
        for (const bg of ["surface-primary", "surface-secondary"]) {
          const ratio = contrastRatio(p.tokens[token], p.tokens[bg]);
          expect(`${p.name} ${token} on ${bg}: ${ratio.toFixed(2)}`).toBe(
            `${p.name} ${token} on ${bg}: ${Math.max(ratio, 4.5).toFixed(2)}`
          );
        }
      }
    }
  });

  it("holds $accent-primary to the 3:1 a graphic needs on both surfaces", () => {
    // The accent draws icons, indicators, focus rings and solid fills. Those
    // are graphics, so 3:1 is the real floor — but it is a floor, not a pass:
    // an accent that vanishes against the bar cannot mark anything.
    const { PALETTES } = require("../src/design/styleSystem");
    const { contrastRatio } = require("../src/design/evaluator");
    for (const p of PALETTES) {
      for (const bg of ["surface-primary", "surface-secondary"]) {
        const ratio = contrastRatio(p.tokens["accent-primary"], p.tokens[bg]);
        expect(`${p.name} accent on ${bg}: ${ratio.toFixed(2)}`).toBe(
          `${p.name} accent on ${bg}: ${Math.max(ratio, 3).toFixed(2)}`
        );
      }
    }
  });
});

/* The measurement layer has to see what the canvas draws. It did not: the UI
 * and the renderer resolved instances, the agent's audit and `measure` did not,
 * so a screen built from components measured as a screen full of 0x0 boxes and
 * the model learned that components break the design. */
describe("components measure the same as the structure they replace", () => {
  const { auditDocument } = require("../src/design/evaluator");
  const { craftMetrics } = require("../eval/metrics");

  function row(id: string, name: string) {
    return {
      type: "frame", id, name: "Row", width: "fill_container", height: 64, layout: "horizontal",
      alignItems: "center", padding: 12, gap: 12, fill: "$surface-secondary",
      children: [{ type: "text", id: `${id}_t`, content: name, fontSize: 16, fill: "$foreground-primary" }]
    } as any;
  }

  const expanded: Document = {
    version: "1.0", variables: {},
    children: [{ type: "frame", id: "list", name: "List", width: 320, height: 300, layout: "vertical", gap: 8,
      children: [row("r1", "Bella"), row("r2", "Juniper")] } as any]
  };

  const withComponent: Document = {
    version: "1.0", variables: {},
    children: [
      // Parked off to the side. A component left at 0,0 sits under the first
      // screen and collides with it, which the auditor is right to report.
      { ...row("row", "Bella"), reusable: true, width: 320, x: 400, y: 0 },
      { type: "frame", id: "list", name: "List", width: 320, height: 300, layout: "vertical", gap: 8,
        children: [
          { type: "ref", id: "i1", ref: "row" },
          { type: "ref", id: "i2", ref: "row", descendants: { row_t: { content: "Juniper" } } }
        ] } as any
    ]
  };

  it("gives an instance a real box instead of 0x0", () => {
    const { resolveInstances } = require("../src/model/instance");
    const boxes = new Map(
      layoutResolvedDocument(resolveInstances(withComponent)).flatMap(function walk(n: any): any[] {
        return [[n.id, n.box], ...(n.children ?? []).flatMap(walk)];
      })
    );
    const instance = boxes.get("i1") as any;
    expect(instance).toBeTruthy();
    expect(instance.width).toBeGreaterThan(0);
    expect(instance.height).toBeGreaterThan(0);
  });

  it("finds no blocker in either shape", () => {
    expect(auditDocument(expanded).filter((f: any) => f.severity === "blocker")).toEqual([]);
    expect(auditDocument(withComponent).filter((f: any) => f.severity === "blocker")).toEqual([]);
  });

  it("counts the component version as reuse", () => {
    expect(craftMetrics(expanded).components).toBe(0);
    expect(craftMetrics(withComponent).components).toBe(1);
    expect(craftMetrics(withComponent).reuseRatio).toBeGreaterThan(0);
  });
});

describe("scaffold_only survives the model renaming things", () => {
  const build = () => {
    const style = resolveStyle({
      palette: "Warm Linen", roundness: "Rounded", elevation: "Soft Lift",
      headings: "Funnel Display", body: "Inter", captions: "Inter"
    });
    const { node } = buildScreen(
      { name: "Home", kind: "mobile", tabs: [{ label: "Home", icon: "house", active: true }, { label: "Saved", icon: "heart" }] },
      ids()
    );
    return { node, doc: (): Document => ({ version: "1.0", children: [node], variables: style.variables }) };
  };
  const fires = (doc: Document) =>
    auditDesign(layoutResolvedDocument(doc), doc).some((f) => f.rule === "scaffold_only");

  it("still sees an empty screen when the chrome has been renamed", () => {
    // The regex fallback keys on names, and the model may call anything
    // anything. Rename the tab bar and its icons and labels stop looking like
    // chrome — they would be counted as content, and a screen holding nothing
    // would score a pass. The tag create_screen stamps does not move.
    const { node, doc } = build();
    const tabBar = find(node, "Tab Bar")!;
    tabBar.name = "Floating Pill Nav";
    find(node, "Status Bar")!.name = "Top Strip";
    expect(fires(doc())).toBe(true);
  });

  it("does not count a slot the model renamed as content in itself", () => {
    const { node, doc } = build();
    find(node, "Inset Content")!.name = "Feed";
    expect(fires(doc())).toBe(true);
  });

  it("clears as soon as real content goes into a renamed slot", () => {
    const { node, doc } = build();
    const slot = find(node, "Inset Content")!;
    slot.name = "Feed";
    (slot as any).children = [
      { type: "text", id: "copy", content: "Nearby", fontSize: 24, fontFamily: "$font-heading", fill: "$foreground-primary", width: "fill_container", textGrowth: "fixed-width" }
    ];
    expect(fires(doc())).toBe(false);
  });

  it("reads the tag on a screen whose names carry no hint at all", () => {
    const { node, doc } = build();
    walkNodes([node], (n) => {
      if ((n as any).metadata?.scaffold) n.name = "x";
    });
    expect(fires(doc())).toBe(true);
  });
});
