import { describe, it, expect, beforeEach } from "bun:test";
import { makeDoc, frame, txt } from "./harness";
import {
  doc,
  updateDoc,
  asOneEdit,
  beginEdit,
  endEdit,
  isEditing,
  setNodeProperty,
  handleUndo,
  handleRedo,
  historyState,
  setSelectedIds
} from "../src/ui/store";
import { setProperty } from "../src/model/edit";
import { findNode } from "../src/model/tree";
import type { Document } from "../src/model/types";

/**
 * The store is a module singleton, so every test here works in deltas against
 * the undo stack rather than absolute depths.
 */
const steps = () => historyState().past.length;
const size = (d: Document = doc()) => (findNode(d.children, "title") as any).fontSize;

const install = (): void => {
  endEdit();
  updateDoc(makeDoc(frame("screen", 390, 844, [txt("title", "Hello", 14)])));
  setSelectedIds(new Set(["title"]));
};

beforeEach(install);

describe("An ordinary write", () => {
  it("is one undo step", () => {
    const before = steps();
    setNodeProperty("fontSize", 20);
    expect(steps()).toBe(before + 1);
    expect(size()).toBe(20);
  });

  it("undoes back to what it was", () => {
    setNodeProperty("fontSize", 20);
    handleUndo();
    expect(size()).toBe(14);
  });
});

describe("A gesture that writes many times", () => {
  it("collapses to a single undo step", () => {
    const before = steps();
    beginEdit();
    // What a slider dragged across twenty pixels does.
    for (let px = 15; px <= 34; px += 1) setNodeProperty("fontSize", px);
    endEdit();

    expect(steps()).toBe(before + 1);
    expect(size()).toBe(34);
  });

  it("shows every intermediate value live, so the canvas can preview it", () => {
    beginEdit();
    setNodeProperty("fontSize", 18);
    expect(size()).toBe(18);
    setNodeProperty("fontSize", 26);
    expect(size()).toBe(26);
    endEdit();
  });

  it("undoes past the whole gesture, not to an intermediate value", () => {
    beginEdit();
    for (const px of [16, 18, 22, 30]) setNodeProperty("fontSize", px);
    endEdit();

    handleUndo();
    // Not 22, which is where a per-write history would land.
    expect(size()).toBe(14);
  });

  it("redoes the whole gesture", () => {
    beginEdit();
    for (const px of [16, 18, 22, 30]) setNodeProperty("fontSize", px);
    endEdit();
    handleUndo();
    handleRedo();
    expect(size()).toBe(30);
  });

  it("leaves no step behind when it wrote nothing", () => {
    const before = steps();
    beginEdit();
    endEdit();
    expect(steps()).toBe(before);
  });

  it("leaves no step behind when every write was a no-op", () => {
    const before = steps();
    beginEdit();
    setNodeProperty("fontSize", 14); // already 14
    endEdit();
    expect(steps()).toBe(before);
  });
});

describe("Keeping the edit state sane", () => {
  it("treats a second begin as the same gesture, not a nested one", () => {
    const before = steps();
    beginEdit();
    setNodeProperty("fontSize", 20);
    beginEdit();
    setNodeProperty("fontSize", 24);
    endEdit();
    expect(isEditing()).toBe(false);
    expect(steps()).toBe(before + 1);
  });

  it("closes on end even when nothing was open", () => {
    endEdit();
    endEdit();
    expect(isEditing()).toBe(false);
  });

  it("closes an edit a control forgot to end, rather than swallowing undo", () => {
    beginEdit();
    setNodeProperty("fontSize", 20);
    // No endEdit. A stuck edit used to mean no undo entries ever again.
    handleUndo();
    expect(isEditing()).toBe(false);
    expect(size()).toBe(14);
  });

  it("does not lose an unrelated write made while an edit is open", () => {
    beginEdit();
    setNodeProperty("fontSize", 20);
    updateDoc(setProperty(doc(), "title", "fontWeight", "bold"));
    endEdit();
    expect(size()).toBe(20);
    expect((findNode(doc().children, "title") as any).fontWeight).toBe("bold");
  });
});

describe("Setting a property through the store", () => {
  it("defaults to the current selection", () => {
    setSelectedIds(new Set(["title"]));
    const result = setNodeProperty("content", "Goodbye");
    expect(result.applied).toEqual(["title"]);
    expect((findNode(doc().children, "title") as any).content).toBe("Goodbye");
  });

  it("takes explicit ids over the selection", () => {
    setSelectedIds(new Set(["title"]));
    const result = setNodeProperty("gap", 12, ["screen"]);
    expect(result.applied).toEqual(["screen"]);
    expect((findNode(doc().children, "screen") as any).gap).toBe(12);
  });

  it("reports a refused value and writes nothing", () => {
    const before = steps();
    const result = setNodeProperty("alignItems", "stretch", ["screen"]);
    expect(result.applied).toEqual([]);
    expect(result.note).toContain("fill_container");
    expect(steps()).toBe(before);
  });
});

describe("Grouping writes without stealing a gesture", () => {
  it("makes several writes one step on its own", () => {
    const before = steps();
    asOneEdit(() => {
      setNodeProperty("fontSize", 20);
      setNodeProperty("fontWeight", "bold");
    });
    expect(steps()).toBe(before + 1);
    expect(isEditing()).toBe(false);
  });

  /*
   * The bug this exists for: the size field opens an edit on focus and calls a
   * helper per keystroke. A helper that bracketed its own writes closed that
   * edit on the first one, so four typed characters became four undo steps.
   */
  it("joins an open gesture instead of closing it", () => {
    const before = steps();
    beginEdit();
    for (const value of [12, 120, 128]) {
      asOneEdit(() => setNodeProperty("fontSize", value));
      expect(isEditing()).toBe(true);
    }
    expect(steps()).toBe(before);
    endEdit();
    expect(steps()).toBe(before + 1);
    expect(size()).toBe(128);
  });

  it("undoes the whole typed number, not the last keystroke", () => {
    setNodeProperty("fontSize", 14);
    const settled = size();
    beginEdit();
    for (const value of [1, 12, 120]) asOneEdit(() => setNodeProperty("fontSize", value));
    endEdit();
    handleUndo();
    expect(size()).toBe(settled);
  });

  it("closes its edit even when a write throws, rather than wedging undo", () => {
    expect(() =>
      asOneEdit(() => {
        setNodeProperty("fontSize", 20);
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(isEditing()).toBe(false);
  });

  it("records nothing when it writes nothing", () => {
    const before = steps();
    asOneEdit(() => {});
    expect(steps()).toBe(before);
  });
});
