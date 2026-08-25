import { createSignal, createMemo, createRoot, createEffect, on } from "solid-js";
import type { Document } from "../model/types";
import { createHistory, pushDocument, undo as undoDoc, redo as redoDoc, type HistoryState } from "../model/history";
import { removeNode, duplicateNode } from "../model/edit";
import { applyProperty, type ApplyPropertyResult } from "../model/properties";
import {
  documentColorsInUse,
  documentFonts,
  documentRadiusScale,
  documentSpacingScale,
  documentSwatches,
  documentTypeScale,
  DEFAULT_RADIUS_SCALE,
  DEFAULT_SPACING_SCALE,
  DEFAULT_TYPE_SCALE
} from "../model/tokens";
import { copyNodes, pasteNodes, type ClipboardContents } from "../model/clipboard";
import { layoutResolvedDocument } from "../layout/layout";
import { resolveInstances, setInstanceProperty, splitInstanceId } from "../model/instance";
import { createCamera, zoomAtScreenPoint, calculateFitCamera, type Camera } from "../interaction/camera";
import { indexDocument } from "../model/tree";
import { createDefaultDocument } from "../model/defaultDocument";
import {
  IMPLICIT_PAGE_ID,
  declarePage,
  nextPageId,
  pageScopedDocument,
  pagesOf,
  removePage as removePageFromDoc,
  renamePage as renamePageInDoc,
  setPageOf
} from "../model/pages";
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
export const [agentRunning, setAgentRunning] = createSignal<boolean>(false);
export const [editingTextId, setEditingTextId] = createSignal<string | null>(null);

/**
 * The page being worked on, or undefined for "whichever comes first".
 *
 * Held as an id rather than a page object because pages are derived from the
 * document on every change. Holding the object would mean reconciling a stale
 * copy after every edit; holding the id means a page that stops existing
 * silently resolves to the first one instead.
 */
export const [activePageId, setActivePageId] = createSignal<string | undefined>(undefined);

export const { resolvedDoc, nodeMap, layoutTree, pages, activePage, activeScreens } = createRoot(() => {
  const pages = createMemo(() => pagesOf(doc()));
  const activePage = createMemo(() => {
    const list = pages();
    if (list.length === 0) return undefined;
    return list.find((page) => page.id === activePageId()) ?? list[0];
  });
  // Falling back to the whole child list rather than to nothing: a document
  // that somehow resolves to no pages should still show its screens.
  const activeScreens = createMemo(() => activePage()?.screens ?? doc().children);

  /*
   * The canvas draws one page.
   *
   * Everything downstream of this memo — the painter, hit testing, the node
   * map, the inspector, zoom-to-fit — narrows with it, which is what makes a
   * page a page rather than a filter on a list. It also gives each page its own
   * coordinate space: two pages may both place a screen at x=0 without drawing
   * on top of each other, the way they would if the canvas showed everything.
   */
  const resolvedDoc = createMemo(() => resolveInstances(pageScopedDocument(doc(), activePage()?.id)));
  const nodeMap = createMemo(() => indexDocument(resolvedDoc()));
  const layoutTree = createMemo(() => layoutResolvedDocument(resolvedDoc()));
  return { resolvedDoc, nodeMap, layoutTree, pages, activePage, activeScreens };
});

/*
 * What the editing controls offer.
 *
 * Derived from the document rather than from the style catalog, so a file that
 * came from somewhere else still offers its own colours and its own sizes. A
 * control that offered a colour wheel and a numeric field would let a person
 * hand-make the exact findings the audit raises against the agent — an off-
 * palette hex, a fifteenth font size — so the tokens come first and the free
 * value is the deliberate second choice.
 */
/**
 * Two lists are the same list when they hold the same values in the same order.
 *
 * The token functions build fresh objects on every call, and the document they
 * read is deep-cloned on every write, so without this each memo emitted a new
 * array for every keystroke — and `<For>`, which diffs by reference, tore down
 * and rebuilt every swatch button underneath it. That loses hover and focus
 * mid-interaction and restarts every transition.
 */
function sameList<T>(key: (item: T) => string) {
  return (a: readonly T[], b: readonly T[]): boolean =>
    a.length === b.length && a.every((item, i) => key(item) === key(b[i]));
}

