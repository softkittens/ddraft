import type { Box } from "../layout/types";

export type ColorStop = { offset: number; color: string };

export type Fill =
  | string
  | { type: "color"; color: string }
  | {
      type: "gradient";
      gradientType?: "linear" | "radial";
      rotation?: number; // In degrees, counter-clockwise, 0° points up
      stops: ColorStop[];
    }
  | { type: "image"; src: string; mode?: "fill" | "fit" | "tile" };

export function resolveVariable(val: string, variables?: Record<string, any>): string {
  if (val.startsWith("$") && variables) {
    const key = val.slice(1);
    const item = variables[key];
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && typeof item.value === "string") return item.value;
  }
  return val;
}

/**
 * Resolves a Fill specification into a Canvas fillStyle.
 */
export function resolveFill(
  ctx: CanvasRenderingContext2D,
  fill: unknown,
  box: Box,
  variables?: Record<string, any>
): string | CanvasGradient | CanvasPattern | null {
  if (!fill) return null;

  if (typeof fill === "string") {
    return resolveVariable(fill, variables);
  }

  const f = fill as any;
  if (f.type === "color" && f.color) {
    return resolveVariable(f.color, variables);
  }

  if (f.type === "gradient" && Array.isArray(f.stops)) {
    const { width: w, height: h } = box;
    const cx = w / 2;
    const cy = h / 2;

    if (f.gradientType === "radial") {
      const radius = Math.max(w, h) / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      for (const stop of f.stops) {
        grad.addColorStop(stop.offset, resolveVariable(stop.color, variables));
      }
      return grad;
    }

    const rotDeg = f.rotation || 0;
    const rad = (rotDeg * Math.PI) / 180;
    const dx = -Math.sin(rad) * (w / 2);
    const dy = -Math.cos(rad) * (h / 2);

    const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    for (const stop of f.stops) {
      grad.addColorStop(stop.offset, resolveVariable(stop.color, variables));
    }
    return grad;
  }

  return null;
}
