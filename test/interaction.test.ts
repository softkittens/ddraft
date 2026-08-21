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
});

describe("hit testing visibility, clipping, rotation, and insertion", () => {
  it("does not select a disabled node or its children", () => {
    const tree: LayoutNode[] = [{
      id: "parent",
      type: "frame",
      box: { x: 0, y: 0, width: 200, height: 200 },
      children: [{ id: "child", type: "rectangle", box: { x: 10, y: 10, width: 40, height: 40 }, children: [] }]
    }];
    const map = new Map<string, any>([
      ["parent", { id: "parent", type: "frame", enabled: false }],
      ["child", { id: "child", type: "rectangle" }]
    ]);
    expect(hitTestScene(tree, { x: 20, y: 20 }, map)).toBeNull();
  });

  it("does not select children outside a clipped parent", () => {
    const tree: LayoutNode[] = [{
      id: "parent",
      type: "frame",
      box: { x: 0, y: 0, width: 80, height: 80 },
      children: [{ id: "overflow", type: "rectangle", box: { x: 100, y: 10, width: 40, height: 40 }, children: [] }]
    }];
    const map = new Map<string, any>([
      ["parent", { id: "parent", type: "frame", clip: true }],
      ["overflow", { id: "overflow", type: "rectangle" }]
    ]);
    expect(hitTestScene(tree, { x: 110, y: 20 }, map)).toBeNull();
  });

  it("selects children outside an unclipped parent", () => {
    const tree: LayoutNode[] = [{
      id: "parent",
      type: "frame",
      box: { x: 0, y: 0, width: 80, height: 80 },
      children: [{ id: "overflow", type: "rectangle", box: { x: 100, y: 10, width: 40, height: 40 }, children: [] }]
    }];
    const map = new Map<string, any>([
      ["parent", { id: "parent", type: "frame", clip: false }],
      ["overflow", { id: "overflow", type: "rectangle" }]
    ]);
    expect(hitTestScene(tree, { x: 110, y: 20 }, map)?.id).toBe("overflow");
  });

  it("uses transformed local coordinates under a rotated parent", () => {
    const tree: LayoutNode[] = [{
      id: "parent",
      type: "frame",
      box: { x: 0, y: 0, width: 100, height: 100 },
      rotation: 90,
      children: [{ id: "child", type: "rectangle", box: { x: 10, y: 10, width: 20, height: 20 }, children: [] }]
    }];
    // 90° clockwise around parent origin: local (20, 20) → world (20, -20)?
    // Forward: x' = x cos - y sin, y' = x sin + y cos, 90°: x' = -y, y' = x
    // Child local center (20, 20) in parent local → world (-20, 20)
    const hit = hitTestSceneWorld(tree, { x: -20, y: 20 });
    expect(hit?.node.id).toBe("child");
  });

  it("walks the path back to the nearest nested frame for insertion over text", () => {
    const tree: LayoutNode[] = [{
      id: "outer",
      type: "frame",
      box: { x: 0, y: 0, width: 400, height: 400 },
      children: [{
        id: "inner",
        type: "frame",
        box: { x: 40, y: 40, width: 200, height: 200 },
        children: [{ id: "label", type: "text", box: { x: 10, y: 10, width: 80, height: 20 }, children: [] }]
      }]
    }];
    const hit = hitTestSceneWorld(tree, { x: 60, y: 55 });
    expect(hit?.node.id).toBe("label");
    expect(hit?.path.map((n) => n.id)).toEqual(["outer", "inner", "label"]);
    const frameHit = nearestFrameHit(hit!);
    expect(frameHit?.node.id).toBe("inner");
    expect(frameHit?.worldX).toBe(40);
    expect(frameHit?.worldY).toBe(40);
  });

  it("reports local coordinates relative to the hit node's world origin", () => {
    const tree: LayoutNode[] = [{
      id: "frame",
      type: "frame",
      box: { x: 100, y: 50, width: 200, height: 100 },
      children: []
    }];
    const hit = hitTestSceneWorld(tree, { x: 130, y: 70 });
    expect(hit?.node.id).toBe("frame");
    expect(hit?.worldX).toBe(100);
    expect(hit?.worldY).toBe(50);
  });

  it("leaves insertion at the root when no frame is on the path", () => {
    const tree: LayoutNode[] = [{
      id: "shape",
      type: "rectangle",
      box: { x: 0, y: 0, width: 40, height: 40 },
      children: []
    }];
    const hit = hitTestSceneWorld(tree, { x: 10, y: 10 });
    expect(hit?.node.id).toBe("shape");
    expect(nearestFrameHit(hit!)).toBeNull();
  });

  it("reports the world origin of a frame nested under a rotated grandparent", () => {
    const tree: LayoutNode[] = [{
      id: "gp",
      type: "frame",
      box: { x: 0, y: 0, width: 100, height: 100 },
      rotation: 90,
      children: [{
        id: "inner",
        type: "frame",
        box: { x: 10, y: 0, width: 50, height: 50 },
        children: []
      }]
    }];
    const hit = hitTestSceneWorld(tree, { x: -25, y: 35 });
    expect(hit?.node.id).toBe("inner");
    const frameHit = nearestFrameHit(hit!);
    expect(frameHit?.node.id).toBe("inner");
    expect(frameHit?.worldX).toBeCloseTo(0);
    expect(frameHit?.worldY).toBeCloseTo(10);
    const local = worldPointToFrameLocal({ x: -25, y: 35 }, frameHit!);
    expect(local.x).toBeCloseTo(25);
    expect(local.y).toBeCloseTo(25);
  });

  it("accumulates nested rotations when reporting a grandchild frame origin", () => {
    const tree: LayoutNode[] = [{
      id: "outer",
      type: "frame",
      box: { x: 0, y: 0, width: 200, height: 200 },
      rotation: 30,
      children: [{
        id: "mid",
        type: "frame",
        box: { x: 100, y: 0, width: 80, height: 80 },
        rotation: 20,
        children: [{
          id: "inner",
          type: "frame",
          box: { x: 50, y: 0, width: 20, height: 20 },
          children: []
        }]
      }]
    }];
    const hit = hitTestSceneWorld(tree, { x: 117.51, y: 102.39 });
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

describe("Interaction & Editor Subsystem (continued)", () => {


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

    const rotatedDoc = makeDoc(
      frame("rotated", 100, 100, [], { x: 0, y: 0, rotation: 90, layout: "none" } as any),
      rect("piece", 20, 20, { x: 200, y: 200 } as any)
    );
    const rotatedTree: LayoutNode[] = [
      { id: "rotated", type: "frame", box: { x: 0, y: 0, width: 100, height: 100 }, rotation: 90, children: [] },
      { id: "piece", type: "rectangle", box: { x: 200, y: 200, width: 20, height: 20 }, children: [] }
    ];
    const rotatedSession: DragSession = {
      nodeId: "piece",
      startWorld: { x: 200, y: 200 },
      currentWorld: { x: -60, y: 40 },
      initialNodeX: 200,
      initialNodeY: 200,
      worldOffset: { x: 200, y: 200 },
      dimensions: { width: 20, height: 20 }
    };
    handleDragMove(rotatedDoc, rotatedSession, { x: -60, y: 40 }, rotatedTree);
    expect(rotatedSession.targetContainerId).toBe("rotated");
    commitDragDrop(rotatedDoc, rotatedSession);
    const rotatedDrop = (rotatedDoc.children[0] as any).children[0];
    expect(rotatedDrop.x).toBe(40);
    expect(rotatedDrop.y).toBe(60);
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
  const editorDoc = makeDoc(frame("screen", 1360, 800, [
    frame("jUqCC", "fill_container", 50, [], { name: "Header" })
  ], { padding: 28, layout: "vertical" }));

  it("executes full click-selection, inspector property binding, and canvas rendering", () => {
    const editor = new EditorDriver(editorDoc);

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
    const editor = new EditorDriver(editorDoc);
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