const sameSwatches = sameList<{ token: string; value: string }>((s) => `${s.token}|${s.value}`);
const sameNumbers = sameList<number>(String);

export const { swatches, fonts, typeScale, spacingScale, radiusScale } = createRoot(() => {
  // Tokens when the document has them. A file that never ran set_style — an
  // import, or anything built by hand — falls back to the colours it already
  // paints with, so the control is never an empty row.
  const swatches = createMemo(
    () => {
      const tokens = documentSwatches(doc());
      return tokens.length > 0 ? tokens : documentColorsInUse(activeScreens());
    },
    undefined,
    { equals: sameSwatches }
  );
  const fonts = createMemo(() => documentFonts(doc()), undefined, { equals: sameSwatches });
  // Scoped to the page, which is the working context. A document that has not
  // said anything yet gets a starting scale rather than an empty row.
  const typeScale = createMemo(
    () => {
      const scale = documentTypeScale(activeScreens());
      return scale.length > 0 ? scale : DEFAULT_TYPE_SCALE;
    },
    undefined,
    { equals: sameNumbers }
  );
  const spacingScale = createMemo(
    () => {
      const scale = documentSpacingScale(activeScreens());
      return scale.length > 0 ? scale : DEFAULT_SPACING_SCALE;
    },
    undefined,
    { equals: sameNumbers }
  );
  const radiusScale = createMemo(
    () => {
      const scale = documentRadiusScale(activeScreens());
      return scale.length > 0 ? scale : DEFAULT_RADIUS_SCALE;
    },
    undefined,
    { equals: sameNumbers }
  );
  return { swatches, fonts, typeScale, spacingScale, radiusScale };
});

/* ------------------------------------------------------------------ *
 * Edits
 * ------------------------------------------------------------------ */

/**
 * A live edit in progress, or null when writes commit one at a time.
 *
 * `dirty` records whether anything was actually written, so a drag that ends
 * where it started leaves no undo step behind.
 */
let liveEdit: { dirty: boolean } | null = null;

/**
 * Write a document and, unless an edit is open, make it an undo step.
 *
 * Every action in this file goes through here, so opening an edit around a
 * gesture is enough to make that whole gesture one step — no action needs to
 * know it is being dragged.
 */
export function updateDoc(newDoc: Document) {
  if (newDoc === doc()) return;
  setDocState(newDoc);
  if (liveEdit) {
    liveEdit.dirty = true;
    return;
  }
  setHistoryState((prev) => pushDocument(prev, newDoc));
}

/**
 * Start a gesture that will write many times and should undo once.
 *
 * A slider dragged across twenty pixels writes forty documents. Each one is a
 * full deep clone onto the undo stack, and each one is a separate Cmd+Z, so
 * without this every continuous control is both slow and unusable.
 *
 * Re-entry keeps the open edit rather than nesting it. Two controls both
 * beginning still means one step.
 */
export function beginEdit(): void {
  if (!liveEdit) liveEdit = { dirty: false };
}

/**
 * Close the gesture and record it as a single step.
 *
 * This works because nothing pushed while the edit was open: `historyState()`
 * still holds the document as it stood at `beginEdit`, so pushing the current
 * one puts exactly the right pair on the stack.
 */
export function endEdit(): void {
  const edit = liveEdit;
  // Cleared first. A wedged edit means no undo entries for the rest of the
  // session, which is a far worse failure than a lost step.
  liveEdit = null;
  if (!edit?.dirty) return;
  setHistoryState((prev) => pushDocument(prev, doc()));
}

export function isEditing(): boolean {
  return liveEdit !== null;
}

/**
 * Run a group of writes as one undo step, joining an edit already in progress.
 *
 * `endEdit` closes whatever is open on the first call — deliberately, so a
 * control that forgets to end cannot wedge undo for the rest of the session.
 * The cost is that a helper which brackets its own writes will close a gesture
 * it knows nothing about. That is not hypothetical: the size field opens an
 * edit on focus, and the helper it calls per keystroke used to close it again,
 * turning one typed number into four undo steps.
 *
 * So callers that write several properties at once use this instead of
 * bracketing by hand. Alone it is one step; inside a gesture it is part of it.
 */
