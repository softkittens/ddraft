import type { Document, PenNode, FrameNode, TextNode, Fill } from "../model/types";
import { parseSizing } from "../model/parse";
import { childrenOf, findNode } from "../model/tree";

function formatPadding(padding: any): string {
  if (typeof padding === "number") return `p${padding}`;
  if (Array.isArray(padding)) {
    if (padding.length === 2) return `p${padding[0]}/${padding[1]}`;
    if (padding.length === 4) return `p${padding[0]}/${padding[1]}/${padding[2]}/${padding[3]}`;
  }
  return "";
}

function formatFill(fill: Fill | Fill[] | undefined): string {
  if (!fill) return "";
  if (Array.isArray(fill)) {
    const active = fill.find((f) => typeof f !== "object" || (f as any).enabled !== false) || fill[0];
    return formatFill(active);
  }
  if (typeof fill === "string") return `f:${fill}`;
  if (typeof fill === "object") {
    if (fill.type === "color" && fill.color) return `f:${fill.color}`;
    if (fill.type === "image") return "f:image";
    if (fill.type === "gradient") return "f:gradient";
  }
  return "";
}

function formatStroke(stroke: Fill | Fill[] | undefined): string {
  if (!stroke) return "";
  if (Array.isArray(stroke)) {
    const active = stroke.find((f) => typeof f !== "object" || (f as any).enabled !== false) || stroke[0];
    return formatStroke(active);
  }
  if (typeof stroke === "string") return `s:${stroke}`;
  if (typeof stroke === "object" && stroke.type === "color" && stroke.color) return `s:${stroke.color}`;
  return "";
}

function formatNode(node: PenNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const parts: string[] = [indent + node.id];

  if (node.type === "text") {
    const textNode = node as TextNode;
    const content = textNode.content ? `"${textNode.content}"` : "";
    if (content) parts.push(content);

    const size = textNode.fontSize || 16;
    const weight = textNode.fontWeight === "bold" || textNode.fontWeight === 700 ? "b" : "";
    parts.push(`t${size}${weight}`);
  } else {
    if (node.type === "icon" && (node as any).icon) parts.push(`:${(node as any).icon}`);
    if (node.name) parts.push(node.name);
    if (node.type === "frame") {
      const frame = node as FrameNode;
      if (frame.layout === "vertical") parts.push("v");
      else if (frame.layout === "horizontal") parts.push("h");

      if (frame.gap) parts.push(`g${frame.gap}`);
      const padStr = formatPadding(frame.padding);
      if (padStr) parts.push(padStr);
    } else if (node.type !== "rectangle" && !node.name) {
      parts.push(node.type);
    }
  }

  const fillStr = formatFill(node.fill);
  if (fillStr) parts.push(fillStr);

  const strokeStr = formatStroke(node.stroke);
  if (strokeStr) parts.push(strokeStr);

  const wSizing = parseSizing(node.width);
  if (wSizing.mode === "fill_container") parts.push("W");

  const hSizing = parseSizing(node.height);
  if (hSizing.mode === "fill_container") parts.push("H");

  return parts.join(" ");
}

function collect(node: PenNode, depth: number, lines: string[]): void {
  lines.push(formatNode(node, depth));
  for (const child of childrenOf(node)) collect(child, depth + 1, lines);
}

export function digest(doc: Document): string {
  const lines: string[] = [];
  if (doc.variables && Object.keys(doc.variables).length > 0) {
    const varList = Object.entries(doc.variables).map(
      ([k, v]) => `$${k}:${typeof v === "object" && v !== null && "value" in v ? (v as any).value : v}`
    );
    lines.push(`Variables: ${varList.join(" ")}`);
  }
  for (const root of doc.children) collect(root, 0, lines);
  return lines.join("\n");
}

export function digestSubtree(doc: Document, id?: string): string {
  if (!id) return digest(doc);
  const node = findNode(doc.children, id);
  if (!node) return `error: node ${id} not found`;
  const lines: string[] = [];
  collect(node, 0, lines);
  return lines.join("\n");
}
