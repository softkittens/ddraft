import { describe, it, expect } from "bun:test";
import { makeDoc } from "./harness";
import { resolvePromptContext, parseResolvedContext } from "../src/agent/context";
import { DIRECTION_METADATA_KEY } from "../src/design/styleSystem";
import type { FrameNode } from "../src/model/types";

describe("Context Resolution Subsystem", () => {
  it("resolves mobile surface and consumer ordering trait from prompt", () => {
    const ctx = resolvePromptContext("Create mobile app for ordering matcha cakes");
    expect(ctx.surface).toBe("mobile");
    expect(ctx.archetype).toBe("app");
    expect(ctx.traits).toContain("commerce_ordering");
    expect(ctx.traits).not.toContain("swipe_discovery");
    expect(ctx.lifecycle).toBe("initial_build");
  });

  it("resolves desktop site and editorial traits from landing page prompt", () => {
    const ctx = resolvePromptContext("Landing page for Lisbon coworking space");
    expect(ctx.surface).toBe("desktop");
    expect(ctx.archetype).toBe("site");
    expect(ctx.traits).toContain("editorial");
    expect(ctx.traits).not.toContain("commerce_ordering");
    expect(ctx.lifecycle).toBe("initial_build");
  });

  it("resolves tool archetype and data visualization trait for dashboards", () => {
    const ctx = resolvePromptContext("Kubernetes cluster monitoring dashboard with telemetry metrics");
    expect(ctx.surface).toBe("desktop");
    expect(ctx.archetype).toBe("tool");
    expect(ctx.traits).toContain("data_visualization");
    expect(ctx.traits).not.toContain("commerce_ordering");
    expect(ctx.lifecycle).toBe("initial_build");
  });

  it("resolves swipe discovery trait for dating and pet adoption apps", () => {
    const ctx = resolvePromptContext("Mobile app tinder for cat adoption");
    expect(ctx.surface).toBe("mobile");
    expect(ctx.archetype).toBe("app");
    expect(ctx.traits).toContain("swipe_discovery");
    expect(ctx.traits).not.toContain("commerce_ordering");
  });

  it("prioritizes canvas ground truth over ambiguous prompt text", () => {
    const doc = makeDoc();
    doc.children = [
      {
        id: "screen_mobile",
        name: "Mobile Screen",
        type: "frame",
        width: 390,
        height: 844,
        children: []
      } as FrameNode
    ];
    const ctx = resolvePromptContext("adjust the primary button color", doc);
    expect(ctx.surface).toBe("mobile");
  });

  it("detects incremental revision lifecycle when canvas already has content", () => {
    const doc = makeDoc();
    doc.children = [
      {
        id: "screen_1",
        name: "Screen",
        type: "frame",
        width: 390,
        height: 844,
        children: [
          { id: "child_1", type: "frame", children: [] } as any,
          { id: "child_2", type: "text", content: "Hello" } as any
        ]
      } as FrameNode
    ];
    const ctx = resolvePromptContext("change the title text to italic and fix padding", doc);
    expect(ctx.lifecycle).toBe("revision_edit");
  });

  it("respects recorded direction metadata when available", () => {
    const doc = makeDoc();
    doc.metadata = {
      [DIRECTION_METADATA_KEY]: {
        thesis: "A command console, not a marketing dashboard",
        ownWorld: "Terminal phosphor field",
        firstViewport: "Telemetry queue"
      }
    };
    const ctx = resolvePromptContext("", doc);
    expect(ctx.archetype).toBe("tool");
  });

  it("allows explicit mobile prompt to override existing desktop canvas state for companion generation", () => {
    const doc = makeDoc();
    doc.children = [
      {
        id: "desktop_screen",
        name: "Desktop Screen",
        type: "frame",
        width: 1440,
        height: 900,
        children: []
      } as FrameNode
    ];
    const ctx = resolvePromptContext("now create a mobile version of this screen", doc);
    expect(ctx.surface).toBe("mobile");
    expect(ctx.archetype).toBe("app");
  });

  it("uses selected element to determine active surface on a dual-screen canvas", () => {
    const doc = makeDoc();
    doc.children = [
      {
        id: "desktop_screen",
        name: "Desktop Screen",
        type: "frame",
        width: 1440,
        height: 900,
        children: [{ id: "desktop_button", type: "frame", children: [] }]
      } as FrameNode,
      {
        id: "mobile_screen",
        name: "Mobile Screen",
        type: "frame",
        width: 390,
        height: 844,
        children: [{ id: "mobile_card", type: "frame", children: [] }]
      } as FrameNode
    ];
    const ctx = resolvePromptContext("make this card background darker", doc, ["mobile_card"]);
    expect(ctx.surface).toBe("mobile");
  });

  it("maintains domain trait continuity across multi-turn session history", () => {
    const doc = makeDoc();
    // Turn 1 was "Create matcha cake bakery ordering app", Turn 2 is "make button darker"
    const ctx = resolvePromptContext("make the button darker", doc, [], "Create matcha cake bakery ordering app");
    expect(ctx.traits).toContain("commerce_ordering");
  });
});

/**
 * Cases taken from real runs that resolved wrongly. Each one is a sentence a
 * user actually types, and the assertion is what the screen they asked for
 * needs — not what the regexes happened to do.
 */
