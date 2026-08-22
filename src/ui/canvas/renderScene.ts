import { paintNode } from "../../render/paint";
import { paintSelectionOverlay } from "../../interaction/selection";
import { pruneFinishedAnimations, getAnimatedPositions } from "../../interaction/animate";
import { findLayoutNode } from "../../layout/layout";
import type { Box } from "../../layout/types";
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

  offCtx.fillStyle = "rgba(15, 23, 42, 0.22)";
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
  const { camera, tree, map, variables, selectedIds, hoveredId, dragSession, isAltHeld, shapeStart, shapeCurrent } = state;

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

  // Root frame titles (only for visible roots)
  ctx.font = `${11 / camera.zoom}px -apple-system, sans-serif`;
  for (const root of tree) {
    if (root.type === "frame" && isVisible(root.box)) {
      const rootDoc = map.get(root.id);
      const name = rootDoc?.name || root.id;
      const isSel = selectedIds.has(root.id);
      ctx.fillStyle = isSel ? "#0d99ff" : "rgba(0, 0, 0, 0.45)";
      ctx.fillText(name, root.box.x, root.box.y - 7);
    }
  }

  // Paint scene nodes (frustum-culled at the root level and child level)
  const skipId = dragSession && !isAltHeld ? dragSession.nodeId : undefined;
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
      paintSelectionOverlay(ctx, root, selectedIds, hoveredId, camera.zoom);
    }
  }

  // Floating elevated drag ghost (zero-allocation lookup via findLayoutNode)
  if (dragSession) {
    const draggedLayout = findLayoutNode(tree, dragSession.nodeId);
    if (draggedLayout) {
      const dx = dragSession.currentWorld.x - dragSession.startWorld.x;
      const dy = dragSession.currentWorld.y - dragSession.startWorld.y;
      const ghostX = dragSession.worldOffset.x + dx;
      const ghostY = dragSession.worldOffset.y + dy;

      ctx.save();
      ctx.globalAlpha = 0.88;
      ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
      ctx.shadowBlur = 16 / camera.zoom;
      ctx.shadowOffsetY = 8 / camera.zoom;

      ctx.translate(ghostX - draggedLayout.box.x, ghostY - draggedLayout.box.y);
      paintNode(ctx, draggedLayout, map, variables);

      ctx.strokeStyle = "#0d99ff";
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.strokeRect(draggedLayout.box.x, draggedLayout.box.y, draggedLayout.box.width, draggedLayout.box.height);

      ctx.restore();
    }
  }

  // Shape drawing preview
  if (shapeStart && shapeCurrent) {
    const x = Math.min(shapeStart.x, shapeCurrent.x);
    const y = Math.min(shapeStart.y, shapeCurrent.y);
    const w = Math.abs(shapeCurrent.x - shapeStart.x);
    const h = Math.abs(shapeCurrent.y - shapeStart.y);
    ctx.save();
    ctx.strokeStyle = "#0d99ff";
    ctx.lineWidth = 1 / camera.zoom;
    ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  ctx.restore();
}
