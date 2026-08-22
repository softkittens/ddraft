import type { LayoutNode } from "../layout/types";

export interface SelectionState {
  selectedIds: Set<string>;
  hoveredId: string | null;
}

export function createSelectionState(): SelectionState {
  return {
    selectedIds: new Set(),
    hoveredId: null
  };
}

function paintSizePill(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number): void {
  const labelText = `${Math.round(w)} × ${Math.round(h)}`;
  const fontSize = 11 / zoom;
  ctx.save();
  ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const measured = typeof ctx.measureText === "function" ? ctx.measureText(labelText) : null;
  const textWidth = measured && typeof measured.width === "number" ? measured.width : (labelText.length * 6) / zoom;
  const padX = 6 / zoom;
  const padY = 3 / zoom;
  const pillWidth = textWidth + padX * 2;
  const pillHeight = fontSize + padY * 2;
  const pillX = w / 2 - pillWidth / 2;
  const pillY = h + 6 / zoom;
  const pillRadius = 3 / zoom;

  ctx.fillStyle = "#0d99ff";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(pillX, pillY, pillWidth, pillHeight, pillRadius);
  } else {
    ctx.rect(pillX, pillY, pillWidth, pillHeight);
  }
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(labelText, w / 2, pillY + pillHeight / 2);
  ctx.restore();
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

  ctx.save();
  ctx.translate(layoutNode.box.x, layoutNode.box.y);
  if (layoutNode.rotation) {
    ctx.rotate((layoutNode.rotation * Math.PI) / 180);
  }

  if (isSelected || isHovered) {
    const { width: w, height: h } = layoutNode.box;
    ctx.strokeStyle = isSelected ? "#0d99ff" : "rgba(13, 153, 255, 0.4)";
    ctx.lineWidth = (isSelected ? 1.5 : 1) / zoom;
    ctx.strokeRect(0, 0, w, h);

    if (isSelected) {
      const handleSize = 6 / zoom;
      const half = handleSize / 2;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#0d99ff";
      ctx.lineWidth = 1.5 / zoom;

      const corners = [[0, 0], [w, 0], [w, h], [0, h]];
      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - half, cy - half, handleSize, handleSize);
        ctx.strokeRect(cx - half, cy - half, handleSize, handleSize);
      }

      paintSizePill(ctx, w, h, zoom);
    }
  }

  for (const child of layoutNode.children) {
    paintSelectionOverlay(ctx, child, selectedIds, hoveredId, zoom);
  }
  ctx.restore();
}