export function asOneEdit(writes: () => void): void {
  if (isEditing()) {
    writes();
    return;
  }
  beginEdit();
  try {
    writes();
  } finally {
    endEdit();
  }
}

/**
 * Set a property on the selection, or on the ids given.
 *
 * The result carries what was written, what was skipped, and why a value was
 * rewritten or refused, so a control can say so instead of appearing to do
 * nothing.
 */
export function setNodeProperty(
  property: string,
  value: unknown,
  ids: Iterable<string> = selectedIds()
): ApplyPropertyResult {
  const result = applyProperty(doc(), ids, property, value);
  updateDoc(result.doc);
  return result;
}

let cameraAnimFrame: number | null = null;

export function stopCameraAnimation(): void {
  if (cameraAnimFrame === null) return;
  cancelAnimationFrame(cameraAnimFrame);
  cameraAnimFrame = null;
}

export function animateCameraTo(target: Camera, duration = 380): void {
  if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") {
    setCamera(target);
    return;
  }
  stopCameraAnimation();
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

  // No page filter needed: layoutTree is already the active page.

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
  let restored = false;
  try {
    const saved = await Promise.race([
      loadSession(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), HYDRATE_TIMEOUT_MS))
    ]);
    if (saved) {
      restored = true;
      setDocState(saved.doc);
      setHistoryState(createHistory(saved.doc));
      if (saved.camera) setCamera(saved.camera);
      if (saved.chat) setRestoredChat(saved.chat);
      if (saved.activePageId) setActivePageId(saved.activePageId);
    }
  } finally {
    // A failed read must not leave the app unable to save for the rest of the
    // session, so this is reached on both paths.
    setHydrated(true);
    if (!restored) {
      saveSession({ doc: doc(), camera: camera(), activePageId: activePageId() });
    }
  }
}

export function persistChat(snapshot: ChatSnapshot): void {
  if (!hydrated()) return;
  saveSession({ chat: snapshot });
}

