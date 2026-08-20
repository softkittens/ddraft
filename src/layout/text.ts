import type { TextNode } from "../model/types";

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

function resolveFontFamily(fam?: string): string {
  if (!fam) return "Inter, sans-serif";
  if (fam === "$font-mono" || fam === "font-mono") return "'Geist Mono', monospace";
  if (fam === "$font-body" || fam === "font-body") return "Inter, sans-serif";
  return fam.startsWith("$") ? fam.slice(1) : fam;
}

export function measureTextWidth(text: string, fontSize = 16, fontFamily = "Inter", fontWeight?: string | number): number {
  const ctx = getCanvasContext();
  const resolvedFam = resolveFontFamily(fontFamily);
  const weight = fontWeight || "normal";

  if (ctx) {
    ctx.font = `${weight} ${fontSize}px ${resolvedFam}`;
    return Math.round(ctx.measureText(text).width);
  }

  // Fallback estimation
  const isMono = resolvedFam.includes("Mono") || resolvedFam.includes("monospace");
  const charWidthRatio = isMono ? 0.60 : 0.49;
  const boldFactor = (weight === "bold" || weight === 700 || weight === "700") ? 1.08 : 1.0;
  return Math.round(text.length * fontSize * charWidthRatio * boldFactor);
}

export function getLineHeight(node: TextNode): number {
  if (node.lineHeight) return node.lineHeight;
  const size = node.fontSize || 16;
  return Math.round(size * (19 / 16));
}

export function measureTextNode(node: TextNode, containerWidth?: number): TextMetricsResult {
  const content = node.content || "";
  const fontSize = node.fontSize || 16;
  const fontFamily = node.fontFamily || "Inter";
  const fontWeight = node.fontWeight;
  const lineHeight = getLineHeight(node);
  const growth = node.textGrowth || "auto";

  if (growth === "auto") {
    const width = measureTextWidth(content, fontSize, fontFamily, fontWeight);
    return { width, height: lineHeight, lines: [content] };
  }

  const targetWidth = containerWidth ?? (typeof node.width === "number" ? node.width : 200);
  const words = content.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = measureTextWidth(testLine, fontSize, fontFamily, fontWeight);
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
