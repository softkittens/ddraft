import { createSignal, createMemo, createRoot, createEffect, on } from "solid-js";
import type { Document } from "../model/types";
import { createHistory, pushDocument, undo as undoDoc, redo as redoDoc, type HistoryState } from "../model/history";
import { removeNode } from "../model/edit";
import { layoutResolvedDocument } from "../layout/layout";
import { resolveInstances } from "../model/instance";
import { createCamera, zoomAtScreenPoint, calculateFitCamera, type Camera } from "../interaction/camera";
import { indexDocument } from "../model/tree";
import { createDefaultDocument } from "../model/defaultDocument";
import { loadSession, saveSession, clearSession, flushSession, type ChatSnapshot } from "./persist";

export type ToolMode = "select" | "frame" | "rect" | "text";

const initialDoc = createDefaultDocument();

export const [doc, setDocState] = createSignal<Document>(initialDoc);
export const [historyState, setHistoryState] = createSignal<HistoryState>(createHistory(initialDoc));
export const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set<string>());
export const [hoveredId, setHoveredId] = createSignal<string | null>(null);
export const [camera, setCamera] = createSignal<Camera>(createCamera(40, 40, 1));
export const [toolMode, setToolMode] = createSignal<ToolMode>("select");
export const [layersCollapsed, setLayersCollapsed] = createSignal<Set<string>>(new Set());

export const [layersVisible, setLayersVisible] = createSignal<boolean>(false);
export const [inspectorVisible, setInspectorVisible] = createSignal<boolean>(false);
export const [chatVisible, setChatVisible] = createSignal<boolean>(true);
export const [chatExpanded, setChatExpanded] = createSignal<boolean>(true);
export const [editingTextId, setEditingTextId] = createSignal<string | null>(null);

export const { resolvedDoc, nodeMap, layoutTree } = createRoot(() => {
  const resolvedDoc = createMemo(() => resolveInstances(doc()));
  const nodeMap = createMemo(() => indexDocument(resolvedDoc()));
  const layoutTree = createMemo(() => layoutResolvedDocument(resolvedDoc()));
  return { resolvedDoc, nodeMap, layoutTree };
});

export function updateDoc(newDoc: Document) {
  if (newDoc === doc()) return;
  setDocState(newDoc);
  setHistoryState((prev) => pushDocument(prev, newDoc));
}

let cameraAnimFrame: number | null = null;

export function animateCameraTo(target: Camera, duration = 380): void {
  if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") {
    setCamera(target);
    return;
  }
  if (cameraAnimFrame !== null) {
    cancelAnimationFrame(cameraAnimFrame);
    cameraAnimFrame = null;
  }
  const start = camera();
  const startTime = performance.now();

  function step(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const t = 1 - Math.pow(1 - progress, 3); // easeOutCubic

    setCamera({
      x: start.x + (target.x - start.x) * t,
      y: start.y + (target.y - start.y) * t,
      zoom: start.zoom + (target.zoom - start.zoom) * t
    });

    if (progress < 1) {
      cameraAnimFrame = requestAnimationFrame(step);
    } else {
      cameraAnimFrame = null;
    }
  }

  cameraAnimFrame = requestAnimationFrame(step);
}

