import type { Document, PenNode } from "../model/types";
import type { LayoutNode, Box } from "../layout/types";
import type { Point } from "./camera";
import { childrenOf, isParentNode } from "../model/tree";
import {
  hitTestSceneWorld,
  nearestFrameHit,
  worldPointToFrameLocal,
  frameLocalToWorld,
  type HitResult
} from "./hittest";

export const DRAG_THRESHOLD_PX = 3;

export function pastDragThreshold(start: Point, current: Point, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

export interface AlignmentGuide {
  type: "horizontal" | "vertical";
  position: number;
  start: number;
  end: number;
  points?: number[];
}

export interface DistanceGuide {
  axis: "x" | "y";
  start: number;
  end: number;
  crossPos: number;
  distance: number;
}

export interface DragSession {
  nodeId: string;
  startWorld: Point;
  currentWorld: Point;
  initialNodeX: number;
  initialNodeY: number;
  worldOffset: Point;
  dimensions: { width: number; height: number };
  targetContainerId?: string;
  targetContainerBox?: Box;
  targetContainerWorldPos?: Point;
  targetHit?: HitResult;
  insertIndex?: number;
  dropIndicator?: { x1: number; y1: number; x2: number; y2: number };
  guides?: AlignmentGuide[];
  distanceGuides?: DistanceGuide[];
  snapOffset?: Point;
  /** Held modifier that suspends snapping for this move, as ⌘ does in Figma. */
  snapDisabled?: boolean;
}

export function findNodeContext(
  doc: Document,
  nodeId: string
): { node: PenNode; parent: PenNode | null; index: number } | null {
  for (let i = 0; i < doc.children.length; i++) {
    const root = doc.children[i];
    if (root.id === nodeId) return { node: root, parent: null, index: i };
    const res = findInParent(root, nodeId);
    if (res) return res;
  }
  return null;
}

function findInParent(
  parent: PenNode,
  nodeId: string
): { node: PenNode; parent: PenNode; index: number } | null {
  const kids = childrenOf(parent);
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (child.id === nodeId) return { node: child, parent, index: i };
    const res = findInParent(child, nodeId);
    if (res) return res;
  }
  return null;
}

function dropTargetFrame(
  roots: LayoutNode[],
  point: Point,
  excludeId: string,
  nodeMap?: Map<string, PenNode>
): HitResult | null {
  const hit = hitTestSceneWorld(roots, point, nodeMap);
  if (!hit) return null;
  const cut = hit.path.findIndex((n) => n.id === excludeId);
  const path = cut >= 0 ? hit.path.slice(0, cut) : hit.path;
  if (path.length === 0) return null;
  return nearestFrameHit({
    node: path[path.length - 1],
    worldX: hit.worldX,
    worldY: hit.worldY,
    path
  });
}

/**
 * What the dragged node is allowed to snap to: the container it lives in, and
 * the siblings it shares that container with.
 *
 * It used to be every node in the document at every depth. On a canvas holding
 * four screens that is six hundred candidates, so a card being nudged inside one
 * screen would jump to the edge of a label nested three levels down inside a
 * different screen, eight hundred pixels away, and draw a guide to it. Figma
 * only ever offers what is on the same surface, which is why its guides read as
 * an explanation rather than a surprise.
 */
function snapTargetBoxes(roots: LayoutNode[], nodeId: string, containerId?: string): Box[] {
  const boxOf = (n: LayoutNode, ox: number, oy: number): Box => ({
    x: ox + n.box.x,
    y: oy + n.box.y,
    width: n.box.width,
    height: n.box.height
  });

  const surfaceOf = (node: LayoutNode, wx: number, wy: number): Box[] => [
    { x: wx, y: wy, width: node.box.width, height: node.box.height },
    ...node.children.filter((c) => c.id !== nodeId).map((c) => boxOf(c, wx, wy))
  ];

  // A top-level node's peers are the other top-level frames. Root boxes are
  // already in world space, so the offset starts at zero.
  if (!containerId && roots.some((n) => n.id === nodeId)) {
    return roots.filter((n) => n.id !== nodeId).map((n) => boxOf(n, 0, 0));
  }

  let found: Box[] | null = null;
  const walk = (node: LayoutNode, ox: number, oy: number): void => {
    if (found) return;
    const wx = ox + node.box.x;
    const wy = oy + node.box.y;
    // The container being dropped into wins over the one the node still lives
    // in: while it is being carried somewhere else, the guides that mean
    // anything are the ones on the surface it is landing on.
    const isSurface = containerId ? node.id === containerId : node.children.some((c) => c.id === nodeId);
    if (isSurface) {
      found = surfaceOf(node, wx, wy);
      return;
    }
    for (const child of node.children) walk(child, wx, wy);
  };
  for (const root of roots) walk(root, 0, 0);
  return found ?? [];
}