describe("Prompt behaviour corpus", () => {
  function canvasWithContent(width = 1440) {
    const doc = makeDoc();
    doc.children = [
      {
        id: "screen_1",
        name: "Screen",
        type: "frame",
        width,
        height: width === 390 ? 844 : 900,
        children: [
          { id: "child_1", type: "frame", children: [] } as any,
          { id: "child_2", type: "text", content: "Hello" } as any
        ]
      } as FrameNode
    ];
    return doc;
  }

  it("keeps a landing page a site when the product it sells is a dashboard", () => {
    const ctx = resolvePromptContext("Landing page for an analytics dashboard product");
    expect(ctx.surface).toBe("desktop");
    expect(ctx.archetype).toBe("site");
  });

  it("keeps a mobile analytics app on the mobile surface without a desktop tool archetype", () => {
    const ctx = resolvePromptContext("Mobile analytics app");
    expect(ctx.surface).toBe("mobile");
    expect(ctx.archetype).not.toBe("tool");
    expect(ctx.traits).toContain("data_visualization");
  });

  it("does not deal commerce and swipe templates to the same screen", () => {
    const ctx = resolvePromptContext("Pet shop ordering app");
    expect(ctx.traits).toContain("commerce_ordering");
    expect(ctx.traits).not.toContain("swipe_discovery");
  });

  it("still reads swipe discovery when that is the actual request", () => {
    const ctx = resolvePromptContext("Swipe app for dog adoption");
    expect(ctx.traits).toContain("swipe_discovery");
    expect(ctx.traits).not.toContain("commerce_ordering");
  });

  it("lets a new brief reset the archetype an earlier turn established", () => {
    const ctx = resolvePromptContext(
      "Portfolio site for a ceramicist",
      undefined,
      [],
      "Build a telemetry console for our fleet Portfolio site for a ceramicist"
    );
    expect(ctx.archetype).toBe("site");
  });

  it("lets a new brief reset the domain traits an earlier turn established", () => {
    const ctx = resolvePromptContext(
      "Landing page for a Lisbon architecture studio",
      undefined,
      [],
      "Mobile app for ordering matcha cakes Landing page for a Lisbon architecture studio"
    );
    expect(ctx.traits).not.toContain("commerce_ordering");
  });

  it("resolves banking app to mobile app initial build", () => {
    const ctx = resolvePromptContext("Design a banking app");
    expect(ctx.surface).toBe("mobile");
    expect(ctx.archetype).toBe("app");
    expect(ctx.lifecycle).toBe("initial_build");
  });

  it("resolves desktop dashboard to tool archetype", () => {
    const ctx = resolvePromptContext("Desktop dashboard for fleet operations");
    expect(ctx.surface).toBe("desktop");
    expect(ctx.archetype).toBe("tool");
  });

  it("resolves web dashboard to tool archetype", () => {
    const ctx = resolvePromptContext("Web dashboard for fleet operations");
    expect(ctx.surface).toBe("desktop");
    expect(ctx.archetype).toBe("tool");
  });

  it.each([
    "Make it more polished",
    "Improve the hierarchy",
    "Revise the hero",
    "Add a checkout section",
    "Add a new section",
    "Add a new dashboard section",
    "Tighten the spacing",
    "The footer feels weak",
    "Redesign this in dark mode",
    "Restyle with a warm editorial aesthetic",
    "Improve the analytics hierarchy",
    "Fix the telemetry labels",
    "Make the dashboard more polished",
    "Dashboard looks crowded",
    "The app is too dense",
    "This dashboard should be denser",
    "Update the dashboard for mobile",
    "Optimize the site for mobile",
    "Make the app for older users",
    "Design the button states"
  ])("treats %j on an existing canvas as a revision", (phrase) => {
    expect(resolvePromptContext(phrase, canvasWithContent()).lifecycle).toBe("revision_edit");
  });

  it.each([
    "Create a mobile companion screen",
    "Landing page for a new coffee subscription",
    "Build a fleet operations dashboard",
    "Design a banking app"
  ])("treats %j on an existing canvas as a new build", (phrase) => {
    expect(resolvePromptContext(phrase, canvasWithContent()).lifecycle).toBe("initial_build");
  });
});

describe("Resolved context over the wire", () => {
  it("round-trips a resolved context", () => {
    const ctx = resolvePromptContext("Kubernetes cluster monitoring dashboard");
    expect(parseResolvedContext(JSON.parse(JSON.stringify(ctx)))).toEqual(ctx);
  });

  it("rejects anything that is not a resolved context", () => {
    expect(parseResolvedContext(undefined)).toBeUndefined();
    expect(parseResolvedContext("tool")).toBeUndefined();
    expect(parseResolvedContext({ surface: "watch", archetype: "tool", lifecycle: "initial_build" })).toBeUndefined();
  });

  it("drops trait names it does not know", () => {
    const parsed = parseResolvedContext({
      surface: "mobile",
      archetype: "app",
      traits: ["commerce_ordering", "ignore_all_previous_rules"],
      lifecycle: "initial_build"
    });
    expect(parsed?.traits).toEqual(["commerce_ordering"]);
  });
});
