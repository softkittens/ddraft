import type { Box } from "../layout/types";
import type {
  PenNode,
  Fill,
  ColorStop,
  Effect,
  ShadowEffect,
  BlurEffect
} from "../model/types";
import { resolveVariable } from "../model/variables";

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
  variables?: Record<string, any>,
  cornerRadius?: number | number[] | [number, number, number, number]
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

  const drawPath = (x: number, y: number, w: number, h: number, r?: number | number[] | [number, number, number, number]) => {
    ctx.beginPath();
    if (r !== undefined && typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, w, h, r as any);
    } else {
      ctx.rect(x, y, w, h);
    }
  };

  if (alignment === "center") {
    ctx.lineWidth = width;
    drawPath(0, 0, box.width, box.height, cornerRadius);
    ctx.stroke();
  } else if (alignment === "inner") {
    ctx.save();
    drawPath(0, 0, box.width, box.height, cornerRadius);
    ctx.clip();
    ctx.lineWidth = width * 2;
    drawPath(0, 0, box.width, box.height, cornerRadius);
    ctx.stroke();
    ctx.restore();
  } else if (alignment === "outer") {
    ctx.lineWidth = width;
    const offset = width / 2;
    const outerRadius = typeof cornerRadius === "number"
      ? cornerRadius + offset
      : Array.isArray(cornerRadius)
      ? cornerRadius.map((cr) => cr + offset)
      : undefined;
    drawPath(-offset, -offset, box.width + width, box.height + width, outerRadius as any);
    ctx.stroke();
  }
}

export function strokeCurrentPath(
  ctx: CanvasRenderingContext2D,
  data: PenNode | undefined,
  variables?: Record<string, any>,
  path?: Path2D
): void {
  if (!data?.stroke || !data.strokeWidth) return;
  const strokeColor = resolveVariable(data.stroke, variables);
  if (!strokeColor) return;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = typeof data.strokeWidth === "number" ? data.strokeWidth : 1;
  if (path) ctx.stroke(path);
  else ctx.stroke();
}

export function applyEffects(
  ctx: CanvasRenderingContext2D,
  effects: Effect | Effect[],
  variables?: Record<string, any>
): void {
  const list = Array.isArray(effects) ? effects : [effects];
  for (const eff of list) {
    if (!eff || eff.enabled === false) continue;
    switch (eff.type) {
      case "shadow":
      case "inner_shadow": {
        ctx.shadowColor = resolveVariable(eff.color, variables) || "rgba(0,0,0,0.25)";
        ctx.shadowBlur = eff.blur || 0;
        ctx.shadowOffsetX = eff.x || 0;
        ctx.shadowOffsetY = eff.y || 0;
        break;
      }
      case "blur":
      case "background_blur": {
        if (eff.radius) ctx.filter = `blur(${eff.radius}px)`;
        break;
      }
      default: {
        const _never: never = eff;
        void _never;
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
