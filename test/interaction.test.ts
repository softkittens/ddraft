import { describe, it, expect } from "bun:test";
import type { LayoutNode } from "../src/layout/types";
import type { PenNode } from "../src/model/types";
import { createCamera, worldToScreen, screenToWorld, zoomAtScreenPoint, panCamera, calculateFitCamera, applyWheelToCamera } from "../src/interaction/camera";
import { hitTestScene, hitTestSceneWorld, nearestFrameHit, worldPointToFrameLocal, findNodesInMarquee, findNodeWorldBox } from "../src/interaction/hittest";
import { createSelectionState, paintSelectionOverlay, getComponentKind } from "../src/interaction/selection";
import { handleDragMove, commitDragDrop, pastDragThreshold, computeSmartGuides, type DragSession } from "../src/interaction/drag";
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

  it("applies the tuned trackpad pan and pinch multipliers", () => {
    const panned = applyWheelToCamera(createCamera(10, 20, 1), { x: 0, y: 0 }, 40, -12, false);
    expect(panned).toEqual({ x: -54, y: 39.2, zoom: 1 });

    const cursor = { x: 100, y: 80 };
    const pinched = applyWheelToCamera(createCamera(), cursor, 0, 200, true);
    expect(pinched.zoom).toBeCloseTo(Math.exp(-2.8));
    expect(screenToWorld(cursor, pinched).x).toBeCloseTo(100);
    expect(screenToWorld(cursor, pinched).y).toBeCloseTo(80);
  });

  it("normalizes line-wheel deltas before applying the pan multiplier", () => {
    const lineWheel = applyWheelToCamera(createCamera(), { x: 0, y: 0 }, 1, -2, false, 1);
    expect(lineWheel).toEqual({ x: -32, y: 64, zoom: 1 });
  });

  it("calculates camera fitting multi-screen content bounds with viewport paddings", () => {
    // Desktop (1440x900 at 0,0) and Mobile (390x844 at 1540,0) -> total width: 1930, height: 900
    const content = { x: 0, y: 0, width: 1930, height: 900 };
    const viewport = {
      width: 1600,
      height: 900,
      leftPadding: 420,
      rightPadding: 60,
      topPadding: 70,
      bottomPadding: 60
    };

    const fit = calculateFitCamera(content, viewport);
    expect(fit.zoom).toBeLessThan(1.0);
    expect(fit.zoom).toBeGreaterThan(0.5);

    // Center of content should map to center of available viewport
    const contentCenterX = content.x + content.width / 2;
    const contentCenterY = content.y + content.height / 2;
    const screenCenter = worldToScreen({ x: contentCenterX, y: contentCenterY }, fit);

    const availableCenterX = viewport.leftPadding + (viewport.width - viewport.leftPadding - viewport.rightPadding) / 2;
    const availableCenterY = viewport.topPadding + (viewport.height - viewport.topPadding - viewport.bottomPadding) / 2;

    expect(Math.round(screenCenter.x)).toBe(Math.round(availableCenterX));
    expect(Math.round(screenCenter.y)).toBe(Math.round(availableCenterY));
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

    // Dragging a fill_container child out to canvas preserves its concrete width & height
    const heroDoc = makeDoc(
      frame("screen", 390, 844, [
        frame("hero_img", "fill_container", 380, [], { fill: { type: "image", url: "cat.jpg" } })
      ], { layout: "vertical" })
    );
    const heroEditor = new EditorDriver(heroDoc);
    heroEditor.pointerDown(100, 100);
    heroEditor.pointerMove(600, 200);
    heroEditor.pointerUp();
    expect(heroEditor.doc.children.length).toBe(2);
    const movedHero = heroEditor.doc.children.find((c) => c.id === "hero_img");
    expect(movedHero?.width).toBe(390);
    expect(movedHero?.height).toBe(380);
    expect(flattenBoxes(heroEditor.layoutTree).get("hero_img")?.width).toBe(390);
    expect(flattenBoxes(heroEditor.layoutTree).get("hero_img")?.height).toBe(380);
  });

  it("finds intersecting nodes with marquee bounding box on canvas and inside containers", () => {
    const sceneTree: LayoutNode[] = [
      { id: "screen1", type: "frame", box: { x: 0, y: 0, width: 300, height: 600 }, children: [] },
      { id: "screen2", type: "frame", box: { x: 400, y: 0, width: 300, height: 600 }, children: [] },
      {
        id: "screen3",
        type: "frame",
        box: { x: 800, y: 0, width: 400, height: 600 },
        children: [
          { id: "cardA", type: "rectangle", box: { x: 20, y: 20, width: 100, height: 100 }, children: [] },
          { id: "cardB", type: "rectangle", box: { x: 20, y: 150, width: 100, height: 100 }, children: [] }
        ]
      }
    ];

    // Marquee spanning across screen1 and screen2
    const m1 = { x: 100, y: 100, width: 400, height: 200 };
    expect(findNodesInMarquee(sceneTree, m1)).toEqual(["screen1", "screen2"]);

    // Marquee completely inside screen3 selecting cardA
    const m2 = { x: 810, y: 10, width: 120, height: 120 };
    expect(findNodesInMarquee(sceneTree, m2)).toEqual(["cardA"]);

    // Marquee touching nothing
    const m3 = { x: 310, y: 700, width: 50, height: 50 };
    expect(findNodesInMarquee(sceneTree, m3)).toEqual([]);
  });

  it("computes Figma-style smart alignment reference guides and snap offsets", () => {
    const layoutTree: LayoutNode[] = [
      { id: "screen1", type: "frame", box: { x: 0, y: 0, width: 390, height: 844 }, children: [] },
      { id: "screen2", type: "frame", box: { x: 450, y: 0, width: 390, height: 844 }, children: [] }
    ];

    const session: DragSession = {
      nodeId: "screen2",
      startWorld: { x: 450, y: 0 },
      currentWorld: { x: 452, y: 3 }, // 2px offset on X, 3px offset on Y
      initialNodeX: 450,
      initialNodeY: 0,
      worldOffset: { x: 450, y: 0 },
      dimensions: { width: 390, height: 844 }
    };

    // When dragged within snap threshold of Y=0
    const snap = computeSmartGuides(layoutTree, session, 2, 3, 1);
    expect(snap.snapDy).toBe(-3); // Snaps Y back by -3 to align with screen1 top at Y=0
    const hGuide = snap.guides.find((g) => g.type === "horizontal" && g.position === 0);
    expect(hGuide).toBeDefined();
    expect(hGuide?.points).toBeDefined();
    expect(hGuide?.points?.length).toBeGreaterThan(0);

    // When dragged far outside snap threshold (> 6px)
    const farSnap = computeSmartGuides(layoutTree, session, 20, 50, 1);
    expect(farSnap.snapDx).toBe(0);
    expect(farSnap.snapDy).toBe(0);
    expect(farSnap.guides.length).toBe(0);
  });

  it("snaps to equal distance gaps between sibling elements and generates distance guides", () => {
    // 3 screens: Screen 1 at [0, 390], Screen 3 at [836, 1226]
    // Space between 1 and 3 = 836 - 390 = 446.
    // Screen 2 width = 390. Equal gap on both sides = (446 - 390) / 2 = 28.
    // Target X = 390 + 28 = 418.
    const layoutTree: LayoutNode[] = [
      { id: "screen1", type: "frame", box: { x: 0, y: 0, width: 390, height: 844 }, children: [] },
      { id: "screen2", type: "frame", box: { x: 420, y: 0, width: 390, height: 844 }, children: [] },
      { id: "screen3", type: "frame", box: { x: 836, y: 0, width: 390, height: 844 }, children: [] }
    ];

    const session: DragSession = {
      nodeId: "screen2",
      startWorld: { x: 418, y: 0 },
      currentWorld: { x: 420, y: 0 }, // 2px away from equal gap target at 418
      initialNodeX: 418,
      initialNodeY: 0,
      worldOffset: { x: 418, y: 0 },
      dimensions: { width: 390, height: 844 }
    };

    const snap = computeSmartGuides(layoutTree, session, 2, 0, 1);
    expect(snap.snapDx).toBe(-2); // Snaps back by 2 to achieve exact 28px gap
    expect(snap.distanceGuides).toBeDefined();
    expect(snap.distanceGuides?.length).toBe(2);
    expect(snap.distanceGuides?.[0].distance).toBe(28);
    expect(snap.distanceGuides?.[1].distance).toBe(28);
  });

  it("snaps to match sequence continuation gaps after an established sibling pair", () => {
    // Screen 1: [0, 390], Screen 2: [430, 820] -> gap = 40px
    // Dragging Screen 3 (width 390) near x=862 (target: 820 + 40 = 860)
    const layoutTree: LayoutNode[] = [
      { id: "screen1", type: "frame", box: { x: 0, y: 0, width: 390, height: 844 }, children: [] },
      { id: "screen2", type: "frame", box: { x: 430, y: 0, width: 390, height: 844 }, children: [] },
      { id: "screen3", type: "frame", box: { x: 862, y: 0, width: 390, height: 844 }, children: [] }
    ];

    const session: DragSession = {
      nodeId: "screen3",
      startWorld: { x: 860, y: 0 },
      currentWorld: { x: 862, y: 0 },
      initialNodeX: 860,
      initialNodeY: 0,
      worldOffset: { x: 860, y: 0 },
      dimensions: { width: 390, height: 844 }
    };

    const snap = computeSmartGuides(layoutTree, session, 2, 0, 1);
    expect(snap.snapDx).toBe(-2);
    expect(snap.distanceGuides).toBeDefined();
    expect(snap.distanceGuides?.length).toBe(2);
    expect(snap.distanceGuides?.[0].distance).toBe(40);
    expect(snap.distanceGuides?.[1].distance).toBe(40);
  });

  it("computes exact world bounds for deeply nested text nodes and allows content editing", () => {
    const tree: LayoutNode[] = [
      {
        id: "screen",
        type: "frame",
        box: { x: 100, y: 50, width: 390, height: 844 },
        children: [
          {
            id: "card",
            type: "frame",
            box: { x: 20, y: 30, width: 350, height: 200 },
            children: [
              { id: "heading", type: "text", box: { x: 16, y: 12, width: 200, height: 24 }, children: [] }
            ]
          }
        ]
      }
    ];

    const worldBox = findNodeWorldBox(tree, "heading");
    expect(worldBox).toEqual({
      x: 100 + 20 + 16,
      y: 50 + 30 + 12,
      width: 200,
      height: 24
    });
  });

  it("differentiates components (solid purple), instances (dashed purple), and regular nodes (blue)", () => {
    const nodeMap = new Map<string, any>([
      ["btn_master", { id: "btn_master", type: "frame", reusable: true }],
      ["btn_comp", { id: "btn_comp", type: "component" }],
      ["btn_ref", { id: "btn_ref", type: "ref", ref: "btn_master" }],
      ["btn_inst", { id: "btn_inst", type: "instance" }],
      ["btn_ref:icon", { id: "btn_ref:icon", type: "icon" }],
      ["normal_frame", { id: "normal_frame", type: "frame" }]
    ]);

    expect(getComponentKind("btn_master", nodeMap)).toBe("component");
    expect(getComponentKind("btn_comp", nodeMap)).toBe("component");
    expect(getComponentKind("btn_ref", nodeMap)).toBe("instance");
    expect(getComponentKind("btn_inst", nodeMap)).toBe("instance");
    expect(getComponentKind("btn_ref:icon", nodeMap)).toBe("instance");
    expect(getComponentKind("normal_frame", nodeMap)).toBe("regular");

    // Canvas mock verification
    const { ctx, calls } = createMockCanvas();
    const lNode: LayoutNode = { id: "btn_ref", type: "frame", box: { x: 0, y: 0, width: 100, height: 40 }, children: [] };
    paintSelectionOverlay(ctx, lNode, new Set(["btn_ref"]), null, 1, nodeMap);

    // Verify purple stroke and dashed line
    expect(calls.some((c) => c.includes("strokeStyle=#7b61ff"))).toBe(true);
    expect(calls.some((c) => c.startsWith("setLineDash") && c.includes("4"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Smart guides: the Figma behaviours the first pass did not have
 * ------------------------------------------------------------------ */

describe("smart guides behave the way Figma's do", () => {
  const N = (id: string, x: number, y: number, w: number, h: number, kids: LayoutNode[] = []): LayoutNode =>
    ({ id, type: "frame", box: { x, y, width: w, height: h }, children: kids } as LayoutNode);

  const session = (id: string, x: number, y: number, w: number, h: number): DragSession => ({
    nodeId: id,
    startWorld: { x, y },
    currentWorld: { x, y },
    initialNodeX: x,
    initialNodeY: y,
    worldOffset: { x, y },
    dimensions: { width: w, height: h }
  });

  it("snaps both axes at once instead of picking one", () => {
    // A node 2px off a corner on both axes. The axis that lost used to be held
    // to a 2px radius instead of 6 whenever the two distances were comparable,
    // which included dx = dy = 0 — nudging a node that is already placed.
    const tree = [N("t", 100, 100, 200, 200), N("m", 98, 98, 50, 50)];
    const snap = computeSmartGuides(tree, session("m", 98, 98, 50, 50), 0, 0, 1);

    expect(snap.snapDx).toBe(2);
    expect(snap.snapDy).toBe(2);
    expect(snap.guides.filter((g) => g.type === "vertical").length).toBeGreaterThan(0);
    expect(snap.guides.filter((g) => g.type === "horizontal").length).toBeGreaterThan(0);
  });

  it("keeps snapping the axis it is being dragged along", () => {
    // Dragged 295px down; X happens to be 1px from an alignment and Y is 5px
    // from one. The nearer X match used to disqualify the Y snap outright.
    const tree = [N("t", 100, 100, 200, 200), N("m", 101, 400, 50, 50)];
    const snap = computeSmartGuides(tree, session("m", 101, 400, 50, 50), 0, -295, 1);

    expect(snap.snapDx).toBe(-1);
    expect(snap.snapDy).toBe(-5);
  });

  it("snaps an edge to a target's centre, not only edge to edge", () => {
    // Centring a button on the frame behind it: the button's own centre against
    // the parent's. Four of the nine edge pairings were missing, this among them.
    const tree = [N("screen", 0, 0, 390, 844, [N("btn", 140, 700, 120, 48)])];
    const snap = computeSmartGuides(tree, session("btn", 140, 700, 120, 48), 0, 0, 1);

    expect(snap.snapDx).toBe(-5);
    expect(snap.guides.some((g) => g.type === "vertical" && g.position === 195)).toBe(true);
  });

  it("does not offer a node inside another frame as a snap target", () => {
    const tree = [
      N("screen1", 0, 0, 390, 844, [N("card", 20, 300, 100, 60)]),
      N("screen2", 900, 0, 390, 844, [N("far", 24, 500, 100, 60)])
    ];
    // Dragged 900px right, which lands "card" 4px from screen2's child.
    const snap = computeSmartGuides(tree, session("card", 20, 300, 100, 60), 900, 0, 1);

    expect(snap.snapDx).toBe(0);
    expect(snap.guides).toHaveLength(0);
  });

  it("draws every alignment one movement satisfies", () => {
    // Same width, so landing on the left edge lands on the centre and the right
    // edge too. All three are true and Figma shows all three.
    const tree = [N("a", 100, 0, 80, 40), N("b", 100, 100, 80, 40), N("c", 100, 200, 80, 40), N("m", 102, 320, 80, 40)];
    const snap = computeSmartGuides(tree, session("m", 102, 320, 80, 40), 0, 0, 1);

    expect(snap.snapDx).toBe(-2);
    const positions = snap.guides.filter((g) => g.type === "vertical").map((g) => g.position).sort((p, q) => p - q);
    expect(positions).toEqual([100, 140, 180]);
  });

  it("runs the guide through every element the alignment is true of", () => {
    const tree = [N("a", 100, 0, 80, 40), N("b", 100, 100, 80, 40), N("c", 100, 200, 80, 40), N("m", 102, 320, 80, 40)];
    const snap = computeSmartGuides(tree, session("m", 102, 320, 80, 40), 0, 0, 1);
    const left = snap.guides.find((g) => g.position === 100)!;

    // Spans the topmost target to the bottom of the moving node, with a mark on
    // each edge it passes through rather than on whichever target came first.
    expect(left.start).toBe(0);
    expect(left.end).toBe(360);
    expect(left.points).toEqual([0, 40, 100, 140, 200, 240, 320, 360]);
  });

  it("suspends snapping while the modifier is held", () => {
    const tree = [N("t", 100, 100, 200, 200), N("m", 98, 98, 50, 50)];
    const held: DragSession = { ...session("m", 98, 98, 50, 50), snapDisabled: true };
    const snap = computeSmartGuides(tree, held, 0, 0, 1);

    expect(snap.snapDx).toBe(0);
    expect(snap.snapDy).toBe(0);
    expect(snap.guides).toHaveLength(0);
  });

  it("measures a row by overlap, not by matching top edges", () => {
    // A 24px chip centred beside 200px cards. Comparing top edges called them
    // different rows, so the spacing this rule exists for was never offered.
    const tree = [N("card", 0, 0, 160, 200), N("card2", 260, 0, 160, 200), N("chip", 192, 88, 40, 24)];
    const snap = computeSmartGuides(tree, session("chip", 192, 88, 40, 24), 0, 0, 1);

    expect(snap.snapDx).toBe(-2);
    expect(snap.distanceGuides?.map((g) => g.distance)).toEqual([30, 30]);
  });

  it("leaves a snapped node exactly on the guide instead of rounding it off", () => {
    // The frame sits on a half pixel, so the snapped local x is fractional.
    // Rounding it put the edge back off the line the guide was drawn on.
    const doc = makeDoc(frame("screen", 400, 400, [
      frame("a", 80, 40, [], { x: 20.5, y: 0, layoutPosition: "absolute" }),
      frame("m", 80, 40, [], { x: 24, y: 200, layoutPosition: "absolute" })
    ], { layout: "none" }));
    const tree = layoutDocument(doc);
    const drag: DragSession = session("m", 24, 200, 80, 40);

    handleDragMove(doc, drag, { x: 24, y: 200 }, tree, undefined, 1);
    const moved = doc.children[0].children!.find((n: PenNode) => n.id === "m") as any;

    expect(drag.snapOffset?.x).toBeCloseTo(-3.5, 5);
    expect(moved.x).toBeCloseTo(20.5, 5);
  });
});

describe("smart guides inside a frame, which is where design actually happens", () => {
  const build = () =>
    makeDoc(frame("screen", 390, 844, [
      frame("card", 300, 120, [], { x: 20, y: 100, layoutPosition: "absolute" }),
      frame("moving", 300, 120, [], { x: 24, y: 300, layoutPosition: "absolute" })
    ], { layout: "none", x: 0, y: 0 }));

  const dragSession = (x: number, y: number): DragSession => ({
    nodeId: "moving",
    startWorld: { x, y },
    currentWorld: { x, y },
    initialNodeX: x,
    initialNodeY: y,
    worldOffset: { x, y },
    dimensions: { width: 300, height: 120 }
  });

  it("produces guides for a node dragged inside a layout:none frame", () => {
    // handleDragMove used to return the moment the pointer was over a frame
    // that positions its children by hand, so nothing inside one ever snapped.
    const doc = build();
    const tree = layoutDocument(doc);
    const session = dragSession(24, 300);

    handleDragMove(doc, session, { x: 24, y: 300 }, tree, undefined, 1);

    expect(session.snapOffset).toBeDefined();
    expect(session.snapOffset!.x).toBe(-4);
    expect(session.guides?.some((g) => g.type === "vertical" && g.position === 20)).toBe(true);

    const moved = doc.children[0].children!.find((n: PenNode) => n.id === "moving") as any;
    expect(moved.x).toBe(20);
  });

  it("does not snap the node to itself", () => {
    const doc = build();
    const tree = layoutDocument(doc);
    const session = dragSession(24, 300);
    // Pushed well clear of the sibling above it, so nothing is in range.
    handleDragMove(doc, session, { x: 224, y: 500 }, tree, undefined, 1);

    expect(session.snapOffset).toEqual({ x: 0, y: 0 });
    expect(session.guides).toHaveLength(0);
  });
});
