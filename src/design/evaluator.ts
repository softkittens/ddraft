import type { LayoutNode, Box } from "../layout/types";
import type { Document, TextNode, PenNode, FrameNode } from "../model/types";

export interface Finding {
  rule: "collision" | "overflow" | "clipping" | "unreadable_size" | "off_canvas";
  nodeId: string;
  message: string;
}

export interface EvaluatorBMetrics {
  deadSpaceRatio: number;
  alignmentResidual: number;
  spacingConformance: number;
  typeConformance: number;
  contrastRatioMin: number;
  collisionCount: number;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function checkCollision(nodes: LayoutNode[]): Finding[] {
  const findings: Finding[] = [];

  function checkSiblings(siblings: LayoutNode[]) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i];
        const b = siblings[j];
        if (a.box.width > 0 && a.box.height > 0 && b.box.width > 0 && b.box.height > 0) {
          if (boxesOverlap(a.box, b.box)) {
            findings.push({
              rule: "collision",
              nodeId: a.id,
              message: `Node "${a.id}" collides with sibling "${b.id}"`
            });
          }
        }
      }
      if (siblings[i].children.length > 0) {
        checkSiblings(siblings[i].children);
      }
    }
  }

  checkSiblings(nodes);
  return findings;
}

export function checkOverflow(nodes: LayoutNode[]): Finding[] {
  const findings: Finding[] = [];

  function walk(parent: LayoutNode) {
    if (parent.type === "frame" && parent.box.width > 0 && parent.box.height > 0) {
      for (const child of parent.children) {
        const overflowsX = child.box.x < 0 || child.box.x + child.box.width > parent.box.width + 1.0;
        const overflowsY = child.box.y < 0 || child.box.y + child.box.height > parent.box.height + 1.0;
        if (overflowsX || overflowsY) {
          findings.push({
            rule: "overflow",
            nodeId: child.id,
            message: `Child "${child.id}" overflows parent "${parent.id}" bounds`
          });
        }
      }
    }
    for (const child of parent.children) {
      walk(child);
    }
  }

  for (const root of nodes) {
    walk(root);
  }
  return findings;
}

export function checkClipping(nodes: LayoutNode[]): Finding[] {
  const findings: Finding[] = [];

  function walk(parent: LayoutNode) {
    if (parent.type === "frame" && (parent as any).clip) {
      for (const child of parent.children) {

        const clippedX = child.box.x < 0 || child.box.x + child.box.width > parent.box.width;
        const clippedY = child.box.y < 0 || child.box.y + child.box.height > parent.box.height;
        if (clippedX || clippedY) {
          findings.push({
            rule: "clipping",
            nodeId: child.id,
            message: `Child "${child.id}" is clipped by frame "${parent.id}"`
          });
        }
      }
    }
    for (const child of parent.children) {
      walk(child);
    }
  }

  for (const root of nodes) {
    walk(root);
  }
  return findings;
}

export function checkUnreadableSize(nodesOrTree: any, doc?: Document): Finding[] {
  const document = doc || (nodesOrTree && "children" in nodesOrTree ? (nodesOrTree as Document) : undefined);
  const findings: Finding[] = [];
  if (!document) return findings;

  function walk(n: PenNode) {
    if (n.type === "text") {
      const textNode = n as TextNode;
      if (textNode.fontSize !== undefined && textNode.fontSize < 9) {
        findings.push({
          rule: "unreadable_size",
          nodeId: n.id,
          message: `Text node "${n.id}" has unreadable font size ${textNode.fontSize}px (< 9px)`
        });
      }
    }
    if ("children" in n && Array.isArray(n.children)) {
      n.children.forEach(walk);
    }
  }

  document.children.forEach(walk);
  return findings;
}

export function checkOffCanvas(nodes: LayoutNode[]): Finding[] {
  const findings: Finding[] = [];

  for (const root of nodes) {
    if (root.box.x < 0 || root.box.y < 0) {
      findings.push({
        rule: "off_canvas",
        nodeId: root.id,
        message: `Node "${root.id}" is placed off canvas (${root.box.x}, ${root.box.y})`
      });
    }
  }
  return findings;
}

export function evaluateLayoutConstraints(tree: LayoutNode[], doc: Document): Finding[] {
  return [
    ...checkCollision(tree),
    ...checkOverflow(tree),
    ...checkClipping(tree),
    ...checkUnreadableSize(doc),
    ...checkOffCanvas(tree)
  ];
}


function parseHexColor(colorStr: string): { r: number; g: number; b: number } | null {
  if (!colorStr.startsWith("#")) return null;
  const hex = colorStr.slice(1);
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16)
    };
  }
  if (hex.length >= 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }
  return null;
}

function getRelativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function computeWCAGContrast(fgColor: string, bgColor: string): number {
  const fg = parseHexColor(fgColor);
  const bg = parseHexColor(bgColor);
  if (!fg || !bg) return 4.5;
  const l1 = getRelativeLuminance(fg);
  const l2 = getRelativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function evaluateB(tree: LayoutNode[], doc: Document): EvaluatorBMetrics {
  let totalContainerArea = 0;
  let totalChildArea = 0;
  const siblingXOffsets = new Set<number>();
  const spacingValues = new Set<number>();
  const fontSizes = new Set<number>();
  let minContrast = 21.0;

  const nodeMap = new Map<string, PenNode>();
  function indexNodes(n: PenNode) {
    nodeMap.set(n.id, n);
    if ("children" in n && Array.isArray(n.children)) n.children.forEach(indexNodes);
  }
  doc.children.forEach(indexNodes);

  function walk(node: LayoutNode, parentBg = "#ffffff") {
    const docNode = nodeMap.get(node.id);
    let currentBg = parentBg;
    if (docNode && "fill" in docNode && typeof docNode.fill === "string") {
      currentBg = docNode.fill;
    }

    if (node.type === "frame" && node.children.length > 0) {
      const containerArea = node.box.width * node.box.height;
      let childrenArea = 0;

      for (const child of node.children) {
        childrenArea += child.box.width * child.box.height;
        siblingXOffsets.add(Math.round(child.box.x));
      }

      totalContainerArea += containerArea;
      totalChildArea += Math.min(childrenArea, containerArea);

      const frameNode = docNode as FrameNode;
      if (frameNode) {
        if (frameNode.gap !== undefined && typeof frameNode.gap === "number") spacingValues.add(frameNode.gap);
        if (frameNode.padding !== undefined && typeof frameNode.padding === "number") spacingValues.add(frameNode.padding);
      }
    }

    if (node.type === "text") {
      const textNode = docNode as TextNode;
      if (textNode) {
        if (textNode.fontSize) fontSizes.add(textNode.fontSize);
        const textFill = typeof textNode.fill === "string" ? textNode.fill : "#000000";
        const contrast = computeWCAGContrast(textFill, parentBg);
        if (contrast < minContrast) minContrast = contrast;
      }
    }

    for (const child of node.children) {
      walk(child, currentBg);
    }
  }

  tree.forEach((r) => walk(r));

  const collisions = checkCollision(tree);
  const deadSpace = totalContainerArea > 0 ? (totalContainerArea - totalChildArea) / totalContainerArea : 0;

  return {
    deadSpaceRatio: Number(deadSpace.toFixed(3)),
    alignmentResidual: siblingXOffsets.size,
    spacingConformance: spacingValues.size,
    typeConformance: fontSizes.size,
    contrastRatioMin: Number(minContrast.toFixed(2)),
    collisionCount: collisions.length
  };
}
