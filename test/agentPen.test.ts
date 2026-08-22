import { describe, it, expect } from "bun:test";
import {
  activeEditTarget,
  noteAgentEdits,
  clearAgentEditTargets,
  diffChangedNodeIds
} from "../src/ui/canvas/agentPen";
import type { LayoutNode, Box } from "../src/layout/types";
import type { PenNode } from "../src/model/types";

function mockBox(x: number, y: number, width: number, height: number): Box {
  return { x, y, width, height };
}

function mockLayout(
  id: string,
  box: Box,
  children: LayoutNode[] = []
): LayoutNode {
  return {
    id,
    type: "frame",
    box,
    children
  };
}

describe("Simplified Agent Pen Indicator", () => {
  it("detects changed node IDs across document versions", () => {
    const oldNodes = new Map<string, PenNode>([
      ["n1", { id: "n1", type: "frame", name: "Card", width: 100, height: 100 } as any],
      ["n2", { id: "n2", type: "text", content: "Hello" } as any]
    ]);
    const newNodes = new Map<string, PenNode>([
      ["n1", { id: "n1", type: "frame", name: "Card", width: 120, height: 100 } as any],
      ["n2", { id: "n2", type: "text", content: "Hello" } as any],
      ["n3", { id: "n3", type: "icon", icon: "star" } as any]
    ]);

    const changed = diffChangedNodeIds(oldNodes, newNodes);
    expect(changed).toContain("n1");
    expect(changed).toContain("n3");
    expect(changed).not.toContain("n2");
  });

  it("sets and clears active edit target from layout tree", () => {
    const tree: LayoutNode[] = [
      mockLayout("screen1", mockBox(0, 0, 390, 844), [
        mockLayout("card1", mockBox(20, 100, 350, 120))
      ])
    ];

    noteAgentEdits(["card1"], tree);
    const target = activeEditTarget();
    expect(target).not.toBeNull();
    expect(target?.nodeId).toBe("card1");
    expect(target?.box.x).toBe(20);
    expect(target?.box.y).toBe(100);

    clearAgentEditTargets();
    expect(activeEditTarget()).toBeNull();
  });
});
