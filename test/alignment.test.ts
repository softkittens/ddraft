import { describe, it, expect } from "bun:test";
import {
  cellToProperties,
  effectiveAlign,
  effectiveJustify,
  effectiveLayout,
  flexStyle,
  misreadNote,
  propertiesToCell,
  readAlignment,
  POSITIONS,
  DISTRIBUTIONS
} from "../src/model/alignment";
import { computeCrossAxisPosition, computeMainAxisPositions } from "../src/layout/arrange";
import { layoutDocument } from "../src/layout/layout";
import { makeDoc, frame, rect } from "./harness";
import type { FrameNode } from "../src/model/types";

describe("Reading what the engine will do", () => {
  it("treats an unset layout as a row, the way layout.ts does", () => {
    expect(effectiveLayout(undefined).value).toBe("horizontal");
    expect(effectiveLayout(undefined).understood).toBe(true);
  });

  it("reports a misspelt layout as a column, because that is what renders", () => {
    // layout.ts: `frame.layout || "horizontal"`, then `isHoriz = mode === "horizontal"`.
    // Anything unrecognised is neither "none" nor horizontal, so it flows vertically.
    const read = effectiveLayout("flex");
    expect(read.value).toBe("vertical");
    expect(read.understood).toBe(false);
  });

  it("keeps the three layouts the engine actually knows", () => {
    for (const value of ["horizontal", "vertical", "none"] as const) {
      expect(effectiveLayout(value)).toEqual({ value, stored: value, understood: true });
    }
  });

  it("falls a CSS-spelled justifyContent back to start, and says so", () => {
    const read = effectiveJustify("space-between");
    expect(read.value).toBe("start");
    expect(read.understood).toBe(false);
    expect(read.stored).toBe("space-between");
  });

  it("accepts every justifyContent the engine switches on", () => {
    for (const value of ["start", "center", "end", "space_between", "space_around"]) {
      expect(effectiveJustify(value).understood).toBe(true);
    }
  });

  it("falls stretch and baseline back to start, since the engine has neither", () => {
    expect(effectiveAlign("stretch").value).toBe("start");
    expect(effectiveAlign("baseline").understood).toBe(false);
    expect(effectiveAlign("flex_end").value).toBe("start");
  });

  it("does not launder a stored misspelling through the write-path aliases", () => {
    // VALUE_ALIASES maps space-between on the way in. Applying it here would
    // show a frame as distributed while the canvas draws it packed.
    expect(effectiveJustify("space-between").value).not.toBe("space_between");
  });

  it("calls an unset value understood, because unset has a defined meaning", () => {
    expect(effectiveJustify(undefined).understood).toBe(true);
    expect(effectiveAlign(null).understood).toBe(true);
  });
});

describe("Agreeing with the layout engine", () => {
  const sizes = [10, 10, 10];
  const main = (justifyContent: any): number[] =>
    computeMainAxisPositions({
      frameMain: 100, padStart: 0, padEnd: 0, gap: 0, justifyContent, childMainSizes: sizes
    });

  it("puts an unknown justifyContent exactly where start goes", () => {
    expect(main("space-between")).toEqual(main("start"));
    expect(main("flex-end")).toEqual(main("start"));
  });

  it("puts an unknown alignItems exactly where start goes", () => {
    const cross = (alignItems: any): number =>
      computeCrossAxisPosition({
        frameCross: 100, padStartCross: 0, padEndCross: 0, alignItems, childCrossSize: 10
      });
    expect(cross("stretch")).toBe(cross("start"));
    expect(cross("baseline")).toBe(cross("start"));
  });

  it("agrees with a real layout pass about where a misspelt frame draws", () => {
    const doc = makeDoc(
      frame("row", 300, 100, [rect("a", 40, 40), rect("b", 40, 40)], {
        layout: "horizontal",
        justifyContent: "space-between"
      } as unknown as Partial<FrameNode>)
    );
    const laid = layoutDocument(doc);
    const kids = laid[0].children!;
    // Packed at the start, not spread: 0 and 40, not 0 and 260.
    expect(kids.map((k) => k.box.x)).toEqual([0, 40]);
    expect(effectiveJustify("space-between").value).toBe("start");
  });
});

