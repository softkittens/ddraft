import type { LayoutNode, Box } from "../layout/types";
import type { PenNode } from "../model/types";
import type { Camera, Point } from "./camera";
import { worldToScreen } from "./camera";

export interface SelectionState {
  selectedIds: Set<string>;
  hoveredId: string | null;
}

export function createSelectionState(): SelectionState {
  return {
    selectedIds: new Set<string>(),
    hoveredId: null
  };
}

/**
 * Renders selection outlines and corner handles around selected nodes.
 *
 * Why:
 * Drawing with lineWidth = 1 / camera.zoom keeps the selection outline
 * exactly 1 pixel crisp on the screen, whether zoomed in at 500% or zoomed out at 20%.
 */
export function paintSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  selectedIds: Set<string>,
  hoveredId: string | null,
  zoom = 1
): void {
  const isSelected = selectedIds.has(layoutNode.id);
  const isHovered = hoveredId === layoutNode.id && !isSelected;

  if (isSelected || isHovered) {
    ctx.save();
    ctx.translate(layoutNode.box.x, layoutNode.box.y);
    if (layoutNode.rotation) {
      ctx.rotate((-layoutNode.rotation * Math.PI) / 180);
    }

    const { width: w, height: h } = layoutNode.box;
    ctx.strokeStyle = isSelected ? "#0ea5e9" : "rgba(14, 165, 233, 0.4)";
    ctx.lineWidth = (isSelected ? 2 : 1) / zoom;
    ctx.strokeRect(0, 0, w, h);

    // Draw 4 corner handles for selected nodes
    if (isSelected) {
      const handleSize = 6 / zoom;
      const half = handleSize / 2;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#0ea5e9";
      ctx.lineWidth = 1.5 / zoom;

      const corners = [[0, 0], [w, 0], [w, h], [0, h]];
      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - half, cy - half, handleSize, handleSize);
        ctx.strokeRect(cx - half, cy - half, handleSize, handleSize);
      }
    }

    ctx.restore();
  }

  // Paint selection on children inside their local coordinates
  ctx.save();
  ctx.translate(layoutNode.box.x, layoutNode.box.y);
  if (layoutNode.rotation) {
    ctx.rotate((-layoutNode.rotation * Math.PI) / 180);
  }
  for (const child of layoutNode.children) {
    paintSelectionOverlay(ctx, child, selectedIds, hoveredId, zoom);
  }
  ctx.restore();
}
