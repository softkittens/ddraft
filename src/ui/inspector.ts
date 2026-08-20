import type { Document, PenNode, FrameNode, TextNode } from "../model/types";
import type { LayoutNode } from "../layout/types";

export interface Field {
  label: string;
  declared: string;
  computed?: number;
  mixed: boolean;
}

function findNode(nodes: PenNode[], id: string): PenNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if ("children" in node && Array.isArray(node.children)) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

function findLayoutNode(nodes: LayoutNode[], id: string): LayoutNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children.length > 0) {
      const found = findLayoutNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Generates inspector fields for selected nodes.
 * Separates declared intent from computed layout values (Plan.md Section 9c §G2).
 */
export function inspectorFields(doc: Document, tree: LayoutNode[], ids: string[]): Field[] {
  if (ids.length === 0) return [];

  const selectedDocNodes: PenNode[] = [];
  const selectedLayoutNodes: (LayoutNode | null)[] = [];

  for (const id of ids) {
    const dNode = findNode(doc.children, id);
    if (dNode) {
      selectedDocNodes.push(dNode);
      selectedLayoutNodes.push(findLayoutNode(tree, id));
    }
  }

  if (selectedDocNodes.length === 0) return [];

  const fields: Field[] = [];

  // Width
  const widthValues = selectedDocNodes.map((n) => (n.width !== undefined ? String(n.width) : "auto"));
  const isWidthMixed = new Set(widthValues).size > 1;
  const firstLayoutWidth = selectedLayoutNodes[0]?.box.width;
  fields.push({
    label: "Width",
    declared: isWidthMixed ? "Mixed" : widthValues[0],
    computed: selectedLayoutNodes.length === 1 && firstLayoutWidth !== undefined ? firstLayoutWidth : undefined,
    mixed: isWidthMixed
  });

  // Height
  const heightValues = selectedDocNodes.map((n) => (n.height !== undefined ? String(n.height) : "auto"));
  const isHeightMixed = new Set(heightValues).size > 1;
  const firstLayoutHeight = selectedLayoutNodes[0]?.box.height;
  fields.push({
    label: "Height",
    declared: isHeightMixed ? "Mixed" : heightValues[0],
    computed: selectedLayoutNodes.length === 1 && firstLayoutHeight !== undefined ? firstLayoutHeight : undefined,
    mixed: isHeightMixed
  });

  // Gap (for frames)
  const frameNodes = selectedDocNodes.filter((n) => n.type === "frame") as FrameNode[];
  if (frameNodes.length > 0) {
    const gapValues = frameNodes.map((f) => (f.gap !== undefined ? String(f.gap) : "0"));
    const isGapMixed = new Set(gapValues).size > 1;
    fields.push({
      label: "Gap",
      declared: isGapMixed ? "Mixed" : gapValues[0],
      mixed: isGapMixed
    });
  }

  // Font size (for text)
  const textNodes = selectedDocNodes.filter((n) => n.type === "text") as TextNode[];
  if (textNodes.length > 0) {
    const sizeValues = textNodes.map((t) => (t.fontSize !== undefined ? String(t.fontSize) : "14"));
    const isSizeMixed = new Set(sizeValues).size > 1;

    fields.push({
      label: "Font Size",
      declared: isSizeMixed ? "Mixed" : sizeValues[0],
      mixed: isSizeMixed
    });
  }

  return fields;
}
