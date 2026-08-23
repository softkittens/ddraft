import { describe, it, expect } from "bun:test";
import { makeDoc, frame } from "./harness";
import { documentSchema } from "../src/model/parse";
import {
  IMPLICIT_PAGE_ID,
  PAGE_METADATA_KEY,
  PAGES_METADATA_KEY,
  declarePage,
  nextPageId,
  pageIdOf,
  pageOfNode,
  pageScopedDocument,
  pagesOf,
  removePage,
  renamePage,
  reorderPages,
  screensOfPage,
  setPageOf
} from "../src/model/pages";
import type { Document, FrameNode } from "../src/model/types";

const onPage = (id: string, page: string, extra: Record<string, unknown> = {}): FrameNode =>
  frame(id, 390, 844, [], { metadata: { [PAGE_METADATA_KEY]: page, ...extra } } as Partial<FrameNode>);

describe("Pages are derived, never required", () => {
  it("reads a document with no labels as a single page holding everything", () => {
    const doc = makeDoc(frame("a", 390, 844), frame("b", 390, 844), frame("c", 390, 844));
    const pages = pagesOf(doc);
    expect(pages).toHaveLength(1);
    expect(pages[0].implicit).toBe(true);
    expect(pages[0].name).toBe("Page 1");
    expect(pages[0].screens.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("hands back the whole child list when no page is named", () => {
    const doc = makeDoc(frame("a"), frame("b"));
    // The contract every existing caller depends on: swapping doc.children for
    // this call is not supposed to change what comes back.
    expect(screensOfPage(doc)).toEqual(doc.children);
  });

  it("has no pages when there is nothing on the canvas", () => {
    expect(pagesOf(makeDoc())).toEqual([]);
  });

  it("survives a document that lost its children array", () => {
    expect(pagesOf({ version: "2.17" } as Document)).toEqual([]);
    expect(screensOfPage({ version: "2.17" } as Document)).toEqual([]);
  });
});

describe("Page membership", () => {
  it("groups screens by the label they carry, in document order", () => {
    const doc = makeDoc(onPage("a", "home"), onPage("b", "checkout"), onPage("c", "home"));
    const pages = pagesOf(doc);
    expect(pages.map((p) => p.id)).toEqual(["home", "checkout"]);
    expect(pages[0].screens.map((n) => n.id)).toEqual(["a", "c"]);
    expect(pages[1].screens.map((n) => n.id)).toEqual(["b"]);
  });

  it("keeps unlabelled screens rather than dropping them, and lists them first", () => {
    const doc = makeDoc(onPage("a", "home"), frame("stray", 390, 844));
    const pages = pagesOf(doc);
    expect(pages.map((p) => p.id)).toEqual([IMPLICIT_PAGE_ID, "home"]);
    expect(pages[0].screens.map((n) => n.id)).toEqual(["stray"]);
    expect(pages[0].name).toBe("Unassigned");
  });

  it("puts every top-level node on exactly one page", () => {
    const doc = makeDoc(onPage("a", "home"), frame("b"), onPage("c", "checkout"), frame("d"));
    const placed = pagesOf(doc).flatMap((p) => p.screens.map((n) => n.id));
    expect(placed.sort()).toEqual(["a", "b", "c", "d"]);
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("ignores a label that is not a usable string", () => {
    const doc = makeDoc(
      frame("a", 390, 844, [], { metadata: { page: "  " } } as Partial<FrameNode>),
      frame("b", 390, 844, [], { metadata: { page: 7 } } as any)
    );
    expect(pageIdOf(doc.children[0])).toBeUndefined();
    expect(pageIdOf(doc.children[1])).toBeUndefined();
    expect(pagesOf(doc)[0].implicit).toBe(true);
  });

  it("finds the page a nested node sits on through the screen that owns it", () => {
    const doc = makeDoc(
      frame("screen", 390, 844, [frame("row", 390, 40, [frame("label", 40, 20)])], {
        metadata: { [PAGE_METADATA_KEY]: "home" }
      } as Partial<FrameNode>)
    );
    expect(pageOfNode(doc, "label")).toBe("home");
    expect(pageOfNode(doc, "screen")).toBe("home");
    expect(pageOfNode(doc, "missing")).toBeUndefined();
  });
});

describe("Writing a page label", () => {
  it("labels a top-level screen without touching the original document", () => {
    const doc = makeDoc(frame("a", 390, 844));
    const next = setPageOf(doc, "a", "home");
    expect(pageIdOf(next.children[0])).toBe("home");
    expect(pageIdOf(doc.children[0])).toBeUndefined();
  });

  it("keeps the metadata already on the screen", () => {
    const doc = makeDoc(frame("a", 390, 844, [], { metadata: { screenKind: "mobile" } } as Partial<FrameNode>));
    const next = setPageOf(doc, "a", "home");
    expect((next.children[0] as any).metadata).toEqual({ screenKind: "mobile", page: "home" });
  });

  it("removes the label and the empty bag it leaves behind", () => {
    const doc = setPageOf(makeDoc(frame("a", 390, 844)), "a", "home");
    const cleared = setPageOf(doc, "a", undefined);
    expect((cleared.children[0] as any).metadata).toBeUndefined();
  });

  it("removes the label but leaves the rest of the bag alone", () => {
    const doc = makeDoc(
      frame("a", 390, 844, [], { metadata: { screenKind: "mobile", page: "home" } } as Partial<FrameNode>)
    );
    const cleared = setPageOf(doc, "a", undefined);
    expect((cleared.children[0] as any).metadata).toEqual({ screenKind: "mobile" });
  });

  it("returns the same document when nothing would change", () => {
    const doc = setPageOf(makeDoc(frame("a", 390, 844)), "a", "home");
    expect(setPageOf(doc, "a", "home")).toBe(doc);
    expect(setPageOf(doc, "missing", "home")).toBe(doc);
  });

  it("refuses to label a nested node, because a page partitions the root", () => {
    const doc = makeDoc(frame("screen", 390, 844, [frame("inner", 100, 100)]));
    expect(setPageOf(doc, "inner", "home")).toBe(doc);
  });
});

describe("Page order and names", () => {
  it("follows the declared order and appends pages it never heard of", () => {
    let doc = makeDoc(onPage("a", "home"), onPage("b", "checkout"), onPage("c", "settings"));
    doc = reorderPages(doc, ["settings", "checkout"]);
    expect(pagesOf(doc).map((p) => p.id)).toEqual(["settings", "checkout", "home"]);
  });

  it("lists a declared page that holds nothing, so it can be built into", () => {
    const doc = declarePage(makeDoc(onPage("a", "home")), "checkout", "Checkout");
    const pages = pagesOf(doc);
    expect(pages.map((p) => p.id)).toEqual(["checkout", "home"]);
    expect(pages[0].screens).toEqual([]);
    expect(pages[0].name).toBe("Checkout");
  });

  it("falls back to the page id when no display name was recorded", () => {
    expect(pagesOf(makeDoc(onPage("a", "home")))[0].name).toBe("home");
  });

  it("does not let a page declared later sort ahead of one that predates it", () => {
    let doc = makeDoc(onPage("a", "home"), onPage("b", "checkout"));
    doc = renamePage(doc, "home", "Home");
    doc = renamePage(doc, "checkout", "Checkout");
    doc = declarePage(doc, "settings", "Settings");
    expect(pagesOf(doc).map((p) => p.name)).toEqual(["Home", "Checkout", "Settings"]);
  });

  it("names the implicit page without giving it a slot in the order", () => {
    const doc = renamePage(makeDoc(frame("a", 390, 844)), IMPLICIT_PAGE_ID, "Loose Screens");
    expect(pagesOf(doc)[0].name).toBe("Loose Screens");
    expect((doc.metadata?.[PAGES_METADATA_KEY] as any)?.order ?? []).toEqual([]);
  });

  it("renames a page without moving any screen", () => {
    const doc = renamePage(makeDoc(onPage("a", "home")), "home", "Home");
    expect(pagesOf(doc)[0].name).toBe("Home");
    expect(pagesOf(doc)[0].screens.map((n) => n.id)).toEqual(["a"]);
  });

  it("drops a page without dropping its screens", () => {
    const before = renamePage(
      declarePage(makeDoc(onPage("a", "home"), onPage("b", "checkout")), "home"),
      "home",
      "Home"
    );
    expect((before.metadata?.[PAGES_METADATA_KEY] as any).names).toEqual({ home: "Home" });

    const doc = removePage(before, "home");
    const pages = pagesOf(doc);
    expect(pages.map((p) => p.id)).toEqual([IMPLICIT_PAGE_ID, "checkout"]);
    expect(pages[0].screens.map((n) => n.id)).toEqual(["a"]);
    // Both halves of the page go: the label on the screen and the record of it.
    expect((doc.metadata?.[PAGES_METADATA_KEY] as any)?.names ?? {}).toEqual({});
    expect((doc.metadata?.[PAGES_METADATA_KEY] as any)?.order ?? []).toEqual([]);
  });

  it("hands out an id no page is already using", () => {
    const doc = declarePage(makeDoc(onPage("a", "page_1")), "page_2");
    expect(nextPageId(doc)).toBe("page_3");
    expect(nextPageId(makeDoc())).toBe("page_1");
  });

  it("never lets the implicit page be declared, renamed into the order, or removed", () => {
    const doc = makeDoc(frame("a", 390, 844));
    expect(declarePage(doc, IMPLICIT_PAGE_ID)).toBe(doc);
    expect(removePage(doc, IMPLICIT_PAGE_ID)).toBe(doc);
    expect(reorderPages(doc, [IMPLICIT_PAGE_ID]).metadata?.[PAGES_METADATA_KEY]).toBeUndefined();
  });

  it("reads back nothing from a metadata record of the wrong shape", () => {
    const doc = { ...makeDoc(onPage("a", "home")), metadata: { [PAGES_METADATA_KEY]: ["home"] } } as Document;
    expect(pagesOf(doc).map((p) => p.id)).toEqual(["home"]);
  });
});

describe("Pages round-trip through the .pen parser", () => {
  it("keeps both the label on the screen and the record on the document", () => {
    let doc = makeDoc(frame("a", 390, 844, [], { metadata: { screenKind: "mobile" } } as Partial<FrameNode>));
    doc = setPageOf(doc, "a", "home");
    doc = renamePage(doc, "home", "Home");

    const reparsed = documentSchema.parse(JSON.parse(JSON.stringify(doc))) as Document;
    expect(pagesOf(reparsed).map((p) => ({ id: p.id, name: p.name }))).toEqual([{ id: "home", name: "Home" }]);
    expect((reparsed.children[0] as any).metadata.screenKind).toBe("mobile");
  });

  it("still reads as one page when the document metadata is stripped", () => {
    let doc = makeDoc(frame("a", 390, 844), frame("b", 390, 844));
    doc = setPageOf(doc, "a", "home");
    doc = setPageOf(doc, "b", "home");
    doc = renamePage(doc, "home", "Home");

    // What a tool that keeps node metadata but discards the document record
    // would hand back. Membership is intact; only the display name is lost.
    const stripped = { ...doc, metadata: undefined } as Document;
    const pages = pagesOf(stripped);
    expect(pages).toHaveLength(1);
    expect(pages[0].screens.map((n) => n.id)).toEqual(["a", "b"]);
    expect(pages[0].name).toBe("home");
  });
});

describe("A page-scoped view of the document", () => {
  const twoPages = () => {
    const doc = makeDoc(onPage("home_1", "home"), onPage("home_2", "home"), onPage("shop_1", "shop"));
    doc.variables = { accent: "#ff0000" };
    doc.metadata = { style: { palette: "Terminal Green" } };
    return doc;
  };

  it("narrows the children and nothing else", () => {
    const scoped = pageScopedDocument(twoPages(), "home");
    expect(scoped.children.map((n) => n.id)).toEqual(["home_1", "home_2"]);
    // Style, direction and variables belong to the document, not to a page.
    // A view that dropped them would tell the agent no style had been chosen.
    expect(scoped.variables).toEqual({ accent: "#ff0000" });
    expect(scoped.metadata).toEqual({ style: { palette: "Terminal Green" } });
    expect(scoped.version).toBe("2.17");
  });

  it("is the same object when there is no page to narrow to", () => {
    const doc = twoPages();
    expect(pageScopedDocument(doc, undefined)).toBe(doc);
  });

  it("is the same object when the page already holds everything", () => {
    const doc = makeDoc(onPage("a", "home"), onPage("b", "home"));
    expect(pageScopedDocument(doc, "home")).toBe(doc);
  });

  it("shows only unlabelled screens for the implicit page", () => {
    const doc = makeDoc(onPage("a", "home"), frame("loose", 390, 844));
    expect(pageScopedDocument(doc, IMPLICIT_PAGE_ID).children.map((n) => n.id)).toEqual(["loose"]);
  });
});

describe("Giving the loose screens a real page", () => {
  /**
   * What the store does when a second page is added. Left implicit, those
   * screens are called "Page 1" alone and "Unassigned" in company — so adding
   * a page renames the one the user was already looking at.
   */
  function materialise(doc: Document, pageId: string): Document {
    const loose = pagesOf(doc).find((page) => page.implicit)!;
    let next = doc;
    for (const screen of loose.screens) next = setPageOf(next, screen.id, pageId);
    return declarePage(next, pageId, loose.name);
  }

  it("keeps the name the screens already had instead of renaming them Unassigned", () => {
    const doc = makeDoc(frame("a", 390, 844), frame("b", 390, 844));
    expect(pagesOf(doc).map((p) => p.name)).toEqual(["Page 1"]);

    const withSecond = declarePage(materialise(doc, "page_1"), "page_2", "Page 2");
    expect(pagesOf(withSecond).map((p) => p.name)).toEqual(["Page 1", "Page 2"]);
    expect(pagesOf(withSecond).some((p) => p.implicit)).toBe(false);
    expect(pagesOf(withSecond)[0].screens.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("leaves nothing implicit behind for the second page to inherit", () => {
    const doc = materialise(makeDoc(frame("a", 390, 844)), "page_1");
    expect(screensOfPage(doc, IMPLICIT_PAGE_ID)).toEqual([]);
    expect(pageIdOf(doc.children[0])).toBe("page_1");
  });
});
