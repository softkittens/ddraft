import { describe, it, expect } from "bun:test";
import type { LayoutNode } from "../src/layout/types";

import {
  createCamera,
  worldToScreen,
  screenToWorld,
  zoomAtScreenPoint,
  panCamera
} from "../src/interaction/camera";
import { hitTestScene } from "../src/interaction/hittest";
import { createSelectionState, paintSelectionOverlay } from "../src/interaction/selection";
import { handleDragMove, commitDragDrop, type DragSession } from "../src/interaction/drag";
import { trackLayoutTransitions, hasActiveAnimations, getAnimatedPosition } from "../src/interaction/animate";



describe("Interaction - Camera (D1)", () => {
  it("converts between world and screen coordinates seamlessly", () => {
    const camera = createCamera(100, 50, 2);
    const worldPoint = { x: 40, y: 30 };

    const screenPoint = worldToScreen(worldPoint, camera);
    expect(screenPoint.x).toBe(180);
    expect(screenPoint.y).toBe(110);

    const roundTrip = screenToWorld(screenPoint, camera);
    expect(roundTrip.x).toBe(40);
    expect(roundTrip.y).toBe(30);
  });

  it("keeps the world point under the mouse stationary when zooming", () => {
    const initialCamera = createCamera(0, 0, 1);
    const mouseScreen = { x: 300, y: 200 };

    const worldBefore = screenToWorld(mouseScreen, initialCamera);
    expect(worldBefore.x).toBe(300);
    expect(worldBefore.y).toBe(200);

    const zoomedCamera = zoomAtScreenPoint(initialCamera, mouseScreen, 2.5);
    const worldAfter = screenToWorld(mouseScreen, zoomedCamera);
    expect(worldAfter.x).toBe(worldBefore.x);
    expect(worldAfter.y).toBe(worldBefore.y);
  });

  it("pans camera accurately by delta screen pixels", () => {
    const camera = createCamera(50, 50, 1.5);
    const panned = panCamera(camera, -20, 30);

    expect(panned.x).toBe(30);
    expect(panned.y).toBe(80);
    expect(panned.zoom).toBe(1.5);
  });
});

describe("Interaction - Hit Testing (D2)", () => {
  const tree: LayoutNode[] = [{
    id: "parentFrame",
    type: "frame",
    box: { x: 100, y: 100, width: 200, height: 200 },
    children: [
      { id: "child1", type: "rectangle", box: { x: 20, y: 20, width: 60, height: 60 }, children: [] },
      { id: "child2", type: "rectangle", box: { x: 50, y: 50, width: 60, height: 60 }, children: [] }
    ]
  }];

  it("clicking a child returns the child, not the parent", () => {
    const hit = hitTestScene(tree, { x: 125, y: 125 });
    expect(hit?.id).toBe("child1");
  });

  it("reverse painter order returns top-most later sibling when overlapping", () => {
    const hit = hitTestScene(tree, { x: 160, y: 160 });
    expect(hit?.id).toBe("child2");
  });

  it("clicking the parent background returns the parent", () => {
    const hit = hitTestScene(tree, { x: 105, y: 105 });
    expect(hit?.id).toBe("parentFrame");
  });

  it("clicking a rotated node works in local coordinate space", () => {
    const rotatedTree: LayoutNode[] = [{
      id: "rotNode",
      type: "rectangle",
      box: { x: 100, y: 100, width: 100, height: 50 },
      rotation: 90,
      children: []
    }];

    const hit = hitTestScene(rotatedTree, { x: 120, y: 50 });
    expect(hit?.id).toBe("rotNode");

    const miss = hitTestScene(rotatedTree, { x: 180, y: 180 });
    expect(miss).toBeNull();
  });
});

