import type { Box } from "../layout/types";
import type { Fill, ColorStop } from "../model/types";

export type { Fill, ColorStop };

export function resolveVariable(val: Fill | string | undefined, variables?: Record<string, any>): string {
  if (!val) return "";
  if (typeof val === "object" && val !== null) {
    if (val.type === "color") return resolveVariable(val.color, variables);
    return "";
  }
  if (typeof val === "string" && val.startsWith("$") && variables) {
    const key = val.slice(1);
    const item = variables[key];
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && typeof item.value === "string") return item.value;
  }
  return typeof val === "string" ? val : "";
}

/**
 * Resolves a Fill specification into a Canvas fillStyle.
 */
export function resolveFill(
  ctx: CanvasRenderingContext2D,
  fill: Fill | undefined,
  box: Box,
  variables?: Record<string, any>
): string | CanvasGradient | CanvasPattern | null {
  if (!fill) return null;

  if (typeof fill === "string") {
    return resolveVariable(fill, variables);
  }

  switch (fill.type) {
    case "color":
      return resolveVariable(fill.color, variables);

    case "gradient": {
      const { width: w, height: h } = box;
      const cx = w / 2;
      const cy = h / 2;

      if (fill.gradientType === "radial") {
        const radius = Math.max(w, h) / 2;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        for (const stop of fill.stops) {
          grad.addColorStop(stop.offset, resolveVariable(stop.color, variables));
        }
        return grad;
      }

      const rotDeg = fill.rotation || 0;
      const rad = (rotDeg * Math.PI) / 180;
      const dx = -Math.sin(rad) * (w / 2);
      const dy = -Math.cos(rad) * (h / 2);

      const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      for (const stop of fill.stops) {
        grad.addColorStop(stop.offset, resolveVariable(stop.color, variables));
      }
      return grad;
    }

    default:
      return null;
  }
}
