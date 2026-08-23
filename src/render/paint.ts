import type { LayoutNode } from "../layout/types";
import type { PenNode } from "../model/types";
import { getSpawnAnimation } from "../interaction/animate";
import { drawShape, setupCanvas } from "./shapes";
import {
  resolveFill,
  paintStroke,
  applyEffects,
  clearEffects,
  resolveVariable,
  type Fill,
  type ColorStop,
  type Effect,
  type ShadowEffect,
  type BlurEffect,
  type StrokeAlignment
} from "./effects";
import {
  setImageInvalidator,
  getCachedImage,
  preloadCachedImage
} from "./imageCache";

export {
  resolveFill,
  paintStroke,
  applyEffects,
  clearEffects,
  resolveVariable,
  setupCanvas,
  drawShape,
  setImageInvalidator,
  getCachedImage,
  preloadCachedImage
};

export type {
  Fill,
  ColorStop,
  Effect,
  ShadowEffect,
  BlurEffect,
  StrokeAlignment
};

export interface PaintNodeOptions {
  skipNodeId?: string;
  animatedPositions?: Map<string, { x: number; y: number }>;
  animate?: boolean;
  zoom?: number;
  worldX?: number;
  worldY?: number;
  viewBounds?: { left: number; top: number; right: number; bottom: number };
}

export function paintNode(
  ctx: CanvasRenderingContext2D,
  layoutNode: LayoutNode,
  nodeMap: Map<string, PenNode>,
  variables?: Record<string, any>,
  options: PaintNodeOptions = {}
): void {
  const { skipNodeId, animatedPositions, animate = true, zoom = 1, worldX = 0, worldY = 0, viewBounds } = options;
  const data = nodeMap.get(layoutNode.id);
  if (data?.enabled === false) return;
  if (layoutNode.id === skipNodeId) return;

  const animPos = animatedPositions?.get(layoutNode.id);
  const posX = animPos ? animPos.x : layoutNode.box.x;
  const posY = animPos ? animPos.y : layoutNode.box.y;
  const curWorldX = worldX + posX;
  const curWorldY = worldY + posY;

  // Frustum culling: skip children entirely outside the viewport
  if (viewBounds) {
    if (
      curWorldX + layoutNode.box.width < viewBounds.left ||
      curWorldX > viewBounds.right ||
      curWorldY + layoutNode.box.height < viewBounds.top ||
      curWorldY > viewBounds.bottom
    ) {
      return;
    }
  }

  // Sub-pixel culling: skip rendering shapes smaller than 0.35 screen pixels
  if (zoom && layoutNode.box.width * zoom < 0.35 && layoutNode.box.height * zoom < 0.35) {
    return;
  }

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

  if (data?.flipX || data?.flipY) {
    const scaleX = data.flipX ? -1 : 1;
    const scaleY = data.flipY ? -1 : 1;
    const cx = layoutNode.box.width / 2;
    const cy = layoutNode.box.height / 2;
    ctx.translate(cx, cy);
    ctx.scale(scaleX, scaleY);
    ctx.translate(-cx, -cy);
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

  drawShape(ctx, layoutNode, data, variables, zoom);

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
    const childOpts: PaintNodeOptions = {
      ...options,
      worldX: curWorldX,
      worldY: curWorldY,
      zoom,
      viewBounds
    };
    for (const child of layoutNode.children) {
      paintNode(ctx, child, nodeMap, variables, childOpts);
    }
  }

  if (data?.clip) {
    ctx.restore();
  }

  ctx.restore();
}
