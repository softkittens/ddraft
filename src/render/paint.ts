import type { LayoutNode, Box } from "../layout/types";
import type {
  PenNode,
  PathNode,
  PolygonNode,
  TextNode,
  EllipseNode,
  Fill,
  ColorStop,
  Effect,
  ShadowEffect,
  BlurEffect
} from "../model/types";
import { resolveVariable } from "../model/variables";
import { resolveFontFamily, measureTextNode } from "../layout/text";

export type { Fill, ColorStop, Effect, ShadowEffect, BlurEffect };
export { resolveVariable };
export type StrokeAlignment = "inner" | "center" | "outer";

export function resolveFill(
  ctx: CanvasRenderingContext2D,
  fill: Fill | Fill[] | undefined,
  box: Box,
  variables?: Record<string, any>
): string | CanvasGradient | CanvasPattern | null {
  if (!fill) return null;
  if (Array.isArray(fill)) {
    const active = fill.find((f) => typeof f !== "object" || (f as any).enabled !== false) || fill[0];
    return resolveFill(ctx, active, box, variables);
  }
  if (typeof fill === "object" && (fill as any).enabled === false) {
    return null;
  }
  if (typeof fill === "string") return resolveVariable(fill, variables);

  switch (fill.type) {
    case "color":
      return resolveVariable(fill.color, variables);
    case "gradient": {
      const gradType = fill.gradientType || "linear";
      if (gradType === "radial") {
        const cx = box.width / 2;
        const cy = box.height / 2;
        const r = Math.max(box.width, box.height) / 2;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        for (const stop of fill.stops || []) {
          const color = resolveVariable(stop.color, variables);
          if (color) gradient.addColorStop(Math.max(0, Math.min(1, stop.offset)), color);
        }
        return gradient;
      } else {
        const gradient = ctx.createLinearGradient(0, 0, box.width, box.height);
        for (const stop of fill.stops || []) {
          const color = resolveVariable(stop.color, variables);
          if (color) gradient.addColorStop(Math.max(0, Math.min(1, stop.offset)), color);
        }
        return gradient;
      }
    }
    case "image":
      return "#334155";
    default:
      return null;
  }
}

export function paintStroke(
  ctx: CanvasRenderingContext2D,
  box: Box,
  strokeColor: Fill | string | undefined,
  strokeWidth: number | { top?: number; right?: number; bottom?: number; left?: number } = 1,
  alignment: StrokeAlignment = "center",
  variables?: Record<string, any>
): void {
  if (!strokeColor) return;
  const color = resolveVariable(strokeColor, variables);
  if (!color) return;

  ctx.strokeStyle = color;

  if (typeof strokeWidth === "object") {
    const { top = 0, right = 0, bottom = 0, left = 0 } = strokeWidth;
    if (top > 0) {
      ctx.lineWidth = top;
      ctx.beginPath();
      ctx.moveTo(0, top / 2);
      ctx.lineTo(box.width, top / 2);
      ctx.stroke();
    }
    if (bottom > 0) {
      ctx.lineWidth = bottom;
      ctx.beginPath();
      ctx.moveTo(0, box.height - bottom / 2);
      ctx.lineTo(box.width, box.height - bottom / 2);
      ctx.stroke();
    }
    if (left > 0) {
      ctx.lineWidth = left;
      ctx.beginPath();
      ctx.moveTo(left / 2, 0);
      ctx.lineTo(left / 2, box.height);
      ctx.stroke();
    }
    if (right > 0) {
      ctx.lineWidth = right;
      ctx.beginPath();
      ctx.moveTo(box.width - right / 2, 0);
      ctx.lineTo(box.width - right / 2, box.height);
      ctx.stroke();
    }
    return;
  }

  const width = typeof strokeWidth === "number" ? strokeWidth : 1;
  if (width <= 0) return;

  if (alignment === "center") {
    ctx.lineWidth = width;
    ctx.strokeRect(0, 0, box.width, box.height);
  } else if (alignment === "inner") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, box.width, box.height);
    ctx.clip();
    ctx.lineWidth = width * 2;
    ctx.strokeRect(0, 0, box.width, box.height);
    ctx.restore();
  } else if (alignment === "outer") {
    ctx.lineWidth = width;
    ctx.strokeRect(-width / 2, -width / 2, box.width + width, box.height + width);
  }
}

