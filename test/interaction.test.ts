import { describe, it, expect } from "bun:test";
import type { LayoutNode } from "../src/layout/types";
import { createCamera, worldToScreen, screenToWorld, zoomAtScreenPoint, panCamera } from "../src/interaction/camera";
import { hitTestScene, hitTestSceneWorld, nearestFrameHit, worldPointToFrameLocal } from "../src/interaction/hittest";
import { createSelectionState, paintSelectionOverlay } from "../src/interaction/selection";
import { handleDragMove, commitDragDrop, pastDragThreshold, type DragSession } from "../src/interaction/drag";
import { trackLayoutTransitions, hasActiveAnimations, getAnimatedPosition } from "../src/interaction/animate";
import { createHistory, pushDocument, undo, redo } from "../src/model/history";
import { reorderChild } from "../src/model/edit";
import { resolveInstances } from "../src/model/instance";
import { layoutDocument } from "../src/layout/layout";
import { inspectorFields } from "../src/ui/inspector";
import { makeDoc, frame, rect, createMockCanvas, EditorDriver, flattenBoxes } from "./harness";

describe("camera coordinate transformations & zoom anchors", () => {
  it("converts screen-to-world coordinates and preserves zoom anchor invariants", () => {
    const camera = createCamera(100, 50, 2);
    const screenPoint = worldToScreen({ x: 40, y: 30 }, camera);
    expect(screenPoint).toEqual({ x: 180, y: 110 });
    expect(screenToWorld(screenPoint, camera)).toEqual({ x: 40, y: 30 });

    const mouseScreen = { x: 300, y: 200 };
    const zoomed = zoomAtScreenPoint(createCamera(0, 0, 1), mouseScreen, 2.5);
    expect(screenToWorld(mouseScreen, zoomed)).toEqual({ x: 300, y: 200 });

    const panned = panCamera(camera, -20, 30);
    expect(panned.x).toBe(80);
    expect(panned.y).toBe(80);
  });
});

describe("hit testing hierarchy, clipping, rotation & nested frames", () => {
  it("hit-tests scene hierarchy, title zones, and rotated nodes", () => {
    const tree: LayoutNode[] = [{
      id: "parentFrame",
      type: "frame",
      box: { x: 100, y: 100, width: 200, height: 200 },
      children: [{ id: "child1", type: "rectangle", box: { x: 20, y: 20, width: 60, height: 60 }, children: [] }]
    }];
    expect(hitTestScene(tree, { x: 130, y: 130 })?.id).toBe("child1");
    expect(hitTestScene(tree, { x: 110, y: 110 })?.id).toBe("parentFrame");
    expect(hitTestScene(tree, { x: 150, y: 85 })?.id).toBe("parentFrame");
    expect(hitTestScene(tree, { x: 50, y: 50 })).toBeNull();

    // Rotated node (30 deg clockwise)
    const rotTree: LayoutNode[] = [{ id: "rotNode", type: "rectangle", box: { x: 50, y: 50, width: 100, height: 60 }, rotation: 30, children: [] }];
    expect(hitTestScene(rotTree, { x: 78.3, y: 101.0 })?.id).toBe("rotNode");
    expect(hitTestScene(rotTree, { x: 140, y: 60 })).toBeNull();
  });

  it("handles clipping, disabled nodes, and nested rotated frame coordinate resolution", () => {
    const clipTree: LayoutNode[] = [{
      id: "parent",
      type: "frame",
      box: { x: 0, y: 0, width: 80, height: 80 },
      children: [{ id: "overflow", type: "rectangle", box: { x: 100, y: 10, width: 40, height: 40 }, children: [] }]
    }];
    expect(hitTestScene(clipTree, { x: 110, y: 20 }, new Map([["parent", { id: "parent", type: "frame", clip: true }]])) ).toBeNull();
    expect(hitTestScene(clipTree, { x: 110, y: 20 }, new Map([["parent", { id: "parent", type: "frame", clip: false }]]))?.id).toBe("overflow");
    expect(hitTestScene(clipTree, { x: 20, y: 20 }, new Map([["parent", { id: "parent", type: "frame", enabled: false }]])) ).toBeNull();

    // Nested rotated parent coordinate translation
    const rotParent: LayoutNode[] = [{
      id: "parent",
      type: "frame",
      box: { x: 0, y: 0, width: 100, height: 100 },
      rotation: 90,
      children: [{ id: "child", type: "rectangle", box: { x: 10, y: 10, width: 20, height: 20 }, children: [] }]
    }];
    expect(hitTestSceneWorld(rotParent, { x: -20, y: 20 })?.node.id).toBe("child");

    // Nested frame path traversal and world-to-local conversion
    const nestTree: LayoutNode[] = [{
      id: "outer",
      type: "frame",
      box: { x: 0, y: 0, width: 200, height: 200 },
      rotation: 30,
      children: [{
        id: "mid",
        type: "frame",
        box: { x: 100, y: 0, width: 80, height: 80 },
        rotation: 20,
        children: [{ id: "inner", type: "frame", box: { x: 50, y: 0, width: 20, height: 20 }, children: [] }]
      }]
    }];
    const hit = hitTestSceneWorld(nestTree, { x: 117.51, y: 102.39 });
    expect(hit?.node.id).toBe("inner");
    const frameHit = nearestFrameHit(hit!);
    expect(frameHit?.node.id).toBe("inner");
    expect(frameHit?.worldX).toBeCloseTo(118.74, 1);
    expect(frameHit?.worldY).toBeCloseTo(88.30, 1);
    const local = worldPointToFrameLocal({ x: 117.51, y: 102.39 }, frameHit!);
    expect(local.x).toBeCloseTo(10, 1);
    expect(local.y).toBeCloseTo(10, 1);
  });
});

