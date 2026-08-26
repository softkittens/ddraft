import type { Document } from "./types";
import { cloneDocument } from "./tree";

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  maxHistory: number;
}

function cloneValue<T>(val: T, prev?: T): T {
  if (val && typeof val === "object" && "children" in val) {
    return cloneDocument(val as unknown as Document) as unknown as T;
  }
  if (val && typeof val === "object" && "doc" in val && "selectedIds" in val) {
    const valDoc = (val as any).doc;
    const prevDoc = (prev as any)?.doc;
    const clonedDoc = valDoc === prevDoc ? prevDoc : cloneDocument(valDoc);
    return {
      doc: clonedDoc,
      selectedIds: Array.isArray((val as any).selectedIds) ? [...(val as any).selectedIds] : []
    } as unknown as T;
  }
  return val;
}

export function createHistory<T>(initial: T, maxHistory = 50): HistoryState<T> {
  return {
    past: [],
    present: cloneValue(initial),
    future: [],
    maxHistory
  };
}

export function pushHistory<T>(
  history: HistoryState<T>,
  next: T,
  isEqual?: (a: T, b: T) => boolean
): HistoryState<T> {
  if (isEqual && isEqual(history.present, next)) {
    return history;
  }
  const past = [...history.past, history.present];
  if (past.length > history.maxHistory) {
    past.shift();
  }
  return {
    past,
    present: cloneValue(next, history.present),
    future: [],
    maxHistory: history.maxHistory
  };
}

export function pushDocument<T>(history: HistoryState<T>, next: T): HistoryState<T> {
  return pushHistory(history, next);
}

export function undo<T>(
  history: HistoryState<T>
): { history: HistoryState<T>; value: T; doc: any; selectedIds: any } | null {
  if (history.past.length === 0) return null;
  const previous = history.past[history.past.length - 1];
  const newPast = history.past.slice(0, history.past.length - 1);
  const newFuture = [history.present, ...history.future];
  const doc = (previous as any)?.doc !== undefined ? (previous as any).doc : previous;
  const selectedIds = (previous as any)?.selectedIds ?? [];
  return {
    history: {
      past: newPast,
      present: previous,
      future: newFuture,
      maxHistory: history.maxHistory
    },
    value: previous,
    doc,
    selectedIds
  };
}

export function redo<T>(
  history: HistoryState<T>
): { history: HistoryState<T>; value: T; doc: any; selectedIds: any } | null {
  if (history.future.length === 0) return null;
  const next = history.future[0];
  const newFuture = history.future.slice(1);
  const newPast = [...history.past, history.present];
  const doc = (next as any)?.doc !== undefined ? (next as any).doc : next;
  const selectedIds = (next as any)?.selectedIds ?? [];
  return {
    history: {
      past: newPast,
      present: next,
      future: newFuture,
      maxHistory: history.maxHistory
    },
    value: next,
    doc,
    selectedIds
  };
}
