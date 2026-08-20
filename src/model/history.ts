import type { Document } from "./types";

export interface HistoryState {
  past: Document[];
  present: Document;
  future: Document[];
  maxHistory: number;
}

function clone(doc: Document): Document {
  return structuredClone(doc);
}

export function createHistory(initialDoc: Document, maxHistory = 50): HistoryState {
  return {
    past: [],
    present: clone(initialDoc),
    future: [],
    maxHistory
  };
}

export function pushDocument(history: HistoryState, nextDoc: Document): HistoryState {
  const nextClone = clone(nextDoc);
  const past = [...history.past, clone(history.present)];
  if (past.length > history.maxHistory) {
    past.shift();
  }
  return {
    past,
    present: nextClone,
    future: [],
    maxHistory: history.maxHistory
  };
}

export function undo(history: HistoryState): { history: HistoryState; doc: Document } | null {
  if (history.past.length === 0) return null;
  const previous = history.past[history.past.length - 1];
  const newPast = history.past.slice(0, history.past.length - 1);
  const newFuture = [clone(history.present), ...history.future];
  const prevClone = clone(previous);
  const newHistory: HistoryState = {
    past: newPast,
    present: prevClone,
    future: newFuture,
    maxHistory: history.maxHistory
  };
  return { history: newHistory, doc: prevClone };
}

export function redo(history: HistoryState): { history: HistoryState; doc: Document } | null {
  if (history.future.length === 0) return null;
  const next = history.future[0];
  const newFuture = history.future.slice(1);
  const newPast = [...history.past, clone(history.present)];
  const nextClone = clone(next);
  const newHistory: HistoryState = {
    past: newPast,
    present: nextClone,
    future: newFuture,
    maxHistory: history.maxHistory
  };
  return { history: newHistory, doc: nextClone };
}