interface Interval1D {
  start: number;
  center: number;
  end: number;
  crossStart: number;
  crossEnd: number;
}

function toIntervals(boxes: Box[], isX: boolean): Interval1D[] {
  return boxes.map((b) => ({
    start: isX ? b.x : b.y,
    center: isX ? b.x + b.width / 2 : b.y + b.height / 2,
    end: isX ? b.x + b.width : b.y + b.height,
    crossStart: isX ? b.y : b.x,
    crossEnd: isX ? b.y + b.height : b.x + b.width
  }));
}

function findAlignmentSnap1D(
  moving: Interval1D,
  targets: Interval1D[],
  threshold: number,
  isX: boolean
): { snap: number; diff: number; guides: AlignmentGuide[] } | null {
  const movingEdges = [
    { at: moving.start, isCenter: false },
    { at: moving.center, isCenter: true },
    { at: moving.end, isCenter: false }
  ];

  const hits: { position: number; snap: number; diff: number }[] = [];

  for (const t of targets) {
    for (const tgt of [t.start, t.center, t.end]) {
      for (const m of movingEdges) {
        const diff = Math.abs(tgt - m.at);
        if (diff <= threshold) {
          hits.push({ position: tgt, snap: tgt - m.at, diff });
        }
      }
    }
  }

  if (hits.length === 0) return null;
  const best = hits.reduce((a, b) => (b.diff < a.diff ? b : a));

  // Group all distinct guide lines that share this exact winning snap shift
  const positions = [
    ...new Set(
      hits
        .filter((h) => Math.abs(h.snap - best.snap) < 0.001)
        .map((h) => h.position)
    )
  ].sort((a, b) => a - b);

  const settledMoving = [
    { at: moving.start + best.snap, isCenter: false },
    { at: moving.center + best.snap, isCenter: true },
    { at: moving.end + best.snap, isCenter: false }
  ];

  const guides: AlignmentGuide[] = [];

  for (const pos of positions) {
    const marks: number[] = [];

    const movingMatch = settledMoving.find((m) => Math.abs(m.at - pos) < 0.001);
    if (movingMatch) {
      marks.push(
        ...(movingMatch.isCenter
          ? [(moving.crossStart + moving.crossEnd) / 2]
          : [moving.crossStart, moving.crossEnd])
      );
    }

    for (const t of targets) {
      const hit = [
        { at: t.start, isCenter: false },
        { at: t.center, isCenter: true },
        { at: t.end, isCenter: false }
      ].find((e) => Math.abs(e.at - pos) < 0.001);
      if (hit) {
        marks.push(
          ...(hit.isCenter
            ? [(t.crossStart + t.crossEnd) / 2]
            : [t.crossStart, t.crossEnd])
        );
      }
    }

    if (marks.length > 0) {
      guides.push({
        type: isX ? "vertical" : "horizontal",
        position: pos,
        start: Math.min(...marks),
        end: Math.max(...marks),
        points: [...new Set(marks)].sort((a, b) => a - b)
      });
    }
  }

  return { snap: best.snap, diff: best.diff, guides };
}

