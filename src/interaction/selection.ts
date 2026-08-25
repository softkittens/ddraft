import type { LayoutNode } from "../layout/types";
import type { PenNode } from "../model/types";

export interface SelectionState {
  selectedIds: Set<string>;
  hoveredId: string | null;
}

export type ComponentKind = "component" | "instance" | "regular";

export function getComponentKind(nodeId: string, nodeMap?: Map<string, PenNode>): ComponentKind {
  const node = nodeMap?.get(nodeId);
  if (!node) return "regular";

  const nodeType = (node as any).type;
  if (node.reusable || nodeType === "component") {
    return "component";
  }

  if (nodeType === "ref" || nodeType === "instance" || (node as any).ref !== undefined || nodeId.includes(":")) {
    return "instance";
  }

  return "regular";
}

export function createSelectionState(): SelectionState {
  return {
    selectedIds: new Set(),
    hoveredId: null
  };
}

function paintSizePill(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number, kind: ComponentKind = "regular"): void {
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

  const pillColor = kind === "component" || kind === "instance" ? "#7b61ff" : "#0d99ff";

  ctx.fillStyle = pillColor;
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
 * - Component (Master): Solid purple (#7b61ff) outline and handles.
 * - Component Instance: Dashed purple (#7b61ff) outline and handles.
 * - Regular Node: Solid blue (#0d99ff) outline and handles.
 */
export function paintSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  selectedIds: Set<string>,
  hoveredId: string | null,
  zoom = 1,
  nodeMap?: Map<string, PenNode>,
  skipNodeId?: string,
  worldX = 0,
  worldY = 0,
  viewBounds?: { left: number; top: number; right: number; bottom: number }
): void {
  if (skipNodeId && layoutNode.id === skipNodeId) return;

  const curX = worldX + layoutNode.box.x;
  const curY = worldY + layoutNode.box.y;
  if (viewBounds) {
    if (
      curX + layoutNode.box.width < viewBounds.left ||
      curX > viewBounds.right ||
      curY + layoutNode.box.height < viewBounds.top ||
      curY > viewBounds.bottom
    ) {
      return;
    }
  }

  const isSelected = selectedIds.has(layoutNode.id);
  const isHovered = hoveredId === layoutNode.id && !isSelected;

  ctx.save();
  ctx.translate(layoutNode.box.x, layoutNode.box.y);
  if (layoutNode.rotation) {
    ctx.rotate((layoutNode.rotation * Math.PI) / 180);
  }

  if (isSelected || isHovered) {
    const { width: w, height: h } = layoutNode.box;
    const kind = getComponentKind(layoutNode.id, nodeMap);
    const themeColor = kind === "component" || kind === "instance" ? "#7b61ff" : "#0d99ff";
    const hoverColor = kind === "component" || kind === "instance" ? "rgba(123, 97, 255, 0.45)" : "rgba(13, 153, 255, 0.4)";

    ctx.strokeStyle = isSelected ? themeColor : hoverColor;
    ctx.lineWidth = (isSelected ? 1.5 : 1) / zoom;

    if (kind === "instance") {
      ctx.setLineDash([4 / zoom, 4 / zoom]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.strokeRect(0, 0, w, h);

    if (isSelected) {
      const handleSize = 6 / zoom;
      const half = handleSize / 2;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = themeColor;
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([]);

      const corners = [[0, 0], [w, 0], [w, h], [0, h]];
      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - half, cy - half, handleSize, handleSize);
        ctx.strokeRect(cx - half, cy - half, handleSize, handleSize);
      }

      paintSizePill(ctx, w, h, zoom, kind);
    }
  }

  for (const child of layoutNode.children) {
    paintSelectionOverlay(ctx, child, selectedIds, hoveredId, zoom, nodeMap, skipNodeId, curX, curY, viewBounds);
  }
  ctx.restore();
}
