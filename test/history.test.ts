import { describe, it, expect } from "bun:test";
import { makeDoc } from "./harness";
import { agentSystemPrompt } from "../src/agent/prompt";
import { STYLE_METADATA_KEY } from "../src/design/styleSystem";
import {
  recordRun,
  avoidanceNote,
  loadHistory,
  HISTORY_LIMIT,
  type StyleRun
} from "../src/design/history";

describe("Style history", () => {
  const run = (brief: string, palette: string): StyleRun => ({
    at: "2026-08-21T00:00:00.000Z",
    brief,
    palette,
    headings: "Anton",
    elevation: "Flat"
  });

  it("keeps only the most recent entries", () => {
    let history: StyleRun[] = [];
    for (let i = 0; i < 9; i++) history = recordRun(history, run(`brief ${i}`, `P${i}`));
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[history.length - 1].palette).toBe("P8");
    expect(history.some((h) => h.palette === "P0")).toBe(false);
  });

  it("says nothing when there is no history", () => {
    expect(avoidanceNote([])).toBe("");
  });

  it("lists what was already used, most recent first", () => {
    const note = avoidanceNote([run("a bus app", "Terminal Green"), run("a cat app", "Neobrutalism")]);
    expect(note.indexOf("Neobrutalism")).toBeLessThan(note.indexOf("Terminal Green"));
    expect(note).toContain("not habit");
  });

  it("records same-brief composition and requires a materially different rerun", () => {
    const basePrompt = agentSystemPrompt(
      makeDoc(), [], "m", 0, [], "Playful ordering app for matcha cakes"
    );
    const previouslyOffered = basePrompt.match(/PALETTES[\s\S]*?\n  ([^(\n]+) \((?:light|dark)\)/)?.[1]?.trim();
    expect(previouslyOffered).toBeDefined();
    const previous: StyleRun = {
      ...run("Playful ordering app for matcha cakes", previouslyOffered!),
      roundness: "Rounded",
      firstViewport: "Header, search, dark hero, two cards, promo, bottom tabs."
    };
    const prompt = agentSystemPrompt(
      makeDoc(),
      [],
      "m",
      0,
      [previous],
      "Playful ordering app for matcha cakes"
    );
    expect(prompt).toContain("PREVIOUS RESULTS FOR THIS SAME BRIEF");
    expect(prompt).toContain("Header, search, dark hero");
    expect(prompt).toContain("materially different dominant composition");
    const offeredPalettes = prompt.split("ROUNDNESS")[0];
    expect(offeredPalettes).not.toMatch(new RegExp(`  ${previouslyOffered} \\((light|dark)\\)`));
    const roundnessBlock = prompt.split("ROUNDNESS")[1]?.split("ELEVATION")[0] ?? "";
    expect(roundnessBlock).not.toContain("  Rounded —");
  });

  it("reaches the prompt only when the model is about to choose", () => {
    const history = [run("a cat app", "Spring Meadow")];
    const fresh = makeDoc();
    expect(agentSystemPrompt(fresh, [], "m", 1, history)).toContain("Spring Meadow");

    const styled = makeDoc();
    styled.metadata = {
      [STYLE_METADATA_KEY]: {
        palette: "Terminal Green",
        roundness: "Sharp",
        elevation: "Flat",
        headings: "Geist Mono",
        body: "Geist Mono",
        captions: "IBM Plex Mono"
      }
    };
    expect(agentSystemPrompt(styled, [], "m", 1, history)).not.toContain("ALREADY USED");
  });

  it("survives a corrupt or absent store", () => {
    const store = (value: string | null) =>
      ({
        getItem: () => value,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0
      }) as unknown as Storage;
    expect(loadHistory(store("not json"))).toEqual([]);
    expect(loadHistory(store(null))).toEqual([]);
    expect(loadHistory(store('[{"palette":"P"}]'))).toEqual([]);
  });
});
