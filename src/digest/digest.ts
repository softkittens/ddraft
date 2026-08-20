import type { Document, PenNode, FrameNode, TextNode } from "../model/types";
import { parseSizing } from "../model/parse";

function formatPadding(padding: any): string {
  if (typeof padding === "number") return `p${padding}`;
  if (Array.isArray(padding)) {
    if (padding.length === 2) return `p${padding[0]}/${padding[1]}`;
    if (padding.length === 4) return `p${padding[0]}/${padding[1]}/${padding[2]}/${padding[3]}`;
  }
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
    if (node.name) parts.push(node.name);
    if (node.type === "frame") {
      const frame = node as FrameNode;
      if (frame.layout === "vertical") parts.push("v");
      else if (frame.layout === "horizontal") parts.push("h");

      if (frame.gap) parts.push(`g${frame.gap}`);
      const padStr = formatPadding(frame.padding);
      if (padStr) parts.push(padStr);
    }
  }

  const wSizing = parseSizing(node.width);
  if (wSizing.mode === "fill_container") parts.push("W");

  const hSizing = parseSizing(node.height);
  if (hSizing.mode === "fill_container") parts.push("H");

  return parts.join(" ");
}

/**
 * Generates a compact structural digest of the document tree.
 * Reduces token cost by >85% while preserving node IDs and layout structure.
 *
 * Known limitation: Drops individual vector coordinates, effect details,
 * and exact color values to optimize for structural layout decisions.
 */
export function digest(doc: Document): string {
  const lines: string[] = [];

  function walk(node: PenNode, depth: number) {
    lines.push(formatNode(node, depth));
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child, depth + 1);
      }
    }
  }

  for (const root of doc.children) {
    walk(root, 0);
  }

  return lines.join("\n");
}

export const extractDigest = digest;

