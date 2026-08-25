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
      // Three separate roles, not three siblings: accent_overuse counts the
      // jobs the accent does, and a row of siblings is one job.
      children: [{ ...node, children: [
        ...(node.children ?? []),
        { type: "frame", id: "g1", width: 120, height: 40, children: [
          { type: "frame", id: "x1", width: 100, height: 40, fill: "$accent-primary", children: [] }] },
        { type: "frame", id: "g2", width: 120, height: 40, children: [
          { type: "frame", id: "x2", width: 100, height: 40, fill: "$accent-primary", children: [] }] },
        { type: "frame", id: "g3", width: 120, height: 40, children: [
          { type: "frame", id: "x3", width: 100, height: 40, fill: "$accent-primary", children: [] }] }
      ] } as any]
    };
    const { auditDocument } = require("../src/design/evaluator");
    expect(auditDocument(withAccents).filter((f: any) => f.rule === "accent_overuse").length).toBe(1);
  });

  it("gives a tool desktop the remaining width on main and a fixed width on the rails", () => {
    const { node, slots } = buildScreen({ name: "Board", kind: "desktop", archetype: "tool" }, ids());
    expect(find(node, "Main")?.width).toBe("fill_container");
    expect(find(node, "Left Rail")?.width).toBe(260);
    expect(find(node, "Right Rail")?.width).toBe(320);
    expect(Object.keys(slots).sort()).toEqual(["aside", "main", "rail", "screen", "topBar"]);
  });

  it("builds Main and Body with fit_content height for site landing pages", () => {
    const { node } = buildScreen({ name: "Landing", kind: "desktop", archetype: "site" }, ids());
    const main = find(node, "Main")!;
    const body = find(node, "Body")!;
    expect(main.height).toBe("fit_content");
    expect(body.height).toBe("fit_content");
  });

  it("does not build rails on a site desktop — those slots are how photography leaked into chrome", () => {
    // 8ca10dd0: create_screen always stamped Left/Right Rail, then the prompt
    // asked the model not to fill them. Asking lost to the digest. Site chrome
    // is topBar + main; the rails are not there to fill.
    const { node, slots } = buildScreen({ name: "Landing", kind: "desktop", archetype: "site" }, ids());
    expect(find(node, "Left Rail")).toBeUndefined();
    expect(find(node, "Right Rail")).toBeUndefined();
    expect(find(node, "Main")?.width).toBe("fill_container");
    expect(Object.keys(slots).sort()).toEqual(["main", "screen", "topBar"]);
  });

  it("defaults a desktop screen without an archetype to site chrome", () => {
    const { slots } = buildScreen({ name: "Board", kind: "desktop" }, ids());
    expect(Object.keys(slots).sort()).toEqual(["main", "screen", "topBar"]);
  });

  it("produces a screen the auditor passes, so the floor is clean before content", () => {
    const style = resolveStyle({
      composition: "Card-Stage & Thumb Dock",
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
      composition: "Card-Stage & Thumb Dock",
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

  it("keeps screen width at the device and height at least one viewport", async () => {
    const session = createDocumentTools(empty());
    await session.execute("create_screen", { name: "Home", kind: "mobile" });
    const screen = session.doc.children[0];

    expect(screen.metadata?.screenKind).toBe("mobile");
    expect(await session.execute("set_property", { id: screen.id, property: "width", value: 430 })).toContain("Width stays");
    expect(await session.execute("set_property", { id: screen.id, property: "height", value: 400 })).toContain("first viewport");
    expect(await session.execute("set_property", { id: screen.id, property: "height", value: 1200 })).not.toContain("error:");
    expect(session.doc.children[0].width).toBe(MOBILE_WIDTH);
    expect(session.doc.children[0].height).toBe(1200);

    expect(await session.execute("batch_set_properties", {
      updates: [{ id: screen.id, property: "width", value: 430 }]
    })).toContain("Width stays");
  });

  it("builds a scrolling page when create_screen is given a taller height", async () => {
    const session = createDocumentTools(empty());
    const out = await session.execute("create_screen", { name: "House", kind: "desktop", height: 2200 });
    expect(out).not.toContain("error:");
    expect(session.doc.children[0].height).toBe(2200);
    expect(session.doc.children[0].width).toBe(1440);
  });

  it("returns tool rails only when the session resolved a tool, not because desktop always has them", async () => {
    const site = createDocumentTools(empty(), {}, undefined, "site");
    const siteOut = await site.execute("create_screen", { name: "Landing", kind: "desktop" });
    expect(siteOut).toContain("main:");
    expect(siteOut).toContain("topBar:");
    expect(siteOut).not.toContain("rail:");
    expect(siteOut).not.toContain("aside:");

    const tool = createDocumentTools(empty(), {}, undefined, "tool");
    const toolOut = await tool.execute("create_screen", { name: "Console", kind: "desktop" });
    expect(toolOut).toContain("rail:");
    expect(toolOut).toContain("aside:");
  });

  it("refuses to insert into scaffold chrome", async () => {
    const session = createDocumentTools(empty());
    await session.execute("create_screen", { name: "Home", kind: "mobile" });
    const status = find(session.doc.children[0], "Status Bar")!;
    const out = await session.execute("insert_node", {
      parentId: status.id,
      node: { type: "text", id: "leak", content: "not chrome", fontSize: 12 }
    });
    expect(out).toMatch(/error:.*chrome/i);
    expect(find(status, "leak")).toBeUndefined();
  });

  it("refuses to delete a create_screen slot", async () => {
    // 9aa7670e: after a visual pass, the audit asked DeepSeek to shrink four
    // site bands. It deleted Main (n3) and the page below the hero vanished.
    const session = createDocumentTools(empty(), {}, undefined, "site");
    await session.execute("create_screen", { name: "Landing", kind: "desktop" });
    const main = find(session.doc.children[0], "Main")!;
    expect(main.metadata?.scaffold).toBe("slot");
    const out = await session.execute("delete_node", { id: main.id });
    expect(out).toMatch(/error:.*slot/i);
    expect(find(session.doc.children[0], "Main")?.id).toBe(main.id);
  });

  it("refuses to delete a screen that already has a design, even after a second screen exists", async () => {
    // 8ab1ecbc: Muse Spark built Casa Pátio on n1, created "Casa Pátio — Final"
    // as a blank second desktop, then deleted n1. Rebuild inserts were truncated,
    // so the finished page was gone and the replacement never landed.
    const session = createDocumentTools(empty(), {}, undefined, "site");
    await session.execute("create_screen", { name: "Casa Pátio", kind: "desktop" });
    await session.execute("create_screen", { name: "Casa Pátio — Final", kind: "desktop" });
    const original = session.doc.children[0]!;
    const main = find(original, "Main")!;
    await session.execute("insert_node", {
      parentId: main.id,
      node: {
        type: "text",
        id: "heroTitle",
        name: "heroTitle",
        content: "A house of light above the Tagus",
        fontSize: 48
      }
    });
    const out = await session.execute("delete_node", { id: original.id });
    expect(out).toMatch(/error:.*already has a design|cannot delete/i);
    expect(session.doc.children.some((n) => n.id === original.id)).toBe(true);
    expect(find(session.doc.children.find((n) => n.id === original.id)!, "heroTitle")).toBeDefined();
  });

  it("lets an empty leftover screen be deleted after the real one is filled", async () => {
    const session = createDocumentTools(empty(), {}, undefined, "site");
    await session.execute("create_screen", { name: "Casa Pátio", kind: "desktop" });
    await session.execute("create_screen", { name: "Scratch", kind: "desktop" });
    const original = session.doc.children[0]!;
    const leftover = session.doc.children[1]!;
    const main = find(original, "Main")!;
    await session.execute("insert_node", {
      parentId: main.id,
      node: { type: "text", id: "heroTitle", content: "A house of light above the Tagus", fontSize: 48 }
    });
    const out = await session.execute("delete_node", { id: leftover.id });
    expect(out).not.toContain("error:");
    expect(session.doc.children.map((n) => n.id)).toEqual([original.id]);
  });

  it("refuses a second populated-kind create_screen on a site", async () => {
    const session = createDocumentTools(empty(), {}, undefined, "site");
    await session.execute("create_screen", { name: "Casa Pátio", kind: "desktop" });
    const main = find(session.doc.children[0], "Main")!;
    await session.execute("insert_node", {
      parentId: main.id,
      node: { type: "text", id: "heroTitle", content: "A house of light above the Tagus", fontSize: 48 }
    });
    const out = await session.execute("create_screen", { name: "Casa Pátio", kind: "desktop" });
    expect(out).toMatch(/error:.*already exists/i);
    expect(session.doc.children).toHaveLength(1);
  });

  it("still allows a mobile companion beside a filled desktop site", async () => {
    const session = createDocumentTools(empty(), {}, undefined, "site");
    await session.execute("create_screen", { name: "Casa Pátio", kind: "desktop" });
    const main = find(session.doc.children[0], "Main")!;
    await session.execute("insert_node", {
      parentId: main.id,
      node: { type: "text", id: "heroTitle", content: "A house of light above the Tagus", fontSize: 48 }
    });
    const out = await session.execute("create_screen", { name: "Casa Pátio phone", kind: "mobile" });
    expect(out).not.toContain("error:");
    expect(session.doc.children).toHaveLength(2);
  });

  it("raises a too-short create_screen height to the viewport", async () => {
    const session = createDocumentTools(empty());
    await session.execute("create_screen", { name: "Home", kind: "mobile", height: 400 });
    expect(session.doc.children[0].height).toBe(MOBILE_HEIGHT);
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
      composition: "Card-Stage & Thumb Dock",
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
