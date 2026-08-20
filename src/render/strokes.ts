import type { Box } from "../layout/types";
import type { Fill } from "../model/types";
import { resolveVariable } from "./fills";

export type StrokeAlignment = "inner" | "center" | "outer";

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

  if (typeof strokeWidth === "object" && strokeWidth !== null) {
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
