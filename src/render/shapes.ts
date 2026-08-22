import type { LayoutNode, Box } from "../layout/types";
import type {
  PenNode,
  PathNode,
  PolygonNode,
  TextNode,
  EllipseNode,
  IconNode,
  ImageFill
} from "../model/types";
import { resolveVariable } from "../model/variables";
import { resolveFontFamily, measureTextNode } from "../layout/text";
import { getLucideIconPath } from "../model/icons";
import { getCachedImage } from "./imageCache";
import {
  resolveFill,
  paintStroke,
  strokeCurrentPath,
  applyEffects,
  clearEffects
} from "./effects";

const DEFAULT_ICON_PATH = "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5";

const path2dCache = new Map<string, Path2D>();

function getOrCreatePath2D(geom: string): Path2D | null {
  if (typeof Path2D === "undefined" || !geom) return null;
  let p = path2dCache.get(geom);
  if (!p) {
    p = new Path2D(geom);
    path2dCache.set(geom, p);
  }
  return p;
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

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  box: Box,
  radius?: number | [number, number, number, number] | number[]
): void {
  ctx.save();
  if (radius && typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(0, 0, box.width, box.height, radius as any);
    ctx.clip();
  }
  const imageRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = box.width / box.height;
  const sourceWidth = imageRatio > boxRatio ? img.naturalHeight * boxRatio : img.naturalWidth;
  const sourceHeight = imageRatio > boxRatio ? img.naturalHeight : img.naturalWidth / boxRatio;
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

export function drawShape(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  data?: PenNode,
  variables?: Record<string, any>,
  zoom = 1
): void {
  const { box } = layoutNode;
  const fillStyle = resolveFill(ctx, data?.fill, box, variables);
  if (data?.effect) applyEffects(ctx, data.effect, variables, zoom);

  ctx.beginPath();
  switch (layoutNode.type) {
    case "path": {
      const pathNode = data as PathNode;
      if (pathNode?.geometry) {
        const path2d = getOrCreatePath2D(pathNode.geometry);
        if (path2d) {
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
        const size = textNode.fontSize || 14;
        // Text LOD: skip glyph rasterization when text footprint is subpixel (< 2.5 screen pixels)
        if (zoom && size * zoom < 2.5) {
          break;
        }

        const fam = resolveFontFamily(textNode.fontFamily, variables);
        const weight = textNode.fontWeight || "normal";
        ctx.font = `${weight} ${size}px ${fam}`;
        const defaultTextFill = resolveVariable("$foreground-primary", variables) || "#1e293b";
        ctx.fillStyle = resolveVariable(textNode.fill, variables) || defaultTextFill;
        ctx.textBaseline = "middle";

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
        let curY = metrics.lineHeight / 2;
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
      const geom = iconNode?.geometry || getLucideIconPath(iconName) || DEFAULT_ICON_PATH;
      const path2d = getOrCreatePath2D(geom);
      if (path2d) {
        ctx.save();
        ctx.scale(box.width / 24, box.height / 24);
        if (data?.fill) {
          const iconFill = resolveFill(ctx, data.fill, box, variables);
          if (iconFill) {
            ctx.fillStyle = iconFill;
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
        if (img) drawImageCover(ctx, img, box, radius);
      }

      if (data?.stroke && data?.strokeWidth) {
        paintStroke(ctx, box, data.stroke, data.strokeWidth, "center", variables, radius);
      }
      break;
    }
  }

  if (data?.effect) clearEffects(ctx);
}
