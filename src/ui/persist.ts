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
  choice?: string;
  effort?: "low" | "medium" | "high";
}

export interface PersistedSession {
  version: number;
  savedAt: string;
  doc: Document;
  camera?: Camera;
  chat?: ChatSnapshot;
  /** The page being worked on. Undefined means the first page in the document. */
  activePageId?: string;
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
      lastBrief: typeof v.lastBrief === "string" ? v.lastBrief : "",
      choice: typeof v.choice === "string" ? v.choice : undefined,
      effort: v.effort === "low" || v.effort === "medium" || v.effort === "high" ? v.effort : undefined
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
    chat: validChat(raw.chat),
    activePageId: typeof raw.activePageId === "string" && raw.activePageId.trim() ? raw.activePageId : undefined
  };
}

let cachedSession: PersistedSession | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();
const MAX_WAIT_MS = 1000;

export async function loadSession(): Promise<PersistedSession | null> {
  const record = restoreRecord(await withStore<unknown>("readonly", (s) => s.get(KEY)));
  if (record) cachedSession = record;
  return record;
}

async function write(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (maxWaitTimer !== null) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }

  if (!cachedSession || !cachedSession.doc) return;

  const session: PersistedSession = {
    ...cachedSession,
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    chat: cachedSession.chat
      ? { ...cachedSession.chat, entries: cachedSession.chat.entries.slice(-MAX_ENTRIES) }
      : undefined
  };

  try {
    await withStore("readwrite", (s) => s.put(structuredClone(session), KEY));
  } catch {
    // Ignore structuredClone errors on un-cloneable objects
  }
}

/** Queue part of the session for saving with debounce and max-wait guarantee. */
export function saveSession(patch: Partial<PersistedSession>): void {
  cachedSession = {
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    doc: patch.doc ?? cachedSession?.doc!,
    camera: patch.camera ?? cachedSession?.camera,
    chat: patch.chat ?? cachedSession?.chat,
    // Tested for presence rather than truthiness: undefined is a meaningful
    // value here, and ?? would quietly restore a page the user just left.
    activePageId: "activePageId" in patch ? patch.activePageId : cachedSession?.activePageId
  };

  if (maxWaitTimer === null) {
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null;
      writeQueue = writeQueue.then(write, write);
    }, MAX_WAIT_MS);
  }

  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    writeQueue = writeQueue.then(write, write);
  }, DEBOUNCE_MS);
}

/** Immediately write queued state to disk (e.g. before page unload or upon stopping). */
export function flushSession(): Promise<unknown> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (maxWaitTimer !== null) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }
  writeQueue = writeQueue.then(write, write);
  return writeQueue;
}

/** Delete persisted session from storage. */
export async function clearSession(): Promise<void> {
  cachedSession = null;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (maxWaitTimer !== null) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }
  await writeQueue.catch(() => {});
  await withStore("readwrite", (s) => s.delete(KEY));
}
