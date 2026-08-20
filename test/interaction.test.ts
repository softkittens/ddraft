import { describe, it, expect } from "bun:test";
import type { LayoutNode } from "../src/layout/types";
import { createCamera, worldToScreen, screenToWorld, zoomAtScreenPoint, panCamera } from "../src/interaction/camera";
import { hitTestScene } from "../src/interaction/hittest";
import { createSelectionState, paintSelectionOverlay } from "../src/interaction/selection";
import { handleDragMove, commitDragDrop, pastDragThreshold, type DragSession } from "../src/interaction/drag";
import { trackLayoutTransitions, hasActiveAnimations, getAnimatedPosition } from "../src/interaction/animate";
import { createHistory, pushDocument, undo, redo } from "../src/model/history";
import { reorderChild } from "../src/model/edit";
import { resolveInstances } from "../src/model/instance";
import { layoutDocument } from "../src/layout/layout";
import { inspectorFields } from "../src/ui/inspector";
import { makeDoc, frame, rect, createMockCanvas, EditorDriver, flattenBoxes } from "./harness";
import { FIXTURES } from "../src/ui/fixtures";


describe("Interaction & Editor Subsystem", () => {
  it("converts coordinates and handles zoom/pan transformations", () => {
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

  it("hit-tests scene hierarchy and frame labels accurately", () => {
    const tree: LayoutNode[] = [{
      id: "parentFrame",
      type: "frame",
      box: { x: 100, y: 100, width: 200, height: 200 },
      children: [
        { id: "child1", type: "rectangle", box: { x: 20, y: 20, width: 60, height: 60 }, children: [] }
      ]
    }];

    expect(hitTestScene(tree, { x: 130, y: 130 })?.id).toBe("child1");
    expect(hitTestScene(tree, { x: 110, y: 110 })?.id).toBe("parentFrame");
    expect(hitTestScene(tree, { x: 150, y: 85 })?.id).toBe("parentFrame"); // Header label hit zone
    expect(hitTestScene(tree, { x: 50, y: 50 })).toBeNull();

    // Rotated node hit-testing (30 deg clockwise around top-left (50, 50))
    const rotTree: LayoutNode[] = [{
      id: "rotNode",
      type: "rectangle",
      box: { x: 50, y: 50, width: 100, height: 60 },
      rotation: 30,
      children: []
    }];
    // Visual center: x ≈ 78.3, y ≈ 101.0
    expect(hitTestScene(rotTree, { x: 78.3, y: 101.0 })?.id).toBe("rotNode");
    // Point inside unrotated box (140, 60) is outside the 30-deg rotated geometry
    expect(hitTestScene(rotTree, { x: 140, y: 60 })).toBeNull();
  });


  it("handles drag threshold, sibling reordering, and canvas reparenting", () => {
    expect(pastDragThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(pastDragThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);

    const doc = makeDoc(
      frame("parent", 200, 100, [rect("c1", 40, 40), rect("c2", 40, 40)]),
      rect("loose", 50, 50, { x: 500, y: 500 } as any)
    );

    const session: DragSession = {
      nodeId: "loose",
      startWorld: { x: 500, y: 500 },
      currentWorld: { x: 50, y: 50 },
      initialNodeX: 500,
      initialNodeY: 500,
      worldOffset: { x: 500, y: 500 },
      dimensions: { width: 50, height: 50 }
    };

    const tree: LayoutNode[] = [
      { id: "parent", type: "frame", box: { x: 0, y: 0, width: 200, height: 100 }, children: [] },
      { id: "loose", type: "rectangle", box: { x: 500, y: 500, width: 50, height: 50 }, children: [] }
    ];

    handleDragMove(doc, session, { x: 50, y: 50 }, tree);
    expect(session.targetContainerId).toBe("parent");

    commitDragDrop(doc, session);
    expect(doc.children.length).toBe(1);
    expect((doc.children[0] as any).children.length).toBe(3);
    expect((doc.children[0] as any).children[2].x).toBeUndefined();

    // Freeform layout: "none" frame drop preserves coordinates relative to container
    const freeformDoc = makeDoc(
      frame("freeFrame", 300, 300, [], { x: 100, y: 100, layout: "none" } as any),
      rect("item", 40, 40, { x: 0, y: 0 } as any)
    );
    const freeTree: LayoutNode[] = [
      { id: "freeFrame", type: "frame", box: { x: 100, y: 100, width: 300, height: 300 }, children: [] },
      { id: "item", type: "rectangle", box: { x: 0, y: 0, width: 40, height: 40 }, children: [] }
    ];
    const freeSession: DragSession = {
      nodeId: "item",
      startWorld: { x: 0, y: 0 },
      currentWorld: { x: 150, y: 120 },
      initialNodeX: 0,
      initialNodeY: 0,
      worldOffset: { x: 0, y: 0 },
      dimensions: { width: 40, height: 40 }
    };
    handleDragMove(freeformDoc, freeSession, { x: 150, y: 120 }, freeTree);
    expect(freeSession.targetContainerId).toBe("freeFrame");
    expect(freeSession.insertIndex).toBeUndefined();
    expect(freeSession.dropIndicator).toBeUndefined();

    commitDragDrop(freeformDoc, freeSession);
    const droppedItem = (freeformDoc.children[0] as any).children[0];
    expect(droppedItem.x).toBe(50);
    expect(droppedItem.y).toBe(20);
  });

  it("manages undo/redo history and layer reordering", () => {
    const doc = makeDoc(frame("p", 100, 100, [rect("a"), rect("b")]));
    let hist = createHistory(doc);
    const doc2 = reorderChild(doc, "p", 0, 1);
    hist = pushDocument(hist, doc2);

    expect(undo(hist)!.doc).toEqual(doc);
    expect(redo(undo(hist)!.history)!.doc).toEqual(doc2);
  });

  it("extracts inspector fields for selected nodes and instance subtrees", () => {
    const doc = makeDoc(frame("f", 300, 100, [rect("r", "fill_container" as any, 60)], { padding: 20 }));
    const tree: LayoutNode[] = [{
      id: "f",
      type: "frame",
      box: { x: 0, y: 0, width: 300, height: 100 },
      children: [{ id: "r", type: "rectangle", box: { x: 20, y: 20, width: 260, height: 60 }, children: [] }]
    }];

    const fields = inspectorFields(doc, tree, ["r"]);
    expect(fields.find((f) => f.label === "Width")?.computed).toBe(260);

    // Inspecting a node inside an instance resolved document
    const c1: any = { id: "card", type: "frame", width: 200, height: 100, gap: 8, reusable: true, children: [rect("c_r", 50, 50)] };
    const instDoc = makeDoc(c1, { id: "inst1", type: "ref", ref: "card" } as any);
    const resolved = resolveInstances(instDoc);
    const resolvedTree = layoutDocument(instDoc);

    const instFields = inspectorFields(resolved, resolvedTree, ["inst1:c_r"]);
    expect(instFields.find((f) => f.label === "Width")?.computed).toBe(50);
  });


  it("paints selection overlay and tracks smooth layout transitions", () => {
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

describe("End-to-End Editor Integration Reality Tests", () => {
  it("executes full click-selection, inspector property binding, and canvas rendering on Factory Control fixture", () => {
    const editor = new EditorDriver(FIXTURES.A_control_r1.raw);

    // Initial render pass
    const { calls: initialCalls } = editor.renderView();
    expect(initialCalls.some((c) => c.startsWith("translate:0,0"))).toBe(true);
    expect(initialCalls.some((c) => c.startsWith("scale:1,1"))).toBe(true);

    // User clicks at screen coordinate (600, 45) inside the Factory Control Header (jUqCC)
    editor.pointerDown(600, 45);
    expect(editor.selectedIds.has("jUqCC")).toBe(true);

    // Inspector extracts declared vs computed flex dimensions directly from the live document & layout
    const fields = editor.getInspector();
    const widthField = fields.find((f) => f.label === "Width");
    expect(widthField?.declared).toBe("fill_container");
    expect(widthField?.computed).toBe(1304); // 1360 frame width - 28*2 padding

    // Render pass draws blue selection overlay around selected node
    const { calls: selectionCalls } = editor.renderView();
    expect(selectionCalls.some((c) => c.includes("strokeRect"))).toBe(true);
  });

  it("maintains invariant zoom anchors under cursor during zoom-in and zoom-out passes", () => {
    const editor = new EditorDriver(FIXTURES.A_control_r1.raw);
    const cursor = { x: 400, y: 300 };

    // Zoom in 3x
    editor.zoomAt(cursor.x, cursor.y, 3);
    const worldIn = screenToWorld(cursor, editor.camera);
    expect(Math.round(worldIn.x)).toBe(cursor.x);
    expect(Math.round(worldIn.y)).toBe(cursor.y);

    // Zoom out 0.33x back to original
    editor.zoomAt(cursor.x, cursor.y, 1 / 3);
    const worldOut = screenToWorld(cursor, editor.camera);
    expect(Math.round(worldOut.x)).toBe(cursor.x);
    expect(Math.round(worldOut.y)).toBe(cursor.y);

    // Verify viewport canvas transformation matrix matches camera without double-multiplication
    const { calls } = editor.renderView();
    expect(calls[0]).toBe(`translate:${Math.round(editor.camera.x)},${Math.round(editor.camera.y)}`);
    expect(calls[1]).toBe(`scale:${Math.round(editor.camera.zoom)},${Math.round(editor.camera.zoom)}`);
  });

  it("simulates full drag-and-drop reparenting into flex container with undo/redo", () => {
    const editor = new EditorDriver(makeDoc(
      frame("artboard", 400, 300, [rect("card1", 100, 50)], { padding: 20, gap: 10, layout: "vertical" }),
      rect("looseWidget", 80, 40, { x: 600, y: 400 } as any)
    ));

    expect(editor.doc.children.length).toBe(2);

    // 1. Mouse down on loose widget
    editor.pointerDown(620, 420);
    // 2. Drag past threshold into artboard flex container
    editor.pointerMove(650, 450);
    editor.pointerMove(50, 50);
    // 3. Release mouse to commit drop
    editor.pointerUp();

    // Widget is reparented into artboard flex children
    expect(editor.doc.children.length).toBe(1);
    const artboardChildren = (editor.doc.children[0] as any).children;
    expect(artboardChildren.length).toBe(2);
    expect(artboardChildren[1].id).toBe("looseWidget");

    // Layout tree automatically positions widget inside flex flow with gap
    const boxes = flattenBoxes(editor.layoutTree);
    expect(boxes.get("looseWidget")?.y).toBe(80); // 20 pad + 50 card1 + 10 gap

    // 4. Undo restores initial state
    editor.undo();
    expect(editor.doc.children.length).toBe(2);
    expect(editor.doc.children.some((c) => c.id === "looseWidget")).toBe(true);
  });

  it("simulates Alt-duplicate gesture mid-drag creating clone at drop target", () => {
    const editor = new EditorDriver(makeDoc(
      frame("root", 500, 400, [rect("btn", 100, 40, { x: 20, y: 20 } as any)], { layout: "none" })
    ));

    // 1. Mouse down on button
    editor.pointerDown(30, 30);
    // 2. Drag 100px away with Alt key held
    editor.pointerMove(50, 50);
    editor.pointerMove(150, 150, { alt: true });
    // 3. Mouse up commits clone
    editor.pointerUp();

    const rootChildren = (editor.doc.children[0] as any).children;
    expect(rootChildren.length).toBe(2);
    expect(rootChildren.some((c: any) => c.id === "btn")).toBe(true);
    expect(rootChildren.some((c: any) => c.id !== "btn")).toBe(true);

    // Undo removes clone
    editor.undo();
    expect((editor.doc.children[0] as any).children.length).toBe(1);
  });
});