function findGapSnap1D(
  moving: Interval1D,
  targets: Interval1D[],
  threshold: number,
  isX: boolean
): { snap: number; diff: number; guides: DistanceGuide[] } | null {
  const size = moving.end - moving.start;
  const crossPos = (moving.crossStart + moving.crossEnd) / 2;
  const axis = isX ? "x" : "y";

  // Filter overlapping targets on cross-axis and sort along main axis
  const sorted = targets
    .filter((t) => t.crossStart < moving.crossEnd && t.crossEnd > moving.crossStart)
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return null;

  let best: { snap: number; diff: number; guides: DistanceGuide[] } | null = null;

  const trySnap = (targetPos: number, guides: DistanceGuide[]) => {
    const diff = Math.abs(moving.start - targetPos);
    if (diff <= threshold && (!best || diff < best.diff)) {
      best = { snap: targetPos - moving.start, diff, guides };
    }
  };

  const dim = (start: number, end: number, dist: number, cp = crossPos): DistanceGuide => ({
    axis,
    start,
    end,
    crossPos: cp,
    distance: dist
  });

  // 1. Equal gap centered between two adjacent siblings
  for (let i = 0; i < sorted.length - 1; i++) {
    const L = sorted[i];
    const R = sorted[i + 1];
    const available = R.start - L.end;
    if (available >= size) {
      const gap = (available - size) / 2;
      if (gap > 4) {
        const targetPos = L.end + gap;
        trySnap(targetPos, [
          dim(L.end, targetPos, gap),
          dim(targetPos + size, R.start, gap)
        ]);
      }
    }
  }

  // 2. Matching an established sibling pair gap (placed after or before a pair)
  for (let i = 0; i < sorted.length - 1; i++) {
    const A = sorted[i];
    const B = sorted[i + 1];
    const gap = B.start - A.end;
    if (gap <= 4) continue;

    const pairCross = ((A.crossStart + A.crossEnd) / 2 + (B.crossStart + B.crossEnd) / 2) / 2;
    const pairGuide = dim(A.end, B.start, gap, pairCross);

    // Snap after B
    const targetAfter = B.end + gap;
    trySnap(targetAfter, [pairGuide, dim(B.end, targetAfter, gap)]);

    // Snap before A
    const targetBefore = A.start - gap - size;
    trySnap(targetBefore, [dim(targetBefore + size, A.start, gap), pairGuide]);
  }

  return best;
}

/**
 * Computes Figma-style smart alignment guides and snap offsets against other layout nodes.
 * Guide lines span between matched corners/centers with cross marks.
 * Distance badges appear on matching equal sibling distances.
 */
export function computeSmartGuides(
  layoutTree: LayoutNode[],
  session: DragSession,
  rawDx: number,
  rawDy: number,
  zoom = 1
): { snapDx: number; snapDy: number; guides: AlignmentGuide[]; distanceGuides?: DistanceGuide[] } {
  if (session.snapDisabled) {
    return { snapDx: 0, snapDy: 0, guides: [] };
  }

  const targets = snapTargetBoxes(layoutTree, session.nodeId, session.targetContainerId);
  if (targets.length === 0) {
    return { snapDx: 0, snapDy: 0, guides: [] };
  }

  const threshold = 6 / zoom;
  const { width: w, height: h } = session.dimensions;
  const rawX = session.worldOffset.x + rawDx;
  const rawY = session.worldOffset.y + rawDy;

  const snapAxis = (moving: Interval1D, targetBoxes: Box[], isX: boolean) => {
    const tIntervals = toIntervals(targetBoxes, isX);
    const gap = findGapSnap1D(moving, tIntervals, threshold, isX);
    const align = findAlignmentSnap1D(moving, tIntervals, threshold, isX);

    if (gap && (!align || gap.diff <= align.diff)) {
      return { snap: gap.snap, diff: gap.diff, align: [], dist: gap.guides };
    }
    if (align) {
      return { snap: align.snap, diff: align.diff, align: align.guides, dist: [] };
    }
    return { snap: 0, diff: Infinity, align: [], dist: [] };
  };

  /*
   * The two axes are independent, and both are always live.
   *
   * A previous heuristic suppressed one axis on the theory that Figma shows
   * one at a time. Figma does the opposite — lining up a card on both axes produces
   * both vertical and horizontal guides together, confirming corner-to-corner alignment.
   * Furthermore, suppressing axes based on cumulative drag distance meant that at
   * dx == dy = 0 (the moment a user nudges an already-placed node), both axes were
   * penalized and cut the snap radius from 6px to 2px, destroying snap precision.
   */
  const xRes = snapAxis(
    { start: rawX, center: rawX + w / 2, end: rawX + w, crossStart: rawY, crossEnd: rawY + h },
    targets,
    true
  );
  const yRes = snapAxis(
    { start: rawY, center: rawY + h / 2, end: rawY + h, crossStart: rawX, crossEnd: rawX + w },
    targets,
    false
  );

  const guides: AlignmentGuide[] = [];
  const distanceGuides: DistanceGuide[] = [];

  if (xRes.diff <= threshold) {
    guides.push(...xRes.align);
    distanceGuides.push(...xRes.dist);
  }
  if (yRes.diff <= threshold) {
    guides.push(...yRes.align);
    distanceGuides.push(...yRes.dist);
  }

  return {
    snapDx: xRes.diff <= threshold ? xRes.snap : 0,
    snapDy: yRes.diff <= threshold ? yRes.snap : 0,
    guides,
    distanceGuides: distanceGuides.length > 0 ? distanceGuides : undefined
  };
}

