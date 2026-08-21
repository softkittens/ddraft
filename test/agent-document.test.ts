import { describe, it, expect } from "bun:test";
import { decideAgentDocument } from "../src/ui/agentDocument";
import { makeDoc, frame, rect } from "./harness";
import { setProperty } from "../src/model/edit";

describe("stale agent snapshots must not overwrite user edits", () => {
  it("accepts the first agent document against the request snapshot", () => {
    const sent = makeDoc(frame("f", 100, 100));
    const next = setProperty(sent, "f", "width", 200);
    expect(decideAgentDocument(sent, sent, next)).toEqual({ action: "accept", expected: next });
  });

  it("skips a duplicate document so history is not extended", () => {
    const sent = makeDoc(frame("f", 100, 100));
    expect(decideAgentDocument(sent, sent, sent)).toEqual({ action: "skip" });
  });

  it("accepts a deserialized clone of the last document (SSE cannot reuse identity)", () => {
    const sent = makeDoc(frame("f", 100, 100));
    const clone = JSON.parse(JSON.stringify(sent));
    expect(decideAgentDocument(sent, sent, clone)).toEqual({ action: "accept", expected: clone });
  });

  it("aborts when the canvas moved off the expected document", () => {
    const sent = makeDoc(frame("f", 100, 100));
    const userEdit = setProperty(sent, "f", "width", 80);
    const agentDoc = setProperty(sent, "f", "height", 200);
    expect(decideAgentDocument(userEdit, sent, agentDoc)).toEqual({ action: "abort" });
  });

  it("accepts a later tool document after the previous one was applied", () => {
    const sent = makeDoc(frame("f", 100, 100, [rect("r", 10, 10)]));
    const first = setProperty(sent, "f", "width", 200);
    const second = setProperty(first, "r", "width", 20);
    expect(decideAgentDocument(first, first, second)).toEqual({ action: "accept", expected: second });
  });
});