describe("Interaction - Selection & Dragging (D3)", () => {
  it("manages selection state set", () => {
    const state = createSelectionState();
    expect(state.selectedIds.size).toBe(0);

    state.selectedIds.add("nodeA");
    state.selectedIds.add("nodeB");
    expect(state.selectedIds.has("nodeA")).toBe(true);
    expect(state.selectedIds.has("nodeB")).toBe(true);
    expect(state.selectedIds.size).toBe(2);
  });

  it("applies drag delta to update node coordinates for free nodes", () => {
    const doc: any = {
      version: "2.17",
      children: [{ id: "box1", type: "rectangle", x: 50, y: 80, width: 100, height: 100 }]
    };
    const session: DragSession = {
      nodeId: "box1",
      startWorld: { x: 60, y: 90 },
      currentWorld: { x: 60, y: 90 },
      initialNodeX: 50,
      initialNodeY: 80,
      worldOffset: { x: 50, y: 80 },
      dimensions: { width: 100, height: 100 }
    };

    handleDragMove(doc, session, { x: 85, y: 110 });

    expect(doc.children[0].x).toBe(75);
    expect(doc.children[0].y).toBe(100);
  });

  it("reorders siblings when dragging inside a flex layout container", () => {
    const doc: any = {
      version: "2.17",
      children: [{
        id: "frame1",
        type: "frame",
        layout: "horizontal",
        children: [
          { id: "childA", type: "rectangle", width: 50, height: 50 },
          { id: "childB", type: "rectangle", width: 50, height: 50 }
        ]
      }]
    };

    const session: DragSession = {
      nodeId: "childA",
      startWorld: { x: 0, y: 0 },
      currentWorld: { x: 0, y: 0 },
      initialNodeX: 0,
      initialNodeY: 0,
      worldOffset: { x: 0, y: 0 },
      dimensions: { width: 50, height: 50 }
    };

    const layoutTree = [
      {
        id: "frame1",
        type: "frame" as const,
        box: { x: 0, y: 0, width: 100, height: 50 },
        children: [
          { id: "childA", type: "rectangle" as const, box: { x: 0, y: 0, width: 50, height: 50 }, children: [] },
          { id: "childB", type: "rectangle" as const, box: { x: 50, y: 0, width: 50, height: 50 }, children: [] }
        ]
      }
    ];

    handleDragMove(doc, session, { x: 55, y: 0 }, layoutTree);
    commitDragDrop(doc, session);

    expect(doc.children[0].children[0].id).toBe("childB");
    expect(doc.children[0].children[1].id).toBe("childA");
  });

  it("reparents a child node when dragged into a different container frame", () => {
    const doc: any = {
      version: "2.17",
      children: [
        {
          id: "frameA",
          type: "frame",
          children: [{ id: "item1", type: "rectangle", width: 40, height: 40 }]
        },
        {
          id: "frameB",
          type: "frame",
          children: []
        }
      ]
    };

    const session: DragSession = {
      nodeId: "item1",
      startWorld: { x: 10, y: 10 },
      currentWorld: { x: 10, y: 10 },
      initialNodeX: 0,
      initialNodeY: 0,
      worldOffset: { x: 10, y: 10 },
      dimensions: { width: 40, height: 40 }
    };

    const layoutTree: LayoutNode[] = [
      {
        id: "frameA",
        type: "frame",
        box: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ id: "item1", type: "rectangle", box: { x: 10, y: 10, width: 40, height: 40 }, children: [] }]
      },
      {
        id: "frameB",
        type: "frame",
        box: { x: 150, y: 0, width: 100, height: 100 },
        children: []
      }
    ];

    handleDragMove(doc, session, { x: 180, y: 50 }, layoutTree);
    commitDragDrop(doc, session);

    expect(doc.children[0].children.length).toBe(0);
    expect(doc.children[1].children.length).toBe(1);
    expect(doc.children[1].children[0].id).toBe("item1");
  });



  it("paints selection overlay with handles", () => {
    let strokeRectCalls = 0;
    let fillRectCalls = 0;

    const mockCtx: any = {
      save: () => {},
      translate: () => {},
      rotate: () => {},
      strokeRect: () => { strokeRectCalls++; },
      fillRect: () => { fillRectCalls++; },
      restore: () => {}
    };

    const node: LayoutNode = {
      id: "selNode",
      type: "rectangle",
      box: { x: 10, y: 10, width: 100, height: 50 },
      children: []
    };

    const selected = new Set(["selNode"]);
    paintSelectionOverlay(mockCtx, node, selected, null, 1);

    expect(strokeRectCalls).toBe(5);
    expect(fillRectCalls).toBe(4);
  });

  it("tracks and interpolates layout transitions without recursion error", () => {
    const oldTree: LayoutNode[] = [
      {
        id: "cardA",
        type: "frame",
        box: { x: 0, y: 0, width: 100, height: 100 },
        children: [{ id: "inner", type: "rectangle", box: { x: 10, y: 10, width: 20, height: 20 }, children: [] }]
      }
    ];

    const newTree: LayoutNode[] = [
      {
        id: "cardA",
        type: "frame",
        box: { x: 200, y: 0, width: 100, height: 100 },
        children: [{ id: "inner", type: "rectangle", box: { x: 10, y: 10, width: 20, height: 20 }, children: [] }]
      }
    ];

    trackLayoutTransitions(oldTree, newTree, 200);
    expect(hasActiveAnimations()).toBe(true);

    const pos = getAnimatedPosition("cardA");
    expect(pos).not.toBeNull();
  });
});


