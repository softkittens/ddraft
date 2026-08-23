import { describe, it, expect } from "bun:test";
import { makeDoc } from "./harness";
import { resolvePromptContext } from "../src/agent/context";
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
