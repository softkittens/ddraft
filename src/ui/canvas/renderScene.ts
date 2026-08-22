import { paintNode } from "../../render/paint";
import { paintSelectionOverlay } from "../../interaction/selection";
import { pruneFinishedAnimations, getAnimatedPositions } from "../../interaction/animate";
import { findLayoutNode } from "../../layout/layout";
import type { Box } from "../../layout/types";
import type { Point } from "../../interaction/camera";
import type { AlignmentGuide, DistanceGuide } from "../../interaction/drag";
import type { CanvasRenderState } from "./types";

let dotPattern: CanvasPattern | null = null;

function getDotPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (dotPattern) return dotPattern;
  if (typeof document === "undefined") return null;

  const offscreen = document.createElement("canvas");
  offscreen.width = 20;
  offscreen.height = 20;
  const offCtx = offscreen.getContext("2d");
  if (!offCtx) return null;

  offCtx.fillStyle = "rgba(15, 23, 42, 0.176)";
  offCtx.beginPath();
  offCtx.arc(10, 10, 1, 0, Math.PI * 2);
  offCtx.fill();

  dotPattern = ctx.createPattern(offscreen, "repeat");
  return dotPattern;
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: CanvasRenderState
): void {
  const {
    camera,
    tree,
    map,
    variables,
    selectedIds,
    hoveredId,
    dragSession,
    isAltHeld,
    shapeStart,
    shapeCurrent,
    marqueeStart,
    marqueeCurrent
  } = state;

  ctx.save();
  ctx.fillStyle = "#e8eaed";
  ctx.fillRect(0, 0, width, height);

  // Background grid dots (GPU-accelerated pattern transformed with camera matrix)
  const pattern = getDotPattern(ctx);
  if (pattern && camera.zoom >= 0.25) {
    ctx.save();
    if (typeof DOMMatrix !== "undefined" && pattern.setTransform) {
      const mat = new DOMMatrix().translate(camera.x, camera.y).scale(camera.zoom);
      pattern.setTransform(mat);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  }

  // World coordinate transform
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  pruneFinishedAnimations();
  const animPositions = getAnimatedPositions();

  // Active drag/edit node to skip stationary rendering for
  const skipId = (dragSession && !isAltHeld ? dragSession.nodeId : undefined) || state.editingTextId || undefined;

  // World-space viewport frustum culling bounds
  const viewLeft = -camera.x / camera.zoom;
  const viewTop = -camera.y / camera.zoom;
  const viewRight = (width - camera.x) / camera.zoom;
  const viewBottom = (height - camera.y) / camera.zoom;
  const cullingMargin = 60 / camera.zoom;

  const isVisible = (box: Box): boolean => {
    return (
      box.x + box.width >= viewLeft - cullingMargin &&
      box.x <= viewRight + cullingMargin &&
      box.y + box.height >= viewTop - cullingMargin &&
      box.y <= viewBottom + cullingMargin
    );
  };

  const working = new Set(state.workingFrameIds ?? []);
  ctx.font = `${11 / camera.zoom}px -apple-system, sans-serif`;
  for (const root of tree) {
    if (skipId && root.id === skipId) continue;
    if (working.has(root.id)) continue;
    if (root.type === "frame" && isVisible(root.box)) {
      const rootDoc = map.get(root.id);
      const name = rootDoc?.name || root.id;
      const isSel = selectedIds.has(root.id);
      ctx.fillStyle = isSel ? "#0d99ff" : "rgba(0, 0, 0, 0.45)";
      ctx.fillText(name, root.box.x, root.box.y - 7);
    }
  }

  // Paint scene nodes (frustum-culled at the root level and child level)
  const viewBounds = {
    left: viewLeft - cullingMargin,
    top: viewTop - cullingMargin,
    right: viewRight + cullingMargin,
    bottom: viewBottom + cullingMargin
  };

  for (const root of tree) {
    if (isVisible(root.box) || (skipId && root.id === skipId)) {
      paintNode(ctx, root, map, variables, {
        skipNodeId: skipId,
        animatedPositions: animPositions,
        zoom: camera.zoom,
        worldX: 0,
        worldY: 0,
        viewBounds
      });
    }
  }

  // Drop target highlights & dashed insertion lines
  if (dragSession?.targetContainerBox) {
    const tb = dragSession.targetContainerBox;
    ctx.save();
    ctx.strokeStyle = "#0d99ff";
    ctx.lineWidth = 2 / camera.zoom;
    ctx.strokeRect(tb.x, tb.y, tb.width, tb.height);
    ctx.restore();
  }
  if (dragSession?.dropIndicator) {
    const { x1, y1, x2, y2 } = dragSession.dropIndicator;
    ctx.save();
    ctx.strokeStyle = "#0d99ff";
    ctx.lineWidth = 2 / camera.zoom;
    ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  // Selection & hover bounding box overlays (frustum-culled at the root level)
  for (const root of tree) {
    if (isVisible(root.box)) {
      paintSelectionOverlay(ctx, root, selectedIds, hoveredId, camera.zoom, map, skipId);
    }
  }

  // Floating drag ghost (zero-allocation lookup via findLayoutNode)
  if (dragSession) {
    const draggedLayout = findLayoutNode(tree, dragSession.nodeId);
    if (draggedLayout) {
      const dx = dragSession.currentWorld.x - dragSession.startWorld.x + (dragSession.snapOffset?.x || 0);
      const dy = dragSession.currentWorld.y - dragSession.startWorld.y + (dragSession.snapOffset?.y || 0);
      const ghostX = dragSession.worldOffset.x + dx;
      const ghostY = dragSession.worldOffset.y + dy;

      ctx.save();
      ctx.globalAlpha = 0.88;

      ctx.translate(ghostX - draggedLayout.box.x, ghostY - draggedLayout.box.y);
      paintNode(ctx, draggedLayout, map, variables);

      if (draggedLayout.type === "frame") {
        const rootDoc = map.get(draggedLayout.id);
        const name = rootDoc?.name || draggedLayout.id;
        ctx.font = `${11 / camera.zoom}px -apple-system, sans-serif`;
        ctx.fillStyle = "#0d99ff";
        ctx.fillText(name, draggedLayout.box.x, draggedLayout.box.y - 7);
      }

      ctx.restore();
    }

    // Figma-style smart alignment reference guides
    if (dragSession.guides && dragSession.guides.length > 0) {
      paintSmartGuides(ctx, dragSession.guides, camera.zoom);
    }
    // Figma-style equal gap distance markers
    if (dragSession.distanceGuides && dragSession.distanceGuides.length > 0) {
      paintDistanceGuides(ctx, dragSession.distanceGuides, camera.zoom);
    }
  }

  // Shape drawing preview
  if (shapeStart && shapeCurrent) {
    paintShapePreview(ctx, shapeStart, shapeCurrent, camera.zoom);
  }

  // Marquee selection preview
  if (marqueeStart && marqueeCurrent) {
    paintMarqueeBox(ctx, marqueeStart, marqueeCurrent, camera.zoom);
  }

  ctx.restore();
}

function paintSmartGuides(ctx: CanvasRenderingContext2D, guides: AlignmentGuide[], zoom: number): void {
  ctx.save();
  ctx.strokeStyle = "#ff007a";
  ctx.lineWidth = 1 / zoom;
  const s = 3.5 / zoom;

  ctx.beginPath();
  for (const g of guides) {
    const isVert = g.type === "vertical";
    if (isVert) {
      ctx.moveTo(g.position, g.start);
      ctx.lineTo(g.position, g.end);
    } else {
      ctx.moveTo(g.start, g.position);
      ctx.lineTo(g.end, g.position);
    }
    if (g.points) {
      for (const p of g.points) {
        const cx = isVert ? g.position : p;
        const cy = isVert ? p : g.position;
        ctx.moveTo(cx - s, cy - s);
        ctx.lineTo(cx + s, cy + s);
        ctx.moveTo(cx - s, cy + s);
        ctx.lineTo(cx + s, cy - s);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

function paintDistanceGuides(ctx: CanvasRenderingContext2D, guides: DistanceGuide[], zoom: number): void {
  ctx.save();
  ctx.strokeStyle = "#ff007a";
  ctx.lineWidth = 1 / zoom;
  const tick = 4 / zoom;

  for (const g of guides) {
    const dist = Math.round(g.distance);
    if (dist <= 0) continue;

    const isX = g.axis === "x";
    ctx.beginPath();
    if (isX) {
      ctx.moveTo(g.start, g.crossPos);
      ctx.lineTo(g.end, g.crossPos);
      ctx.moveTo(g.start, g.crossPos - tick);
      ctx.lineTo(g.start, g.crossPos + tick);
      ctx.moveTo(g.end, g.crossPos - tick);
      ctx.lineTo(g.end, g.crossPos + tick);
    } else {
      ctx.moveTo(g.crossPos, g.start);
      ctx.lineTo(g.crossPos, g.end);
      ctx.moveTo(g.crossPos - tick, g.start);
      ctx.lineTo(g.crossPos + tick, g.start);
      ctx.moveTo(g.crossPos - tick, g.end);
      ctx.lineTo(g.crossPos + tick, g.end);
    }
    ctx.stroke();

    const midX = isX ? (g.start + g.end) / 2 : g.crossPos;
    const midY = isX ? g.crossPos : (g.start + g.end) / 2;
    paintDistancePill(ctx, midX, midY, dist, zoom);
  }
  ctx.restore();
}

function paintDistancePill(ctx: CanvasRenderingContext2D, cx: number, cy: number, dist: number, zoom: number): void {
  const text = `${dist}`;
  const fontSize = 10 / zoom;
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const metrics = ctx.measureText(text);
  const pillW = metrics.width + 8 / zoom;
  const pillH = 15 / zoom;
  const r = 3 / zoom;

  ctx.save();
  ctx.fillStyle = "#ff007a";
  ctx.beginPath();
  ctx.roundRect(cx - pillW / 2, cy - pillH / 2, pillW, pillH, r);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

function paintMarqueeBox(ctx: CanvasRenderingContext2D, start: Point, current: Point, zoom: number): void {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const w = Math.abs(current.x - start.x);
  const h = Math.abs(current.y - start.y);
  ctx.save();
  ctx.fillStyle = "rgba(13, 153, 255, 0.08)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#0d99ff";
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function paintShapePreview(ctx: CanvasRenderingContext2D, start: Point, current: Point, zoom: number): void {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  const w = Math.abs(current.x - start.x);
  const h = Math.abs(current.y - start.y);
  ctx.save();
  ctx.strokeStyle = "#0d99ff";
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([4 / zoom, 4 / zoom]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}
