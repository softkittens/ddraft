import { describe, it, expect, beforeEach } from "bun:test";
import {
  workingFrameIds,
  noteAgentEdits,
  clearAgentEditTargets,
  diffChangedNodeIds,
  findRootFrameId
} from "../src/ui/canvas/workingFrames";
import type { LayoutNode, Box } from "../src/layout/types";
import type { PenNode } from "../src/model/types";

function mockBox(x: number, y: number, width: number, height: number): Box {
  return { x, y, width, height };
}

function mockLayout(id: string, box: Box, children: LayoutNode[] = []): LayoutNode {
  return {
    id,
    type: "frame",
    box,
    children
  };
}

const tree: LayoutNode[] = [
  mockLayout("screen1", mockBox(0, 0, 390, 844), [
    mockLayout("card1", mockBox(20, 100, 350, 120), [
      mockLayout("title1", mockBox(12, 16, 200, 24))
    ])
  ]),
  mockLayout("screen2", mockBox(460, 0, 390, 844), [
    mockLayout("card2", mockBox(20, 80, 350, 80))
  ])
];

describe("Working frames", () => {
  beforeEach(() => {
    clearAgentEditTargets();
  });

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

  it("walks nested edits up to the canvas root frame", () => {
    expect(findRootFrameId(tree, "title1")).toBe("screen1");
    expect(findRootFrameId(tree, "card2")).toBe("screen2");
    expect(findRootFrameId(tree, "screen1")).toBe("screen1");
    expect(findRootFrameId(tree, "missing")).toBeNull();
  });

  it("lights the root frame of the edited node", () => {
    noteAgentEdits(["title1"], tree);
    expect(workingFrameIds()).toEqual(["screen1"]);

    noteAgentEdits(["card2"], tree);
    expect(workingFrameIds()).toEqual(["screen2"]);

    clearAgentEditTargets();
    expect(workingFrameIds()).toEqual([]);
  });
});