export function zoomToFit(options: { animate?: boolean; padding?: number } = {}) {
  const tree = layoutTree();
  if (!tree || tree.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const root of tree) {
    minX = Math.min(minX, root.box.x);
    minY = Math.min(minY, root.box.y);
    maxX = Math.max(maxX, root.box.x + root.box.width);
    maxY = Math.max(maxY, root.box.y + root.box.height);
  }

  if (minX === Infinity || maxX <= minX || maxY <= minY) return;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const isChatOpen = chatVisible() && chatExpanded();
  const leftPad = isChatOpen ? Math.min(410, vw * 0.35) : 60;
  const rightPad = inspectorVisible() ? 280 : 60;

  const target = calculateFitCamera(
    { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    {
      width: vw,
      height: vh,
      leftPadding: leftPad,
      rightPadding: rightPad,
      topPadding: 70,
      bottomPadding: 60
    }
  );

  if (options.animate !== false) {
    animateCameraTo(target);
  } else {
    setCamera(target);
  }
}

/* ------------------------------------------------------------------ *
 * Session persistence
 * ------------------------------------------------------------------ */

/**
 * The chat's own state, handed here so it can be saved and restored with the
 * canvas it describes. The transcript lives in useChatSession; this is the
 * copy that survives a refresh, and the seed that hook reads on mount.
 */
export const [restoredChat, setRestoredChat] = createSignal<ChatSnapshot | null>(null);

/** Bumped by resetCanvas, so the chat hook knows to empty itself. */
export const [resetToken, setResetToken] = createSignal(0);

/**
 * True once the stored session has been read, whether or not one was found.
 *
 * Saving is held until then. The document signal starts as an empty default
 * because a signal cannot be initialised from an async read, and writing that
 * empty default over a real canvas during the few milliseconds the IndexedDB
 * read takes would lose the work this feature exists to keep.
 */
const [hydrated, setHydrated] = createSignal(false);
export const sessionReady = hydrated;

/** Long enough for a real read, short enough that a wedged database still boots. */
const HYDRATE_TIMEOUT_MS = 2000;

export async function hydrateSession(): Promise<void> {
  try {
    const saved = await Promise.race([
      loadSession(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), HYDRATE_TIMEOUT_MS))
    ]);
    if (saved) {
      setDocState(saved.doc);
      setHistoryState(createHistory(saved.doc));
      if (saved.camera) setCamera(saved.camera);
      if (saved.chat) setRestoredChat(saved.chat);
    }
  } finally {
    // A failed read must not leave the app unable to save for the rest of the
    // session, so this is reached on both paths.
    setHydrated(true);
  }
}

export function persistChat(snapshot: ChatSnapshot): void {
  if (!hydrated()) return;
  saveSession({ chat: snapshot });
}

createRoot(() => {
  createEffect(
    on([doc, camera], ([currentDoc, currentCamera]) => {
      if (!hydrated()) return;
      saveSession({ doc: currentDoc, camera: currentCamera });
    })
  );
});

if (typeof window !== "undefined") {
  // A debounced save can still be waiting when the tab closes. pagehide fires
  // for a real close and for the back-forward cache, which visibilitychange
  // alone does not cover on Safari.
  window.addEventListener("pagehide", () => void flushSession());
}

/**
 * Empty the canvas, the transcript, and the stored copy of both.
 *
 * The undo stack goes too. Keeping it would make Cmd+Z bring back a design the
 * user just confirmed they wanted gone, while the stored session said it was
 * empty — two answers to the same question.
 */
export async function resetCanvas(): Promise<void> {
  const fresh = createDefaultDocument();
  setDocState(fresh);
  setHistoryState(createHistory(fresh));
  setSelectedIds(new Set<string>());
  setHoveredId(null);
  setEditingTextId(null);
  setCamera(createCamera(40, 40, 1));
  setRestoredChat(null);
  setResetToken((n) => n + 1);
  await clearSession();
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

export function deleteSelectedNodes() {
  const ids = selectedIds();
  if (ids.size === 0) return;
  let nextDoc = doc();
  for (const rawId of ids) {
    const targetId = rawId.includes(":") ? rawId.split(":")[0] : rawId;
    nextDoc = removeNode(nextDoc, targetId);
  }
  setSelectedIds(new Set<string>());
  if (nextDoc !== doc()) {
    updateDoc(nextDoc);
  }
}

export function deleteNodeById(rawId: string) {
  const targetId = rawId.includes(":") ? rawId.split(":")[0] : rawId;
  const nextDoc = removeNode(doc(), targetId);
  setSelectedIds((prev) => {
    const next = new Set(prev);
    next.delete(rawId);
    next.delete(targetId);
    return next;
  });
  if (nextDoc !== doc()) {
    updateDoc(nextDoc);
  }
}