describe("The nine cells", () => {
  it("drives justifyContent along x in a row and along y in a column", () => {
    expect(cellToProperties("horizontal", 2, 0)).toEqual({ justifyContent: "end", alignItems: "start" });
    expect(cellToProperties("vertical", 2, 0)).toEqual({ justifyContent: "start", alignItems: "end" });
  });

  it("means the same corner whichever way the frame flows", () => {
    // Top-right is top-right. The properties transpose; the cell does not.
    const row = cellToProperties("horizontal", 2, 0);
    const column = cellToProperties("vertical", 2, 0);
    expect(row.justifyContent).toBe(column.alignItems);
    expect(row.alignItems).toBe(column.justifyContent);
  });

  it("treats a layout of none like a row, so the mapping is still total", () => {
    expect(cellToProperties("none", 1, 2)).toEqual(cellToProperties("horizontal", 1, 2));
  });

  it("round-trips every cell in both directions", () => {
    for (const layout of ["horizontal", "vertical"] as const) {
      for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
          const pair = cellToProperties(layout, col, row);
          expect(propertiesToCell(layout, pair.justifyContent, pair.alignItems)).toEqual({ col, row });
        }
      }
    }
  });

  it("has no cell for a distributed frame, which spans a whole row of them", () => {
    expect(propertiesToCell("horizontal", "space_between", "center")).toBeNull();
    expect(propertiesToCell("vertical", "space_around", "start")).toBeNull();
  });

  it("centres on the middle cell", () => {
    expect(propertiesToCell("horizontal", "center", "center")).toEqual({ col: 1, row: 1 });
  });
});

describe("Holding position when the direction changes", () => {
  /** What the control does: read the cell, then re-ask it in the new direction. */
  const flip = (from: any, to: any, justifyContent: any, alignItems: any) => {
    const cell = propertiesToCell(from, justifyContent, alignItems)!;
    return cellToProperties(to, cell.col, cell.row);
  };

  it("keeps a top-right frame top-right when a row becomes a column", () => {
    expect(flip("horizontal", "vertical", "end", "start")).toEqual({
      justifyContent: "start",
      alignItems: "end"
    });
  });

  it("leaves the middle alone, having nothing to transpose", () => {
    expect(flip("horizontal", "vertical", "center", "center")).toEqual({
      justifyContent: "center",
      alignItems: "center"
    });
  });

  it("returns to the original values after flipping twice", () => {
    const once = flip("horizontal", "vertical", "end", "center");
    expect(flip("vertical", "horizontal", once.justifyContent, once.alignItems)).toEqual({
      justifyContent: "end",
      alignItems: "center"
    });
  });
});

describe("The flex previews", () => {
  it("spells every engine value the way CSS does", () => {
    expect(flexStyle("horizontal", "space_between", "end")).toEqual({
      "flex-direction": "row",
      "justify-content": "space-between",
      "align-items": "flex-end"
    });
    expect(flexStyle("vertical", "start", "center")).toEqual({
      "flex-direction": "column",
      "justify-content": "flex-start",
      "align-items": "center"
    });
  });

  it("draws a layout of none as a row rather than emptying the box", () => {
    expect(flexStyle("none", "start", "start")["flex-direction"]).toBe("row");
  });

  it("covers every value the pickers can offer", () => {
    for (const justifyContent of [...POSITIONS, ...DISTRIBUTIONS]) {
      for (const alignItems of POSITIONS) {
        const style = flexStyle("horizontal", justifyContent, alignItems);
        expect(style["justify-content"]).not.toContain("_");
        expect(style["align-items"]).not.toContain("_");
      }
    }
  });
});

describe("Telling the person what the file says", () => {
  it("says nothing when the engine understood the value", () => {
    expect(misreadNote("justifyContent", effectiveJustify("center"))).toBeNull();
    expect(misreadNote("layout", effectiveLayout(undefined))).toBeNull();
  });

  it("names the stored value and what it renders as", () => {
    const note = misreadNote("justifyContent", effectiveJustify("space-between"))!;
    expect(note).toContain("space-between");
    expect(note).toContain("start");
  });

  it("reads a whole frame at once", () => {
    const node = frame("f", 100, 100, [], {
      layout: "horizontal",
      justifyContent: "space-between",
      alignItems: "stretch"
    } as unknown as Partial<FrameNode>);
    const state = readAlignment(node);
    expect(state.layout.understood).toBe(true);
    expect(state.justifyContent.understood).toBe(false);
    expect(state.alignItems.understood).toBe(false);
    expect(state.justifyContent.value).toBe("start");
  });

  it("finds nothing to report on a frame that never set either property", () => {
    const state = readAlignment(frame("f", 100, 100, []));
    expect(misreadNote("justifyContent", state.justifyContent)).toBeNull();
    expect(misreadNote("alignItems", state.alignItems)).toBeNull();
  });
});