export function applyEffects(
  ctx: CanvasRenderingContext2D,
  effects: Effect | Effect[],
  variables?: Record<string, any>
): void {
  const list = Array.isArray(effects) ? effects : [effects];
  for (const eff of list) {
    if (!eff || eff.enabled === false) continue;
    if (eff.type === "shadow" || eff.type === "inner_shadow") {
      const shadow = eff as ShadowEffect;
      ctx.shadowColor = resolveVariable(shadow.color, variables) || "rgba(0,0,0,0.25)";
      ctx.shadowBlur = shadow.blur || 0;
      ctx.shadowOffsetX = shadow.x || 0;
      ctx.shadowOffsetY = shadow.y || 0;
    } else if (eff.type === "blur" || eff.type === "background_blur") {
      const blur = eff as BlurEffect;
      if (blur.radius) {
        ctx.filter = `blur(${blur.radius}px)`;
      }
    }
  }
}

export function clearEffects(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.filter = "none";
}

export function setupCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasRenderingContext2D | null {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const cssWidth = Math.floor(width);
  const cssHeight = Math.floor(height);
  const bufferW = Math.round(cssWidth * dpr);
  const bufferH = Math.round(cssHeight * dpr);

  if (canvas.style.width !== `${cssWidth}px`) {
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
  const fillVal = data?.fill ?? data?.fills;
  const fillStyle = resolveFill(ctx, fillVal, box, variables);
  const rawEffects = data?.effects ?? data?.effect;
  if (rawEffects) applyEffects(ctx, rawEffects, variables);

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
        if (data?.stroke && data?.strokeWidth) {
          const strokeColor = resolveVariable(data.stroke, variables);
          if (strokeColor) {
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = typeof data.strokeWidth === "number" ? data.strokeWidth : 1;
            ctx.stroke(path2d);
          }
        }
        ctx.restore();
      }
      break;
    }
    case "polygon": {
      const poly = data as PolygonNode;
      if (poly?.points && poly.points.length > 0) {
        if (typeof poly.points[0] === "number") {
          const pts = poly.points as number[];
          ctx.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) {
            ctx.lineTo(pts[i], pts[i + 1]);
          }
        } else {
          const pts = poly.points as unknown as [number, number][];
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i][0], pts[i][1]);
          }
        }
        ctx.closePath();
        if (fillStyle) {
          ctx.fillStyle = fillStyle;
          ctx.fill();
        }
        if (data?.stroke && data?.strokeWidth) {
          const strokeColor = resolveVariable(data.stroke, variables);
          if (strokeColor) {
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = typeof data.strokeWidth === "number" ? data.strokeWidth : 1;
            ctx.stroke();
          }
        }
      }
      break;
    }

    case "ellipse": {
      const ellipse = data as EllipseNode;
      const rx = box.width / 2;
      const ry = box.height / 2;
      if (ellipse?.innerRadius && ellipse.innerRadius > 0 && ellipse.innerRadius < 1) {
        const innerRx = rx * ellipse.innerRadius;
        const innerRy = ry * ellipse.innerRadius;
        const startAngle = ellipse.startAngle !== undefined ? (ellipse.startAngle * Math.PI) / 180 : 0;
        const sweepAngle = ellipse.sweepAngle !== undefined ? (ellipse.sweepAngle * Math.PI) / 180 : 2 * Math.PI;
        const endAngle = startAngle + sweepAngle;

        ctx.ellipse(rx, ry, rx, ry, 0, startAngle, endAngle);
        ctx.ellipse(rx, ry, innerRx, innerRy, 0, endAngle, startAngle, true);
        ctx.closePath();
      } else {
        ctx.ellipse(rx, ry, rx, ry, 0, 0, 2 * Math.PI);
      }
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      if (data?.stroke && data?.strokeWidth) {
        const strokeColor = resolveVariable(data.stroke, variables);
        if (strokeColor) {
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = typeof data.strokeWidth === "number" ? data.strokeWidth : 1;
          ctx.stroke();
        }
      }
      break;
    }
    case "text": {
      const textNode = data as TextNode;
      if (textNode?.content) {
        const fam = resolveFontFamily(textNode.fontFamily, variables);
        const weight = textNode.fontWeight || "normal";
        const size = textNode.fontSize || 14;
        ctx.font = `${weight} ${size}px ${fam}`;
        ctx.fillStyle = resolveVariable(textNode.fill, variables) || "#1e293b";
        ctx.textBaseline = "top";

        const align = textNode.textAlign || "left";
        let startX = 0;
        if (align === "center") {
          ctx.textAlign = "center";
          startX = box.width / 2;
        } else if (align === "right") {
          ctx.textAlign = "right";
          startX = box.width;
        } else {
          ctx.textAlign = "left";
          startX = 0;
        }

        const metrics = measureTextNode(textNode, box.width, variables);
        let curY = 0;
        for (const line of metrics.lines) {
          ctx.fillText(line, startX, curY);
          curY += metrics.lineHeight;
        }
      }
      break;
    }
    case "icon": {
      const iconNode = data as any;
      if ((iconNode?.icon || iconNode?.iconName) && typeof Path2D !== "undefined") {
        const path2d = new Path2D("M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5");
        ctx.save();
        ctx.scale(box.width / 24, box.height / 24);
        ctx.strokeStyle = resolveVariable(iconNode.fill, variables) || "#1e293b";
        ctx.lineWidth = 2;
        ctx.stroke(path2d);
        ctx.restore();
      }
      break;
    }
    default: {
      const radius = (data as any)?.cornerRadius || (layoutNode as any).cornerRadius || 0;
      if (radius > 0 && typeof ctx.roundRect === "function") {
        ctx.roundRect(0, 0, box.width, box.height, radius);
      } else {
        ctx.rect(0, 0, box.width, box.height);
      }
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      if (data?.stroke && data?.strokeWidth) {
        paintStroke(ctx, box, data.stroke, data.strokeWidth, (data as any).strokeAlignment as StrokeAlignment, variables);
      }
      break;
    }
  }

  if (rawEffects) clearEffects(ctx);
}

