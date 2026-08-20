import type { LayoutNode } from "../layout/types";
import type { PenNode, PathNode, PolygonNode, TextNode, IconNode } from "../model/types";


import { resolveFill, resolveVariable } from "./fills";
import { paintStroke } from "./strokes";
import { applyEffects, clearEffects, type Effect } from "./effects";

export function setupCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
): CanvasRenderingContext2D | null {
  const bufferW = Math.floor(cssWidth * dpr);
  const bufferH = Math.floor(cssHeight * dpr);
  if (canvas.style) {
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }

  if (canvas.width === bufferW && canvas.height === bufferH) {
    return canvas.getContext("2d");
  }

  canvas.width = bufferW;
  canvas.height = bufferH;

  const ctx = canvas.getContext("2d");
  if (ctx) ctx.scale(dpr, dpr);
  return ctx;
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  data?: PenNode,
  variables?: Record<string, any>
): void {
  const { box } = layoutNode;
  const fillStyle = resolveFill(ctx, data?.fill, box, variables);
  const effects = data?.effects as Effect[] | undefined;

  if (effects) applyEffects(ctx, effects, variables);

  ctx.beginPath();
  switch (layoutNode.type) {
    case "path": {
      const pathNode = data as PathNode;
      if (pathNode?.geometry && typeof Path2D !== "undefined") {
        const path2d = new Path2D(pathNode.geometry);
        ctx.save();
        if (pathNode.viewBox) {
          const parts = pathNode.viewBox.split(" ").map(Number);
          const vbW = parts[2] || box.width;
          const vbH = parts[3] || box.height;
          ctx.scale(box.width / vbW, box.height / vbH);
        }
        if (fillStyle) {
          ctx.fillStyle = fillStyle;
          ctx.fill(path2d);
        }
        ctx.restore();
      }
      break;
    }
    case "ellipse": {
      const cx = box.width / 2;
      const cy = box.height / 2;
      ctx.ellipse(cx, cy, Math.max(0, cx), Math.max(0, cy), 0, 0, Math.PI * 2);
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      break;
    }
    case "polygon": {
      const pts = (data as PolygonNode)?.points || [];
      if (pts.length >= 4) {
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.closePath();
      } else {
        ctx.rect(0, 0, box.width, box.height);
      }
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      break;
    }
    case "text": {
      if (fillStyle) {
        const textNode = data as TextNode;
        ctx.fillStyle = fillStyle;
        const fontFam = textNode?.fontFamily ? resolveVariable(textNode.fontFamily, variables) : "Inter";
        ctx.font = `${textNode?.fontWeight || "normal"} ${textNode?.fontSize || 16}px ${fontFam}`;
        ctx.textBaseline = "top";
        ctx.fillText(textNode?.content || "", 0, 0);
      }
      break;
    }
    case "icon": {
      const iconNode = data as IconNode;
      const cr = 4;
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(0, 0, box.width, box.height, cr);
      } else {
        ctx.rect(0, 0, box.width, box.height);
      }
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      ctx.strokeStyle = resolveVariable(iconNode?.fill || "$muted", variables) || "#64748b";
      ctx.lineWidth = 1;
      ctx.stroke();

      const iconName = (iconNode?.icon || "IC").slice(0, 2).toUpperCase();
      ctx.fillStyle = resolveVariable(iconNode?.fill || "$text", variables) || "#94a3b8";
      ctx.font = `600 ${Math.max(8, Math.min(box.width, box.height) * 0.45)}px 'Geist Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(iconName, box.width / 2, box.height / 2);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      break;
    }

    default: {
      const cr = data?.cornerRadius;
      if (cr && typeof ctx.roundRect === "function") {
        ctx.roundRect(0, 0, box.width, box.height, cr as any);
      } else {
        ctx.rect(0, 0, box.width, box.height);
      }
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      break;
    }
  }

  if (data?.stroke) {
    paintStroke(ctx, box, data.stroke, data.strokeWidth, "center", variables);
  }

  if (effects) clearEffects(ctx);
}

export function paintNode(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  nodeDataMap?: Map<string, PenNode>,
  variables?: Record<string, any>,
  dimmedId?: string,
  animPositions?: Map<string, { x: number; y: number }>
): void {
  const { box, rotation, children } = layoutNode;
  const data = nodeDataMap?.get(layoutNode.id);
  if (data?.enabled === false) return;

  const animPos = animPositions?.get(layoutNode.id);
  const posX = animPos ? animPos.x : box.x;
  const posY = animPos ? animPos.y : box.y;

  ctx.save();
  ctx.translate(posX, posY);
  if (rotation) ctx.rotate((-rotation * Math.PI) / 180);

  if (data?.opacity != null) ctx.globalAlpha *= data.opacity;
  if (dimmedId && layoutNode.id === dimmedId) ctx.globalAlpha *= 0.25;

  if (data?.clip) {
    ctx.beginPath();
    ctx.rect(0, 0, box.width, box.height);
    ctx.clip();
  }

  drawShape(ctx, layoutNode, data, variables);

  for (const child of children) {
    paintNode(ctx, child, nodeDataMap, variables, dimmedId, animPositions);
  }

  ctx.restore();
}