/**
 * Calculates the pending drop slot, target container highlight, and dashed insertion line.
 * Defers actual tree mutation to mouseup to prevent layout jitter.
 */
export function handleDragMove(
  doc: Document,
  session: DragSession,
  currentWorld: Point,
  layoutTree?: LayoutNode[],
  nodeMap?: Map<string, PenNode>,
  zoom = 1
): void {
  session.currentWorld = currentWorld;
  session.targetContainerId = undefined;
  session.targetContainerBox = undefined;
  session.targetContainerWorldPos = undefined;
  session.targetHit = undefined;
  session.dropIndicator = undefined;
  session.insertIndex = undefined;
  session.guides = undefined;
  session.distanceGuides = undefined;
  session.snapOffset = undefined;

  const ctx = findNodeContext(doc, session.nodeId);
  if (!ctx) return;
  const { node, parent } = ctx;

  const dx = currentWorld.x - session.startWorld.x;
  const dy = currentWorld.y - session.startWorld.y;

  const ghostCenterX = session.worldOffset.x + dx + session.dimensions.width / 2;
  const ghostCenterY = session.worldOffset.y + dy + session.dimensions.height / 2;

  if (layoutTree) {
    const frameHit = dropTargetFrame(layoutTree, { x: ghostCenterX, y: ghostCenterY }, session.nodeId, nodeMap);

    if (frameHit && frameHit.node.id !== session.nodeId) {
      const targetNode = findNodeContext(doc, frameHit.node.id)?.node;

      if (targetNode && isParentNode(targetNode)) {
        session.targetContainerId = frameHit.node.id;
        session.targetHit = frameHit;
        session.targetContainerWorldPos = { x: frameHit.worldX, y: frameHit.worldY };
        session.targetContainerBox = {
          x: frameHit.worldX,
          y: frameHit.worldY,
          width: frameHit.node.box.width,
          height: frameHit.node.box.height
        };

        const targetLayout = targetNode.type === "frame" ? targetNode.layout || "horizontal" : "none";

        if (targetLayout === "none") {
          /*
           * A frame that positions its children by hand is the one place
           * alignment guides are the whole job, and this returned before
           * computing any. Snapping reached only the branch below, which runs
           * when the pointer is over bare canvas — so it worked for screens
           * lining up against screens and went silent the moment anything was
           * dragged inside one. Both tests covering guides dragged a top-level
           * screen, so nothing said so.
           *
           * The move is applied live only while the node stays in the container
           * it already belongs to, because x and y are written in that
           * container's coordinates. Carrying it into a different frame still
           * gets guides and a snapped ghost; the position lands on drop.
           */
          applySmartMove(session, node, dx, dy, layoutTree, zoom, parent?.id === frameHit.node.id);
          return;
        }

        const isHoriz = targetLayout === "horizontal";
        const siblings = frameHit.node.children.filter((c) => c.id !== session.nodeId);
        const localGhost = worldPointToFrameLocal({ x: ghostCenterX, y: ghostCenterY }, frameHit);

        let insertIdx = siblings.length;
        for (let i = 0; i < siblings.length; i++) {
          const s = siblings[i];
          const mid = isHoriz ? s.box.x + s.box.width / 2 : s.box.y + s.box.height / 2;
          const cursorCoord = isHoriz ? localGhost.x : localGhost.y;
          if (cursorCoord < mid) {
            insertIdx = i;
            break;
          }
        }
        session.insertIndex = insertIdx;

        if (siblings.length > 0) {
          const ref = siblings[Math.min(insertIdx, siblings.length - 1)];
          const lineLocal = isHoriz
            ? (insertIdx >= siblings.length ? ref.box.x + ref.box.width + 4 : ref.box.x - 4)
            : (insertIdx >= siblings.length ? ref.box.y + ref.box.height + 4 : ref.box.y - 4);
          const a = isHoriz
            ? frameLocalToWorld({ x: lineLocal, y: 4 }, frameHit)
            : frameLocalToWorld({ x: 4, y: lineLocal }, frameHit);
          const b = isHoriz
            ? frameLocalToWorld({ x: lineLocal, y: frameHit.node.box.height - 4 }, frameHit)
            : frameLocalToWorld({ x: frameHit.node.box.width - 4, y: lineLocal }, frameHit);
          session.dropIndicator = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        }
        return;
      }
    }
  }

  const parentLayout = parent && parent.type === "frame" ? parent.layout : "none";
  if (!parent || parentLayout === "none" || node.layoutPosition === "absolute") {
    applySmartMove(session, node, dx, dy, layoutTree, zoom, true);
  }
}

