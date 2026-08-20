import type { LayoutNode } from "../layout/types";
import type { Document, PenNode, FrameNode, TextNode } from "../model/types";
import { normalisePadding } from "../layout/padding";


export interface GapOverPaddingMetric {
  mean: number;
  spread: number;
}

export interface TypeRampMetric {
  sizes: number[];
  stepRatios: number[];
}

export interface StyleRecord {
  kind: string;
  note?: string;
  gapOverPadding: GapOverPaddingMetric;
  typeRamp: TypeRampMetric;
  spacingSteps: number[];
}

export interface MoodboardItem {
  id: string;
  record: StyleRecord;
  liked: boolean;
  timestamp: number;
}

export interface Moodboard {
  name: string;
  items: MoodboardItem[];
}

function calculateMeanAndSpread(values: number[]): { mean: number; spread: number } {
  if (values.length === 0) return { mean: 0, spread: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return { mean, spread: Math.sqrt(variance) };
}

function collectTextSizes(nodes: PenNode[]): number[] {
  const sizes = new Set<number>();
  function walk(n: PenNode) {
    if (n.type === "text") {
      const textNode = n as TextNode;
      if (textNode.fontSize) sizes.add(textNode.fontSize);
    }
    if ("children" in n && Array.isArray(n.children)) n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return Array.from(sizes).sort((a, b) => a - b);
}

/**
 * Extracts a StyleRecord from a layout tree and document.
 */
export function extract(tree: LayoutNode[], doc?: Document, kind = "dashboard", note?: string): StyleRecord {
  const gapOverPaddingRatios: number[] = [];
  const spacingSet = new Set<number>();

  const docMap = new Map<string, PenNode>();
  if (doc) {
    function index(n: PenNode) {
      docMap.set(n.id, n);
      if ("children" in n && Array.isArray(n.children)) n.children.forEach(index);
    }
    doc.children.forEach(index);
  }

  function walk(node: LayoutNode) {
    if (node.type === "frame") {
      const docNode = docMap.get(node.id) as FrameNode | undefined;
      const gap = docNode?.gap ?? 0;
      const pad = normalisePadding(docNode?.padding);

      if (gap > 0) spacingSet.add(gap);
      if (pad.top > 0) spacingSet.add(pad.top);
      if (pad.right > 0) spacingSet.add(pad.right);
      if (pad.bottom > 0) spacingSet.add(pad.bottom);
      if (pad.left > 0) spacingSet.add(pad.left);

      const meanPad = (pad.top + pad.right + pad.bottom + pad.left) / 4;
      if (gap > 0 && meanPad > 0) {
        gapOverPaddingRatios.push(gap / meanPad);
      }
    }
    node.children.forEach(walk);
  }

  tree.forEach(walk);


  const fontSizes = doc ? collectTextSizes(doc.children) : [10, 12, 14, 16];
  const stepRatios: number[] = [];
  for (let i = 0; i < fontSizes.length - 1; i++) {
    stepRatios.push(Number((fontSizes[i + 1] / fontSizes[i]).toFixed(3)));
  }

  const { mean, spread } = calculateMeanAndSpread(gapOverPaddingRatios);

  return {
    kind,
    note,
    gapOverPadding: {
      mean: Number(mean.toFixed(3)),
      spread: Number(spread.toFixed(3))
    },
    typeRamp: {
      sizes: fontSizes,
      stepRatios
    },
    spacingSteps: Array.from(spacingSet).sort((a, b) => a - b)
  };
}

/**
 * Calculates weighted geometric and typographic distance between StyleRecords.
 */
export function distance(candidate: StyleRecord, target: StyleRecord): number {
  const gapRatioDiff = Math.abs(candidate.gapOverPadding.mean - target.gapOverPadding.mean);

  let typeRampDiff = 0;
  const minLen = Math.min(candidate.typeRamp.stepRatios.length, target.typeRamp.stepRatios.length);
  if (minLen > 0) {
    let sum = 0;
    for (let i = 0; i < minLen; i++) {
      sum += Math.abs(candidate.typeRamp.stepRatios[i] - target.typeRamp.stepRatios[i]);
    }
    typeRampDiff = sum / minLen;
  } else {
    typeRampDiff = 1.0;
  }

  const setA = new Set(candidate.spacingSteps);
  const setB = new Set(target.spacingSteps);
  const union = new Set([...setA, ...setB]);
  let intersectionCount = 0;
  for (const val of setA) {
    if (setB.has(val)) intersectionCount++;
  }
  const jaccardDistance = union.size > 0 ? 1 - intersectionCount / union.size : 0;

  return Number((gapRatioDiff * 1.0 + typeRampDiff * 0.5 + jaccardDistance * 0.5).toFixed(3));
}

export function createMoodboard(name = "Default"): Moodboard {
  return { name, items: [] };
}

export function addMoodboardItem(moodboard: Moodboard, record: StyleRecord, liked: boolean): Moodboard {
  return {
    ...moodboard,
    items: [
      ...moodboard.items,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        record,
        liked,
        timestamp: Date.now()
      }
    ]
  };
}

