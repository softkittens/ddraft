import type { LayoutNode, Box } from "../layout/types";
import type { PenNode, PathNode, PolygonNode, TextNode } from "../model/types";
import { resolveFill, resolveVariable } from "./fills";
import { paintStroke } from "./strokes";
import { applyEffects, clearEffects } from "./effects";

export function setupCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
): CanvasRenderingContext2D | null {
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

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
  const effects = (data as any)?.effects;

  if (effects) applyEffects(ctx, effects);

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

import { getAnimatedPosition } from "../interaction/animate";

export function paintNode(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  nodeDataMap?: Map<string, PenNode>,
  variables?: Record<string, any>,
  dimmedId?: string
): void {
  const { box, rotation, children } = layoutNode;
  const data = nodeDataMap?.get(layoutNode.id);
  const animPos = getAnimatedPosition(layoutNode.id);

  const posX = animPos ? animPos.x : box.x;
  const posY = animPos ? animPos.y : box.y;

  ctx.save();
  ctx.translate(posX, posY);
  if (rotation) ctx.rotate((-rotation * Math.PI) / 180);


  if (dimmedId && layoutNode.id === dimmedId) {
    ctx.globalAlpha = 0.25;
  }

  drawShape(ctx, layoutNode, data, variables);

  for (const child of children) {
    paintNode(ctx, child, nodeDataMap, variables, dimmedId);
  }

  ctx.restore();
}

