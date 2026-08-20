import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { parseDocument, parseSizing } from "../src/model/parse";

describe("Model Parser & Schema", () => {
  it("parses all 12 fixtures without error", () => {
    const fixtureDir = join(import.meta.dir, "../fixtures");
    const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".pen"));
    expect(files.length).toBe(12);
    for (const file of files) {
      const content = readFileSync(join(fixtureDir, file), "utf-8");
      const doc = parseDocument(content);
      expect(doc.version).toBe("2.17");
      expect(Array.isArray(doc.children)).toBe(true);
    }
  });

  it("parses all probe files without error", () => {
    const probeDir = join(import.meta.dir, "../probes");
    const files = readdirSync(probeDir).filter((f) => f.endsWith(".pen"));
    expect(files.length).toBe(2);
    for (const file of files) {
      const content = readFileSync(join(probeDir, file), "utf-8");
      const doc = parseDocument(content);
      expect(doc.version).toBe("2.17");
    }
  });

  it("throws an error when document has unknown key", () => {
    const invalidJson = JSON.stringify({
      version: "2.17",
      unknownProp: "invalid",
      children: []
    });
    expect(() => parseDocument(invalidJson)).toThrow();
  });

  it("throws an error when node has unknown key", () => {
    const invalidJson = JSON.stringify({
      version: "2.17",
      children: [{ type: "rectangle", id: "r1", unknownProp: 123 }]
    });
    expect(() => parseDocument(invalidJson)).toThrow();
  });

  it("parses sizing strings and numbers correctly", () => {
    expect(parseSizing("fit_content(100)")).toEqual({ mode: "fit_content", fallback: 100 });
    expect(parseSizing("fill_container")).toEqual({ mode: "fill_container", fallback: undefined });
    expect(parseSizing(240)).toEqual({ mode: "fixed", value: 240 });
  });
});
