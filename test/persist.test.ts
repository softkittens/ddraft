import { describe, it, expect } from "bun:test";
import { restoreRecord, type PersistedSession } from "../src/ui/persist";
import { makeDoc, frame, txt } from "./harness";

/**
 * The read path only. Everything below is what a browser hands back from
 * IndexedDB, and every branch here is a way a canvas could be lost: a record
 * from an older build, one half-written when a tab was killed, one whose camera
 * would divide by zero on the first screen-to-world call.
 */

const record = (over: Record<string, unknown> = {}): unknown => ({
  version: 1,
  savedAt: "2026-08-22T10:00:00.000Z",
  doc: makeDoc(frame("screen", 390, 844, [txt("t", "Hello")])),
  camera: { x: 40, y: 40, zoom: 1 },
  ...over
});

describe("restoring a stored session", () => {
  it("returns the document, camera and chat that were stored", () => {
    const restored = restoreRecord(
      record({ chat: { entries: [{ kind: "note", text: "hi", tone: "info" }], agentMessages: [], lastBrief: "a cat app" } })
    ) as PersistedSession;

    expect(restored).not.toBeNull();
    expect(restored.doc.children[0].id).toBe("screen");
    expect(restored.camera).toEqual({ x: 40, y: 40, zoom: 1 });
    expect(restored.chat?.lastBrief).toBe("a cat app");
    expect(restored.chat?.entries).toHaveLength(1);
  });

  it("drops a record written by a different schema version", () => {
    expect(restoreRecord(record({ version: 0 }))).toBeNull();
    expect(restoreRecord(record({ version: undefined }))).toBeNull();
  });

  it("drops a record whose document no longer parses", () => {
    expect(restoreRecord(record({ doc: { version: "2.17", children: "not an array" } }))).toBeNull();
    expect(restoreRecord(record({ doc: null }))).toBeNull();
  });

  it("survives anything that is not a record at all", () => {
    for (const junk of [null, undefined, 42, "{}", [], true]) {
      expect(restoreRecord(junk)).toBeNull();
    }
  });

  it("keeps the design when only the camera is unusable", () => {
    // Losing the viewport is a shrug. Losing the canvas with it is not.
    for (const bad of [{ x: 0, y: 0, zoom: 0 }, { x: 1, y: 2 }, { x: NaN, y: 0, zoom: 1 }, "left a bit", null]) {
      const restored = restoreRecord(record({ camera: bad })) as PersistedSession;
      expect(restored).not.toBeNull();
      expect(restored.doc.children[0].id).toBe("screen");
      expect(restored.camera).toBeUndefined();
    }
  });

  it("keeps the design when only the chat is unusable", () => {
    for (const bad of [{ entries: "nope", agentMessages: [] }, { entries: [] }, 7, null]) {
      const restored = restoreRecord(record({ chat: bad })) as PersistedSession;
      expect(restored).not.toBeNull();
      expect(restored.doc.children[0].id).toBe("screen");
      expect(restored.chat).toBeUndefined();
    }
  });

  it("caps a transcript that grew without bound", () => {
    const entries = Array.from({ length: 500 }, (_, i) => ({ kind: "note", text: `n${i}`, tone: "info" }));
    const restored = restoreRecord(
      record({ chat: { entries, agentMessages: [], lastBrief: "" } })
    ) as PersistedSession;

    expect(restored.chat?.entries).toHaveLength(300);
    // Newest kept: the tail is what the user was last looking at.
    expect((restored.chat!.entries.at(-1) as { text: string }).text).toBe("n499");
  });

  it("accepts a chat with no lastBrief rather than failing the whole record", () => {
    const restored = restoreRecord(
      record({ chat: { entries: [], agentMessages: [] } })
    ) as PersistedSession;

    expect(restored.chat?.lastBrief).toBe("");
  });

  it("handles saveSession and flushSession safely", async () => {
    const { saveSession, flushSession, clearSession } = await import("../src/ui/persist");
    const testDoc = makeDoc(frame("screen", 390, 844, [txt("t", "Hello")]));
    saveSession({ doc: testDoc });
    await expect(flushSession()).resolves.toBeUndefined();
    await expect(clearSession()).resolves.toBeUndefined();
  });
});
