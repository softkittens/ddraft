import { createSignal, createMemo } from "solid-js";
import type { Document, PenNode } from "../model/types";
import { parseDocument } from "../model/parse";
import { createHistory, pushDocument, undo as undoDoc, redo as redoDoc, type HistoryState } from "../model/history";
import { layoutResolvedDocument } from "../layout/layout";
import { resolveInstances } from "../model/instance";
import { createCamera, zoomAtScreenPoint, type Camera } from "../interaction/camera";

export type ToolMode = "select" | "frame" | "rect" | "text";

function indexNodes(d: Document): Map<string, PenNode> {
  const map = new Map<string, PenNode>();
  function walk(n: PenNode) {
    map.set(n.id, n);
    if ("children" in n && Array.isArray(n.children)) n.children.forEach(walk);
  }
  d.children.forEach(walk);
  return map;
}

import { DEFAULT_FIXTURE_KEY, DEFAULT_FIXTURE_RAW, fetchFixtureRaw } from "./fixtures";

const initialDoc = parseDocument(DEFAULT_FIXTURE_RAW);

export const [selectedFixture, setSelectedFixture] = createSignal<string>(DEFAULT_FIXTURE_KEY);
export const [doc, setDocState] = createSignal<Document>(initialDoc);
export const [historyState, setHistoryState] = createSignal<HistoryState>(createHistory(initialDoc));
export const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set<string>());
export const [hoveredId, setHoveredId] = createSignal<string | null>(null);
export const [camera, setCamera] = createSignal<Camera>(createCamera(40, 40, 1));
export const [toolMode, setToolMode] = createSignal<ToolMode>("select");
export const [layersCollapsed, setLayersCollapsed] = createSignal<Set<string>>(new Set());

// Panel Visibility Signals
export const [layersVisible, setLayersVisible] = createSignal<boolean>(true);
export const [inspectorVisible, setInspectorVisible] = createSignal<boolean>(true);
export const [chatVisible, setChatVisible] = createSignal<boolean>(true);
export const [chatExpanded, setChatExpanded] = createSignal<boolean>(false);

export async function loadFixture(key: string) {
  setSelectedFixture(key);
  const raw = await fetchFixtureRaw(key);
  const parsed = parseDocument(raw);
  setDocState(parsed);
  setHistoryState(createHistory(parsed));
  setSelectedIds(new Set<string>());
  setCamera(createCamera(40, 40, 1));
}

// Computed Layout & Node Index
export const resolvedDoc = createMemo(() => resolveInstances(doc()));
export const nodeMap = createMemo(() => indexNodes(resolvedDoc()));
export const layoutTree = createMemo(() => layoutResolvedDocument(resolvedDoc()));

// Store Mutators & Actions
export function updateDoc(newDoc: Document, saveHistory = true) {
  setDocState(newDoc);
  if (saveHistory) {
    setHistoryState((prev) => pushDocument(prev, newDoc));
  }
}

export function handleUndo() {
  const res = undoDoc(historyState());
  if (res) {
    setHistoryState(res.history);
    setDocState(res.doc);
    setSelectedIds(new Set<string>());
  }
}

export function handleRedo() {
  const res = redoDoc(historyState());
  if (res) {
    setHistoryState(res.history);
    setDocState(res.doc);
    setSelectedIds(new Set<string>());
  }
}


export function zoomIn() {
  setCamera((c) => zoomAtScreenPoint(c, { x: window.innerWidth / 2, y: window.innerHeight / 2 }, c.zoom * 1.25));
}

export function zoomOut() {
  setCamera((c) => zoomAtScreenPoint(c, { x: window.innerWidth / 2, y: window.innerHeight / 2 }, c.zoom / 1.25));
}

export function resetZoom100() {
  setCamera((c) => zoomAtScreenPoint(c, { x: window.innerWidth / 2, y: window.innerHeight / 2 }, 1));
}

export function toggleLayerCollapse(id: string) {
  setLayersCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

export function selectNode(id: string, multi = false) {
  setSelectedIds((prev) => {
    if (!multi) return new Set([id]);
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}
