import type { LayoutNode, Box } from "../layout/types";
import type {
  PenNode,
  PathNode,
  PolygonNode,
  TextNode,
  EllipseNode,
  IconNode,
  ImageFill,
  Fill,
  ColorStop,
  Effect,
  ShadowEffect,
  BlurEffect
} from "../model/types";
import { resolveVariable } from "../model/variables";
import { resolveFontFamily, measureTextNode } from "../layout/text";
import { getLucideIconPath } from "../model/icons";
import { getSpawnAnimation } from "../interaction/animate";

const imageCache = new Map<string, HTMLImageElement>();
let imageInvalidator: (() => void) | null = null;

export function setImageInvalidator(cb: (() => void) | null): void {
  imageInvalidator = cb;
}

export function getCachedImage(url: string): HTMLImageElement | null {
  if (typeof Image === "undefined" || !url) return null;
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (imageInvalidator) imageInvalidator();
    };
    img.src = url;
    imageCache.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null;
}

export function preloadCachedImage(url: string, timeoutMs: number): Promise<void> {
  if (typeof Image === "undefined" || !url) return Promise.resolve();
  getCachedImage(url);
  const img = imageCache.get(url);
  if (!img) return Promise.resolve();
  if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => resolve();
    const timer = setTimeout(finish, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      finish();
    };
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });
}

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

function strokeCurrentPath(
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

const ICON_PATH = "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5";

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
  const fillStyle = resolveFill(ctx, data?.fill, box, variables);
  if (data?.effect) applyEffects(ctx, data.effect, variables);

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
        strokeCurrentPath(ctx, data, variables, path2d);
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
        strokeCurrentPath(ctx, data, variables);
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
      strokeCurrentPath(ctx, data, variables);
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
      const iconNode = data as IconNode;
      const iconName = iconNode?.icon || iconNode?.name || "sparkles";
      const geom = iconNode?.geometry || getLucideIconPath(iconName) || ICON_PATH;
      if (typeof Path2D !== "undefined") {
        const path2d = new Path2D(geom);
        ctx.save();
        ctx.scale(box.width / 24, box.height / 24);
        if (data?.fill) {
          const fillStyle = resolveFill(ctx, data.fill, box, variables);
          if (fillStyle) {
            ctx.fillStyle = fillStyle;
            ctx.fill(path2d);
          }
        }
        const strokeColor = resolveVariable(data?.stroke || iconNode?.fill || "$text", variables) || "#FFFFFF";
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = typeof data?.strokeWidth === "number" ? data.strokeWidth : 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke(path2d);
        ctx.restore();
      }
      break;
    }
    default: {
      const radius = data?.cornerRadius;
      if (radius && typeof ctx.roundRect === "function") {
        ctx.roundRect(0, 0, box.width, box.height, radius);
      } else {
        ctx.rect(0, 0, box.width, box.height);
      }
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }

      // If this node has an image fill, draw the cached image over it
      const imgFill = data
        ? Array.isArray(data.fill)
          ? (data.fill.find((f: any) => f?.type === "image") as ImageFill | undefined)
          : (data.fill as any)?.type === "image"
          ? (data.fill as ImageFill)
          : undefined
        : undefined;

      if (imgFill && (imgFill.url || imgFill.data)) {
        const img = getCachedImage(imgFill.url || imgFill.data!);
        if (img) {
          ctx.save();
          if (radius && typeof ctx.roundRect === "function") {
            ctx.beginPath();
            ctx.roundRect(0, 0, box.width, box.height, radius);
            ctx.clip();
          }
          const imageRatio = img.naturalWidth / img.naturalHeight;
          const boxRatio = box.width / box.height;
          const sourceWidth = imageRatio > boxRatio
            ? img.naturalHeight * boxRatio
            : img.naturalWidth;
          const sourceHeight = imageRatio > boxRatio
            ? img.naturalHeight
            : img.naturalWidth / boxRatio;
          ctx.drawImage(
            img,
            (img.naturalWidth - sourceWidth) / 2,
            (img.naturalHeight - sourceHeight) / 2,
            sourceWidth,
            sourceHeight,
            0,
            0,
            box.width,
            box.height
          );
          ctx.restore();
        }
      }

      if (data?.stroke && data?.strokeWidth) {
        paintStroke(ctx, box, data.stroke, data.strokeWidth, "center", variables);
      }
      break;
    }
  }

  if (data?.effect) clearEffects(ctx);
}

export interface PaintNodeOptions {
  skipNodeId?: string;
  animatedPositions?: Map<string, { x: number; y: number }>;
  animate?: boolean;
}

export function paintNode(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  nodeMap: Map<string, PenNode>,
  variables?: Record<string, any>,
  options: PaintNodeOptions = {}
): void {
  const { skipNodeId, animatedPositions, animate = true } = options;
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

  const spawn = animate ? getSpawnAnimation(layoutNode.id) : null;
  if (spawn) {
    ctx.globalAlpha *= spawn.opacity;
    ctx.translate(0, spawn.offsetY);
    if (spawn.scale < 0.999) {
      const cx = layoutNode.box.width / 2;
      const cy = layoutNode.box.height / 2;
      ctx.translate(cx, cy);
      ctx.scale(spawn.scale, spawn.scale);
      ctx.translate(-cx, -cy);
    }
  }

  if (data?.opacity !== undefined && data.opacity < 1) {
    ctx.globalAlpha *= data.opacity;
  }

  if (data?.clip) {
    ctx.save();
    ctx.beginPath();
    const radius = data?.cornerRadius;
    if (radius && typeof ctx.roundRect === "function") {
      ctx.roundRect(0, 0, layoutNode.box.width, layoutNode.box.height, radius);
    } else {
      ctx.rect(0, 0, layoutNode.box.width, layoutNode.box.height);
    }
    ctx.clip();
  }

  drawShape(ctx, layoutNode, data, variables);

  if (spawn && spawn.glow > 0.05 && layoutNode.type === "frame") {
    ctx.save();
    ctx.strokeStyle = `rgba(6, 182, 212, ${spawn.glow * 0.65})`;
    ctx.lineWidth = 1.5;
    const radius = data?.cornerRadius;
    if (radius && typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(0, 0, layoutNode.box.width, layoutNode.box.height, radius);
      ctx.stroke();
    } else {
      ctx.strokeRect(0, 0, layoutNode.box.width, layoutNode.box.height);
    }
    ctx.restore();
  }

  if (layoutNode.children && layoutNode.children.length > 0) {
    for (const child of layoutNode.children) {
      paintNode(ctx, child, nodeMap, variables, options);
    }
  }

  if (data?.clip) {
    ctx.restore();
  }

  ctx.restore();
}