createRoot(() => {
  createEffect(
    on([doc, activePageId], ([currentDoc, page]) => {
      if (!hydrated()) return;
      saveSession({ doc: currentDoc, camera: camera(), activePageId: page });
    })
  );
  createEffect(
    on(camera, (currentCamera) => {
      if (!hydrated()) return;
      saveSession({ camera: currentCamera });
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
  // Dropped rather than closed: the document it was measured against is gone.
  liveEdit = null;
  const fresh = createDefaultDocument();
  setDocState(fresh);
  setHistoryState(createHistory(fresh));
  setSelectedIds(new Set<string>());
  setHoveredId(null);
  setEditingTextId(null);
  setCamera(createCamera(40, 40, 1));
  setActivePageId(undefined);
  setRestoredChat(null);
  setResetToken((n) => n + 1);
  await clearSession();
}

export function handleUndo() {
  // An edit still open is a step the user has finished making, whatever the
  // control forgot to say. Close it, then undo it.
  endEdit();
  const res = undoDoc(historyState());
  if (res) {
    setHistoryState(res.history);
    setDocState(res.doc);
    setSelectedIds(new Set<string>());
  }
}

export function handleRedo() {
  endEdit();
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

export function resetZoom100(options: { animate?: boolean } = {}) {
  const cx = typeof window !== "undefined" ? window.innerWidth / 2 : 720;
  const cy = typeof window !== "undefined" ? window.innerHeight / 2 : 450;
  const target = zoomAtScreenPoint(camera(), { x: cx, y: cy }, 1);
  if (options.animate) {
    animateCameraTo(target);
  } else {
    setCamera(target);
  }
}

/* ------------------------------------------------------------------ *
 * Pages
 *
 * A page is a label on a top-level frame, not a container, so every action
 * here is an ordinary document edit and every one of them is undoable.
 * ------------------------------------------------------------------ */

/**
 * Add a page and switch to it. Returns the new page's id.
 *
 * Adding a second page first turns the loose screens into a real first page.
 * Without that they stay implicit, and the implicit page is called "Unassigned"
 * as soon as it has company — so the page the user had been calling Page 1
 * silently renames itself the moment they add Page 2. Giving those screens a
 * label keeps the name they already had.
 */
export function addPage(): string {
  let current = doc();
  const loose = pagesOf(current).find((page) => page.implicit);
  if (loose && loose.screens.length > 0) {
    const firstId = nextPageId(current);
    for (const screen of loose.screens) current = setPageOf(current, screen.id, firstId);
    current = declarePage(current, firstId, loose.name);
  }

  const id = nextPageId(current);
  current = declarePage(current, id, `Page ${pagesOf(current).length + 1}`);
  updateDoc(current);
  setActivePageId(id);
  return id;
}

export function renamePageById(id: string, name: string): void {
  const next = renamePageInDoc(doc(), id, name);
  if (next !== doc()) updateDoc(next);
}

/**
 * Drop a page. Its screens stay on the canvas, unassigned — deleting the label
 * a screen carries is not a reason to delete the screen.
 */
export function removePageById(id: string): void {
  const next = removePageFromDoc(doc(), id);
  if (next !== doc()) updateDoc(next);
  if (activePageId() === id) setActivePageId(undefined);
}

/** Move a top-level screen onto a page, or off every page. */
export function assignScreenToPage(nodeId: string, pageId: string | undefined): void {
  const target = pageId === IMPLICIT_PAGE_ID ? undefined : pageId;
  const next = setPageOf(doc(), nodeId, target);
  if (next !== doc()) updateDoc(next);
}

/* ------------------------------------------------------------------ *
 * Clipboard
 * ------------------------------------------------------------------ */

/**
 * Held in a signal rather than the system clipboard.
 *
 * The nodes are a live object graph, and the browser clipboard would flatten
 * them to text and back on every copy. Nothing outside this app can read a
 * .pen node anyway, so the round trip buys nothing.
 */
export const [clipboard, setClipboard] = createSignal<ClipboardContents | null>(null);

export function copySelection(): boolean {
  const picked = copyNodes(doc(), selectedIds());
  if (!picked) return false;
  setClipboard(picked);
  return true;
}

export function cutSelection(): boolean {
  if (!copySelection()) return false;
  deleteSelectedNodes();
  return true;
}

/**
 * Paste onto the active page.
 *
 * Top-level nodes always land at the top level, never inside whatever happens
 * to be selected — cutting a screen and pasting it on another page is the whole
 * point, and pasting it into the first screen already there is not that. Nodes
 * copied from inside a frame do go into the selected frame.
 */
export function pasteClipboard(): boolean {
  const held = clipboard();
  if (!held) return false;

  const selected = [...selectedIds()];
  const parentId = !held.fromRoot && selected.length === 1 ? selected[0] : undefined;
  const { doc: next, ids } = pasteNodes(doc(), held, {
    pageId: activePage()?.id,
    parentId,
    siblings: activeScreens()
  });
  if (next === doc() || ids.length === 0) return false;
  updateDoc(next);
  setSelectedIds(new Set(ids));
  return true;
}

export function duplicateSelection(): boolean {
  const ids = [...selectedIds()];
  if (ids.length === 0) return false;
  let next = doc();
  const made: string[] = [];
  for (const id of ids) {
    const res = duplicateNode(next, id);
    if (!res) continue;
    next = res.doc;
    made.push(res.newId);
  }
  if (made.length === 0) return false;
  updateDoc(next);
  setSelectedIds(new Set(made));
  return true;
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
    const instanceTarget = splitInstanceId(nextDoc, rawId);
    nextDoc = instanceTarget
      ? setInstanceProperty(nextDoc, instanceTarget, "enabled", false)
      : removeNode(nextDoc, rawId);
  }
  setSelectedIds(new Set<string>());
  if (nextDoc !== doc()) {
    updateDoc(nextDoc);
  }
}

export function deleteNodeById(rawId: string) {
  const current = doc();
  const instanceTarget = splitInstanceId(current, rawId);
  const targetId = instanceTarget?.refId ?? rawId;
  const nextDoc = instanceTarget
    ? setInstanceProperty(current, instanceTarget, "enabled", false)
    : removeNode(current, targetId);
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