export function paintNode(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  nodeMap: Map<string, PenNode>,
  variables?: Record<string, any>,
  skipNodeId?: string,
  animatedPositions?: Map<string, { x: number; y: number }>
): void {
  const data = nodeMap.get(layoutNode.id);
  if (data?.enabled === false) return;
  if (layoutNode.id === skipNodeId) return;

  const animPos = animatedPositions?.get(layoutNode.id);
  const posX = animPos ? animPos.x : layoutNode.box.x;
  const posY = animPos ? animPos.y : layoutNode.box.y;
  const { rotation } = layoutNode;

  ctx.save();

  if (rotation && rotation !== 0) {
    ctx.translate(posX, posY);
    ctx.rotate((rotation * Math.PI) / 180);
  } else {
    ctx.translate(posX, posY);
  }

  if (data?.opacity !== undefined && data.opacity < 1) {
    ctx.globalAlpha = data.opacity;
  }

  if (data?.clip) {
    ctx.save();
    ctx.beginPath();
    const radius = (data as any)?.cornerRadius || 0;
    if (radius > 0 && typeof ctx.roundRect === "function") {
      ctx.roundRect(0, 0, layoutNode.box.width, layoutNode.box.height, radius);
    } else {
      ctx.rect(0, 0, layoutNode.box.width, layoutNode.box.height);
    }
    ctx.clip();
  }

  drawShape(ctx, layoutNode, data, variables);

  if (layoutNode.children && layoutNode.children.length > 0) {
    for (const child of layoutNode.children) {
      paintNode(ctx, child, nodeMap, variables, skipNodeId, animatedPositions);
    }
  }

  if (data?.clip) {
    ctx.restore();
  }

  ctx.restore();
}