describe("drag thresholds, reparenting & drop targets", () => {
  it("evaluates drag thresholds and commits flex, freeform, and rotated container drops", () => {
    expect(pastDragThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(pastDragThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);

    // 1. Flex container drop
    const flexDoc = makeDoc(frame("parent", 200, 100, [rect("c1", 40, 40), rect("c2", 40, 40)]), rect("loose", 50, 50, { x: 500, y: 500 } as any));
    const flexSession: DragSession = { nodeId: "loose", startWorld: { x: 500, y: 500 }, currentWorld: { x: 50, y: 50 }, initialNodeX: 500, initialNodeY: 500, worldOffset: { x: 500, y: 500 }, dimensions: { width: 50, height: 50 } };
    handleDragMove(flexDoc, flexSession, { x: 50, y: 50 }, [{ id: "parent", type: "frame", box: { x: 0, y: 0, width: 200, height: 100 }, children: [] }]);
    expect(flexSession.targetContainerId).toBe("parent");
    commitDragDrop(flexDoc, flexSession);
    expect(flexDoc.children.length).toBe(1);
    expect((flexDoc.children[0] as any).children.length).toBe(3);

    // 2. Freeform ("none") layout container drop
    const freeDoc = makeDoc(frame("freeFrame", 300, 300, [], { x: 100, y: 100, layout: "none" } as any), rect("item", 40, 40, { x: 0, y: 0 } as any));
    const freeSession: DragSession = { nodeId: "item", startWorld: { x: 0, y: 0 }, currentWorld: { x: 150, y: 120 }, initialNodeX: 0, initialNodeY: 0, worldOffset: { x: 0, y: 0 }, dimensions: { width: 40, height: 40 } };
    handleDragMove(freeDoc, freeSession, { x: 150, y: 120 }, [{ id: "freeFrame", type: "frame", box: { x: 100, y: 100, width: 300, height: 300 }, children: [] }]);
    expect(freeSession.targetContainerId).toBe("freeFrame");
    commitDragDrop(freeDoc, freeSession);
    const droppedItem = (freeDoc.children[0] as any).children[0];
    expect(droppedItem.x).toBe(50);
    expect(droppedItem.y).toBe(20);

    // 3. Rotated container drop
    const rotDoc = makeDoc(frame("rot", 100, 100, [], { x: 0, y: 0, rotation: 90, layout: "none" } as any), rect("pc", 20, 20, { x: 200, y: 200 } as any));
    const rotSession: DragSession = { nodeId: "pc", startWorld: { x: 200, y: 200 }, currentWorld: { x: -60, y: 40 }, initialNodeX: 200, initialNodeY: 200, worldOffset: { x: 200, y: 200 }, dimensions: { width: 20, height: 20 } };
    handleDragMove(rotDoc, rotSession, { x: -60, y: 40 }, [{ id: "rot", type: "frame", box: { x: 0, y: 0, width: 100, height: 100 }, rotation: 90, children: [] }]);
    commitDragDrop(rotDoc, rotSession);
    expect((rotDoc.children[0] as any).children[0].x).toBe(40);
    expect((rotDoc.children[0] as any).children[0].y).toBe(60);
  });
});

describe("history undo/redo, inspector bindings & selection overlays", () => {
  it("tracks history undo/redo stacks, layer ordering, and inspector properties", () => {
    const doc = makeDoc(frame("p", 100, 100, [rect("a"), rect("b")]));
    let hist = createHistory(doc);
    const doc2 = reorderChild(doc, "p", 0, 1);
    hist = pushDocument(hist, doc2);
    expect(undo(hist)!.doc).toEqual(doc);
    expect(redo(undo(hist)!.history)!.doc).toEqual(doc2);

    // Inspector computed dimensions & instance resolution
    const inspDoc = makeDoc(frame("f", 300, 100, [rect("r", "fill_container" as any, 60)], { padding: 20 }));
    const tree: LayoutNode[] = [{ id: "f", type: "frame", box: { x: 0, y: 0, width: 300, height: 100 }, children: [{ id: "r", type: "rectangle", box: { x: 20, y: 20, width: 260, height: 60 }, children: [] }] }];
    expect(inspectorFields(inspDoc, tree, ["r"]).find((f) => f.label === "Width")?.computed).toBe(260);

    const c1: any = { id: "card", type: "frame", width: 200, height: 100, gap: 8, reusable: true, children: [rect("c_r", 50, 50)] };
    const instDoc = makeDoc(c1, { id: "inst1", type: "ref", ref: "card" } as any);
    expect(inspectorFields(resolveInstances(instDoc), layoutDocument(instDoc), ["inst1:c_r"]).find((f) => f.label === "Width")?.computed).toBe(50);

    // Selection overlay painting & animation tracking
    const { ctx, calls } = createMockCanvas();
    const sel = createSelectionState();
    sel.selectedIds.add("node1");
    const node: LayoutNode = { id: "node1", type: "rectangle", box: { x: 10, y: 10, width: 50, height: 50 }, children: [] };
    paintSelectionOverlay(ctx, node, sel.selectedIds, sel.hoveredId);
    expect(calls.some((c) => c.startsWith("strokeRect"))).toBe(true);

    trackLayoutTransitions([node], [{ ...node, box: { x: 30, y: 30, width: 50, height: 50 } }], 200);
    expect(hasActiveAnimations()).toBe(true);
    expect(getAnimatedPosition("node1")).not.toBeNull();
  });
});

describe("end-to-end editor driver reality tests", () => {
  const editorDoc = makeDoc(frame("screen", 1360, 800, [
    frame("jUqCC", "fill_container", 50, [], { name: "Header" })
  ], { padding: 28, layout: "vertical" }));

  it("executes click-selection, inspector property extraction, and canvas viewport rendering", () => {
    const editor = new EditorDriver(editorDoc);
    const { calls: initialCalls } = editor.renderView();
    expect(initialCalls.some((c) => c.startsWith("translate:0,0"))).toBe(true);

    editor.pointerDown(600, 45);
    expect(editor.selectedIds.has("jUqCC")).toBe(true);

    const widthField = editor.getInspector().find((f) => f.label === "Width");
    expect(widthField?.declared).toBe("fill_container");
    expect(widthField?.computed).toBe(1304);

    const { calls: selectionCalls } = editor.renderView();
    expect(selectionCalls.some((c) => c.includes("strokeRect"))).toBe(true);
  });

  it("preserves cursor zoom anchors and simulates full drag-and-drop & Alt-duplicate workflows", () => {
    const editor = new EditorDriver(editorDoc);
    const cursor = { x: 400, y: 300 };
    editor.zoomAt(cursor.x, cursor.y, 3);
    expect(Math.round(screenToWorld(cursor, editor.camera).x)).toBe(cursor.x);
    editor.zoomAt(cursor.x, cursor.y, 1 / 3);
    expect(Math.round(screenToWorld(cursor, editor.camera).x)).toBe(cursor.x);

    // Drag-and-drop reparenting into flex container with undo/redo
    const flexEditor = new EditorDriver(makeDoc(
      frame("artboard", 400, 300, [rect("card1", 100, 50)], { padding: 20, gap: 10, layout: "vertical" }),
      rect("looseWidget", 80, 40, { x: 600, y: 400 } as any)
    ));
    flexEditor.pointerDown(620, 420);
    flexEditor.pointerMove(50, 50);
    flexEditor.pointerUp();
    expect(flexEditor.doc.children.length).toBe(1);
    expect(flattenBoxes(flexEditor.layoutTree).get("looseWidget")?.y).toBe(80);
    flexEditor.undo();
    expect(flexEditor.doc.children.length).toBe(2);

    // Alt-duplicate mid-drag
    const altEditor = new EditorDriver(makeDoc(frame("root", 500, 400, [rect("btn", 100, 40, { x: 20, y: 20 } as any)], { layout: "none" })));
    altEditor.pointerDown(30, 30);
    altEditor.pointerMove(50, 50);
    altEditor.pointerMove(150, 150, { alt: true });
    altEditor.pointerUp();
    expect((altEditor.doc.children[0] as any).children.length).toBe(2);
    altEditor.undo();
    expect((altEditor.doc.children[0] as any).children.length).toBe(1);
  });
});
