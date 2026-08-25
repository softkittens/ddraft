import type { TextNode } from "../model/types";
import { resolveVariable } from "../model/variables";

import {
  measureKey,
  lookupWidth,
  lookupLineHeightRatio,
  noteMeasurement,
  noteLineHeightRatio
} from "./metrics";

export interface TextMetricsResult {
  width: number;
  height: number;
  lineHeight: number;
  lines: string[];
}


let cachedCanvasCtx: CanvasRenderingContext2D | null = null;
const liveWidthCache = new Map<string, number>();
const nodeResultCache = new Map<string, TextMetricsResult>();
const NODE_RESULT_CACHE_MAX = 2048;

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

export function clearTextMetricsCaches(): void {
  liveWidthCache.clear();
  nodeResultCache.clear();
  dynamicRatioCache.clear();
}

export function resolveFontFamily(fam?: string, variables?: Record<string, any>): string {
  const raw = resolveVariable(fam || "Inter", variables);
  const clean = raw.replace(/['"]/g, "").trim();
  const formatted = clean.includes(" ") ? `'${clean}'` : clean;
  const lower = clean.toLowerCase();
  if (lower.includes("mono") || lower.includes("code") || lower.includes("monospace")) {
    return `${formatted}, monospace`;
  }
  if (
    lower.includes("serif") ||
    lower.includes("playfair") ||
    lower.includes("newsreader") ||
    lower.includes("merriweather") ||
    lower.includes("lora") ||
    lower.includes("garamond") ||
    lower.includes("georgia") ||
    lower.includes("times") ||
    lower.includes("bodoni") ||
    lower.includes("baskerville") ||
    lower.includes("cinzel")
  ) {
    return `${formatted}, serif`;
  }
  return `${formatted}, sans-serif`;
}

export function formatFontString(
  fontSize = 14,
  fontFamily = "Inter",
  fontWeight?: string | number,
  fontStyle?: string,
  variables?: Record<string, any>
): string {
  const style = fontStyle === "italic" ? "italic " : "";
  const weight = fontWeight ? `${fontWeight} ` : "";
  const family = resolveFontFamily(fontFamily, variables);
  return `${style}${weight}${fontSize}px ${family}`.trim();
}

export function measureTextWidth(
  text: string,
  fontSize = 16,
  fontFamily = "Inter",
  fontWeight?: string | number,
  letterSpacing = 0,
  variables?: Record<string, any>,
  fontStyle?: string
): number {
  const resolvedFam = resolveFontFamily(fontFamily, variables);
  const weight = fontWeight || "normal";
  const key = measureKey(text, fontSize, resolvedFam, weight, letterSpacing, fontStyle);

  // A recording, when present, is the authority. It holds what a real font engine
  // reported, so a headless run gets the same widths as the browser.
  const replayed = lookupWidth(key);
  if (replayed !== undefined) return replayed;
  const live = liveWidthCache.get(key);
  if (live !== undefined) return live;

  const ctx = getCanvasContext();
  if (ctx) {
    ctx.font = formatFontString(fontSize, fontFamily, weight, fontStyle, variables);
    const measured = Math.ceil(ctx.measureText(text).width + text.length * letterSpacing);
    liveWidthCache.set(key, measured);
    noteMeasurement(key, measured);
    return measured;
  }

  const isMono = resolvedFam.includes("Mono") || resolvedFam.includes("monospace");
  const charWidthRatio = isMono ? 0.60 : 0.49;
  const boldFactor = (weight === "bold" || weight === 700 || weight === "700") ? 1.08 : 1.0;
  return Math.round(text.length * fontSize * charWidthRatio * boldFactor);
}

/** Inter's "normal" line-height ratio, used when no font engine is reachable. */
export const DEFAULT_LINE_HEIGHT_RATIO = 1.2113;

export const dynamicRatioCache = new Map<string, number>();

export function getDynamicLineHeightRatio(fontFamily: string): number {
  const baseFam = fontFamily.replace(/['"]/g, "").split(",")[0].trim();
  const replayed = lookupLineHeightRatio(baseFam);
  if (replayed !== undefined) return replayed;
  const cached = dynamicRatioCache.get(baseFam);
  if (cached) {
    noteLineHeightRatio(baseFam, cached);
    return cached;
  }

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
      noteLineHeightRatio(baseFam, ratio);
      return ratio;
    }
  }

  noteLineHeightRatio(baseFam, DEFAULT_LINE_HEIGHT_RATIO);
  return DEFAULT_LINE_HEIGHT_RATIO;
}

function resolveExplicitLineHeight(val: number | string, fontSize: number): number | undefined {
  if (typeof val === "number") {
    if (val <= 0) return undefined;
    if (val <= 3.5) return Math.round(fontSize * val);
    return Math.max(1, Math.round(val));
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed || trimmed === "normal" || trimmed === "auto") return undefined;
    if (trimmed.endsWith("%")) {
      const pct = parseFloat(trimmed) / 100;
      if (!isNaN(pct) && pct > 0) return Math.round(fontSize * pct);
      return undefined;
    }
    const num = parseFloat(trimmed);
    if (!isNaN(num)) {
      if (num <= 0) return undefined;
      if (num <= 3.5 && !trimmed.endsWith("px")) return Math.round(fontSize * num);
      return Math.max(1, Math.round(num));
    }
  }
  return undefined;
}

export function getLineHeight(node: TextNode, variables?: Record<string, any>): number {
  const size = node.fontSize || 16;
  if (node.lineHeight !== undefined && node.lineHeight !== null) {
    const explicit = resolveExplicitLineHeight(node.lineHeight, size);
    if (explicit !== undefined) return explicit;
  }
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
  const fontWeight = node.fontWeight || "normal";
  const letterSpacing = node.letterSpacing ?? 0;
  const growth = node.textGrowth || "auto";
  const canWrap = containerWidth !== undefined || typeof node.width === "number";
  const targetWidth = canWrap ? (containerWidth ?? (typeof node.width === "number" ? node.width : 200)) : 0;

  const lineHeight = getLineHeight(node, variables);
  const resolvedFam = resolveFontFamily(fontFamily, variables);
  const fontStyle = node.fontStyle || "normal";
  const cacheKey = `${content}\0${fontSize}\0${resolvedFam}\0${fontWeight}\0${fontStyle}\0${letterSpacing}\0${growth}\0${canWrap ? 1 : 0}\0${targetWidth}\0${lineHeight}`;
  const cached = nodeResultCache.get(cacheKey);
  if (cached) return cached;

  let result: TextMetricsResult;
  if (growth === "auto" || !canWrap) {
    const width = measureTextWidth(content, fontSize, fontFamily, fontWeight, letterSpacing, variables, fontStyle);
    result = { width, height: lineHeight, lineHeight, lines: [content] };
  } else {
    const words = content.split(" ");
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = measureTextWidth(testLine, fontSize, fontFamily, fontWeight, letterSpacing, variables, fontStyle);
      if (testWidth > targetWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    result = {
      width: targetWidth,
      height: Math.max(1, lines.length) * lineHeight,
      lineHeight,
      lines
    };
  }

  if (nodeResultCache.size >= NODE_RESULT_CACHE_MAX) {
    const oldest = nodeResultCache.keys().next().value;
    if (oldest !== undefined) nodeResultCache.delete(oldest);
  }
  nodeResultCache.set(cacheKey, result);
  return result;
}