/**
 * Records the guides for this move and, when the node is staying where it is,
 * puts it on them.
 */
function applySmartMove(
  session: DragSession,
  node: PenNode,
  dx: number,
  dy: number,
  layoutTree: LayoutNode[] | undefined,
  zoom: number,
  live: boolean
): void {
  let finalDx = dx;
  let finalDy = dy;
  let snappedX = false;
  let snappedY = false;

  if (layoutTree) {
    const snap = computeSmartGuides(layoutTree, session, dx, dy, zoom);
    finalDx += snap.snapDx;
    finalDy += snap.snapDy;
    snappedX = snap.snapDx !== 0;
    snappedY = snap.snapDy !== 0;
    session.guides = snap.guides;
    session.distanceGuides = snap.distanceGuides;
    session.snapOffset = { x: snap.snapDx, y: snap.snapDy };
  }

  if (!live) return;

  // A free drag lands on whole pixels. A snapped one lands exactly where the
  // guide is drawn: rounding a snapped axis puts the edge back up to half a
  // pixel off the line the user was aiming at, which at 400% zoom is visible.
  node.x = snappedX ? session.initialNodeX + finalDx : Math.round(session.initialNodeX + finalDx);
  node.y = snappedY ? session.initialNodeY + finalDy : Math.round(session.initialNodeY + finalDy);
}

/**
 * Commits the drop operation on mouseup.
 */
export function commitDragDrop(doc: Document, session: DragSession): void {
  const ctx = findNodeContext(doc, session.nodeId);
  if (!ctx) return;
  const { node, parent, index } = ctx;

  const dx = session.currentWorld.x - session.startWorld.x + (session.snapOffset?.x || 0);
  const dy = session.currentWorld.y - session.startWorld.y + (session.snapOffset?.y || 0);

  if (session.targetContainerId) {
    const targetCtx = findNodeContext(doc, session.targetContainerId);
    if (targetCtx && isParentNode(targetCtx.node)) {
      const targetChildren = targetCtx.node.children ?? [];
      targetCtx.node.children = targetChildren;
      if (parent && isParentNode(parent) && parent.children) {
        parent.children.splice(index, 1);
      } else {
        const rIdx = doc.children.findIndex((c) => c.id === node.id);
        if (rIdx !== -1) doc.children.splice(rIdx, 1);
      }

      const targetLayout = targetCtx.node.type === "frame" ? targetCtx.node.layout || "horizontal" : "none";

      if (targetLayout === "none") {
        const dropWorld = { x: session.worldOffset.x + dx, y: session.worldOffset.y + dy };
        if (session.targetHit) {
          const local = worldPointToFrameLocal(dropWorld, session.targetHit);
          node.x = Math.round(local.x);
          node.y = Math.round(local.y);
        } else {
          const origin = session.targetContainerWorldPos || { x: targetCtx.node.x ?? 0, y: targetCtx.node.y ?? 0 };
          node.x = Math.round(dropWorld.x - origin.x);
          node.y = Math.round(dropWorld.y - origin.y);
        }
        targetChildren.push(node);
      } else {
        delete node.x;
        delete node.y;
        const insertAt = session.insertIndex !== undefined ? Math.min(session.insertIndex, targetChildren.length) : targetChildren.length;
        targetChildren.splice(insertAt, 0, node);
      }
      return;
    }
  }

  if (parent !== null) {
    if (isParentNode(parent) && parent.children) {
      parent.children.splice(index, 1);
    }
    node.x = Math.round(session.worldOffset.x + dx);
    node.y = Math.round(session.worldOffset.y + dy);
    if (node.layoutPosition === "absolute") {
      delete node.layoutPosition;
    }
    doc.children.push(node);
  } else {
    node.x = Math.round(session.initialNodeX + dx);
    node.y = Math.round(session.initialNodeY + dy);
  }
}
