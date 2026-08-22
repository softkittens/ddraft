import type { Document } from "../model/types";
import type { Camera } from "../interaction/camera";
import { documentSchema } from "../model/parse";
import type { Entry } from "./chat/types";
import type { Message } from "../agent/provider";

/**
 * Persists canvas, camera, and chat session across browser refreshes.
 *
 * Uses IndexedDB rather than localStorage because documents with embedded base64
 * images easily exceed localStorage's 5MB quota.
 */

const DB_NAME = "pen";
const DB_VERSION = 1;
const STORE = "session";
const KEY = "current";
const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 300;
const DEBOUNCE_MS = 400;

export interface ChatSnapshot {
  entries: Entry[];
  agentMessages: Message[];
  lastBrief: string;
}

export interface PersistedSession {
  version: number;
  savedAt: string;
  doc: Document;
  camera?: Camera;
  chat?: ChatSnapshot;
}

/** Execute an IndexedDB transaction safely with automatic cleanup and fallback. */
function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return new Promise((resolve) => {
    let idb: IDBFactory | undefined;
    try {
      idb = typeof indexedDB !== "undefined" ? indexedDB : undefined;
    } catch {
      idb = undefined;
    }
    if (!idb) return resolve(null);

    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };

    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);

    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(STORE, mode);
        const op = fn(tx.objectStore(STORE));
        op.onsuccess = () => {
          db.close();
          resolve(op.result ?? null);
        };
        op.onerror = () => {
          db.close();
          resolve(null);
        };
        tx.onabort = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}

function validCamera(v: any): Camera | undefined {
  if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom > 0) {
    return { x: v.x, y: v.y, zoom: v.zoom };
  }
}

function validChat(v: any): ChatSnapshot | undefined {
  if (v && Array.isArray(v.entries) && Array.isArray(v.agentMessages)) {
    return {
      entries: v.entries.slice(-MAX_ENTRIES),
      agentMessages: v.agentMessages,
      lastBrief: typeof v.lastBrief === "string" ? v.lastBrief : ""
    };
  }
}

/** Restores and validates a stored raw record into a typed session, or returns null. */
export function restoreRecord(raw: any): PersistedSession | null {
  if (!raw || typeof raw !== "object" || raw.version !== SCHEMA_VERSION) return null;

  const parsed = documentSchema.safeParse(raw.doc);
  if (!parsed.success) return null;

  return {
    version: SCHEMA_VERSION,
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString(),
    doc: parsed.data as Document,
    camera: validCamera(raw.camera),
    chat: validChat(raw.chat)
  };
}

export async function loadSession(): Promise<PersistedSession | null> {
  return restoreRecord(await withStore<unknown>("readonly", (s) => s.get(KEY)));
}

let pending: Partial<PersistedSession> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

async function write(): Promise<void> {
  const patch = pending;
  pending = {};
  if (!patch.doc && !patch.camera && !patch.chat) return;

  const existing = (await withStore<unknown>("readonly", (s) => s.get(KEY))) as any;
  const chat = patch.chat ?? existing?.chat;
  const doc = patch.doc ?? existing?.doc;
  if (!doc) return;

  const session: PersistedSession = {
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    doc,
    camera: patch.camera ?? existing?.camera,
    chat: chat ? { ...chat, entries: chat.entries.slice(-MAX_ENTRIES) } : undefined
  };

  try {
    await withStore("readwrite", (s) => s.put(structuredClone(session), KEY));
  } catch {
    // Ignore structuredClone errors on un-cloneable objects
  }
}

/** Queue part of the session for saving with debounce. */
export function saveSession(patch: Partial<PersistedSession>): void {
  pending = { ...pending, ...patch };
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    writeQueue = writeQueue.then(write, write);
  }, DEBOUNCE_MS);
}

/** Immediately write queued state to disk (e.g. before page unload). */
export function flushSession(): Promise<unknown> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  writeQueue = writeQueue.then(write, write);
  return writeQueue;
}

/** Delete persisted session from storage. */
export async function clearSession(): Promise<void> {
  pending = {};
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  await writeQueue.catch(() => {});
  await withStore("readwrite", (s) => s.delete(KEY));
}
