import type { TextNode } from "../model/types";
import { resolveVariable } from "../render/fills";

export interface TextMetricsResult {
  width: number;
  height: number;
  lines: string[];
}

let cachedCanvasCtx: CanvasRenderingContext2D | null = null;

function getCanvasContext(): CanvasRenderingContext2D | null {
  if (cachedCanvasCtx) return cachedCanvasCtx;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    cachedCanvasCtx = canvas.getContext("2d");
  } else if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(1, 1);
    cachedCanvasCtx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  }
  return cachedCanvasCtx;
}

export function resolveFontFamily(fam?: string, variables?: Record<string, any>): string {
  const raw = resolveVariable(fam || "Inter", variables);
  if (raw === "Geist Mono" || raw.includes("Mono")) return "'Geist Mono', monospace";
  if (raw === "Inter") return "Inter, sans-serif";
  return raw;
}

export function measureTextWidth(
  text: string,
  fontSize = 16,
  fontFamily = "Inter",
  fontWeight?: string | number,
  letterSpacing = 0,
  variables?: Record<string, any>
): number {
  const ctx = getCanvasContext();
  const resolvedFam = resolveFontFamily(fontFamily, variables);
  const weight = fontWeight || "normal";

  if (ctx) {
    ctx.font = `${weight} ${fontSize}px ${resolvedFam}`;
    return Math.ceil(ctx.measureText(text).width + text.length * letterSpacing);
  }

  const isMono = resolvedFam.includes("Mono") || resolvedFam.includes("monospace");
  const charWidthRatio = isMono ? 0.60 : 0.49;
  const boldFactor = (weight === "bold" || weight === 700 || weight === "700") ? 1.08 : 1.0;
  return Math.round(text.length * fontSize * charWidthRatio * boldFactor);
}

export const dynamicRatioCache = new Map<string, number>();

export function getDynamicLineHeightRatio(fontFamily: string): number {
  const baseFam = fontFamily.replace(/['"]/g, "").split(",")[0].trim();
  const cached = dynamicRatioCache.get(baseFam);
  if (cached) return cached;


  if (typeof document !== "undefined" && document.body) {
    const span = document.createElement("span");
    span.style.fontFamily = fontFamily;
    span.style.fontSize = "1000px";
    span.style.lineHeight = "normal";
    span.style.position = "absolute";
    span.style.visibility = "hidden";
    span.style.top = "-9999px";
    span.textContent = "Mg";
    document.body.appendChild(span);
    const ratio = span.offsetHeight / 1000;
    document.body.removeChild(span);
    if (ratio > 0.5 && ratio < 3.0) {
      dynamicRatioCache.set(baseFam, ratio);
      return ratio;
    }
  }

  return 1.2113;
}

export function getLineHeight(node: TextNode, variables?: Record<string, any>): number {
  if (node.lineHeight) return node.lineHeight;
  const size = node.fontSize || 16;
  const resolved = resolveVariable(node.fontFamily || "Inter", variables);
  const ratio = getDynamicLineHeightRatio(resolved);
  return Math.round(size * ratio);
}


export function measureTextNode(
  node: TextNode,
  containerWidth?: number,
  variables?: Record<string, any>
): TextMetricsResult {
  const content = node.content || "";
  const fontSize = node.fontSize || 16;
  const fontFamily = node.fontFamily || "Inter";
  const fontWeight = node.fontWeight;
  const lineHeight = getLineHeight(node, variables);
  const growth = node.textGrowth || "auto";
  const canWrap = containerWidth !== undefined || typeof node.width === "number";
  if (growth === "auto" || !canWrap) {
    const width = measureTextWidth(content, fontSize, fontFamily, fontWeight, node.letterSpacing ?? 0, variables);
    return { width, height: lineHeight, lines: [content] };
  }

  const targetWidth = containerWidth ?? (typeof node.width === "number" ? node.width : 200);



  const words = content.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = measureTextWidth(testLine, fontSize, fontFamily, fontWeight, node.letterSpacing ?? 0, variables);
    if (testWidth > targetWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  return {
    width: targetWidth,
    height: Math.max(1, lines.length) * lineHeight,
    lines
  };
}
