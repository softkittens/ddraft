import { describe, it, expect } from "bun:test";
import { makeDoc, frame, rect, txt } from "./harness";
import { copyNodes, pasteNodes } from "../src/model/clipboard";
import { PAGE_METADATA_KEY, pageIdOf, screensOfPage } from "../src/model/pages";
import { findNode, indexDocument } from "../src/model/tree";
import { removeNode } from "../src/model/edit";
import type { Document, FrameNode } from "../src/model/types";

const screen = (id: string, page?: string, x = 0): FrameNode =>
  frame(id, 390, 844, [txt(`${id}_label`, "Hello"), rect(`${id}_box`, 40, 40)], {
    x,
    name: id,
    metadata: page ? { screenKind: "mobile", [PAGE_METADATA_KEY]: page } : { screenKind: "mobile" }
  } as Partial<FrameNode>);

const twoPages = (): Document => makeDoc(screen("home_a", "home", 0), screen("shop_a", "shop", 0));

describe("Copying nodes out of a document", () => {
  it("takes a detached copy that later edits cannot reach", () => {
    const doc = twoPages();
    const held = copyNodes(doc, ["home_a"])!;
    const after = removeNode(doc, "home_a");
    expect(findNode(after.children, "home_a")).toBeNull();
    expect(held.nodes[0].id).toBe("home_a");
    expect(held.fromRoot).toBe(true);
  });

  it("reports a nested copy as not from the root, so paste knows where it belongs", () => {
    expect(copyNodes(twoPages(), ["home_a_box"])!.fromRoot).toBe(false);
  });

  it("returns nothing for an empty or unknown selection", () => {
    expect(copyNodes(twoPages(), [])).toBeNull();
    expect(copyNodes(twoPages(), ["no_such_node"])).toBeNull();
  });
});

describe("Moving a screen between pages", () => {
  it("keeps the original ids when the source was cut, so refs still resolve", () => {
    const doc = twoPages();
    const held = copyNodes(doc, ["home_a"])!;
    const cut = removeNode(doc, "home_a");

    const { doc: pasted, ids } = pasteNodes(cut, held, { pageId: "shop", siblings: screensOfPage(cut, "shop") });
    expect(ids).toEqual(["home_a"]);
    expect(findNode(pasted.children, "home_a_label")).not.toBeNull();
    expect(pageIdOf(pasted.children.find((n) => n.id === "home_a")!)).toBe("shop");
  });

  it("moves the whole subtree, not just the frame", () => {
    const doc = twoPages();
    const held = copyNodes(doc, ["home_a"])!;
    const { doc: pasted } = pasteNodes(removeNode(doc, "home_a"), held, { pageId: "shop" });
    expect(findNode(pasted.children, "home_a_box")).not.toBeNull();
    expect((findNode(pasted.children, "home_a_label") as any).content).toBe("Hello");
  });

  it("leaves the source page empty and the destination holding it", () => {
    const doc = twoPages();
    const held = copyNodes(doc, ["home_a"])!;
    const { doc: pasted } = pasteNodes(removeNode(doc, "home_a"), held, { pageId: "shop" });
    expect(screensOfPage(pasted, "home")).toHaveLength(0);
    expect(screensOfPage(pasted, "shop").map((n) => n.id)).toEqual(["shop_a", "home_a"]);
  });

  it("drops the label when pasting onto a document with no pages", () => {
    const doc = makeDoc(screen("a"));
    const held = copyNodes(doc, ["a"])!;
    const { doc: pasted, ids } = pasteNodes(removeNode(doc, "a"), held, { pageId: undefined });
    expect(pageIdOf(pasted.children.find((n) => n.id === ids[0])!)).toBeUndefined();
  });
});

describe("Copying rather than moving", () => {
  it("gives the copy fresh ids, because the original still holds the old ones", () => {
    const doc = twoPages();
    const held = copyNodes(doc, ["home_a"])!;
    const { doc: pasted, ids } = pasteNodes(doc, held, { pageId: "shop" });
    expect(ids[0]).not.toBe("home_a");
    // Both survive, and no id is used twice anywhere in the tree.
    expect(findNode(pasted.children, "home_a")).not.toBeNull();
    const all: string[] = [];
    indexDocument(pasted).forEach((_, id) => all.push(id));
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives the second paste fresh ids after the first one claimed them", () => {
    const doc = twoPages();
    const held = copyNodes(doc, ["home_a"])!;
    const once = pasteNodes(removeNode(doc, "home_a"), held, { pageId: "shop" });
    expect(once.ids).toEqual(["home_a"]);
    const twice = pasteNodes(once.doc, held, { pageId: "shop" });
    expect(twice.ids[0]).not.toBe("home_a");
  });

  it("repoints a ref inside the copy at the copy, not at the original", () => {
    const doc = makeDoc(
      frame("screen", 390, 844, [
        frame("button", 100, 40, [], { reusable: true } as Partial<FrameNode>),
        { type: "ref", id: "use_1", ref: "button" } as any
      ])
    );
    const { doc: pasted, ids } = pasteNodes(doc, copyNodes(doc, ["screen"])!, {});

    const copy = findNode(pasted.children, ids[0]) as FrameNode;
    const copiedButton = copy.children!.find((n) => n.type === "frame")!;
    const copiedRef = copy.children!.find((n) => n.type === "ref")!;

    // The instance follows its component into the copy. Left pointing at
    // "button" it would render the original screen's component instead.
    expect((copiedRef as any).ref).toBe(copiedButton.id);
    expect((copiedRef as any).ref).not.toBe("button");
    // And the original is untouched.
    const original = findNode(pasted.children, "screen") as FrameNode;
    expect((original.children!.find((n) => n.type === "ref") as any).ref).toBe("button");
  });
});

describe("Where a paste lands", () => {
  it("places a pasted screen beside the page's screens, not on top of them", () => {
    const doc = makeDoc(screen("a", "home", 0), screen("b", "home", 470));
    const held = copyNodes(doc, ["a"])!;
    const { doc: pasted, ids } = pasteNodes(doc, held, {
      pageId: "home",
      siblings: screensOfPage(doc, "home")
    });
    // b ends at 470 + 390 = 860.
    expect((findNode(pasted.children, ids[0]) as FrameNode).x).toBe(940);
  });

  it("keeps a screen's own position when the destination page is empty", () => {
    const doc = twoPages();
    const held = copyNodes(doc, ["home_a"])!;
    const { doc: pasted, ids } = pasteNodes(doc, held, { pageId: "empty", siblings: [] });
    expect((findNode(pasted.children, ids[0]) as FrameNode).x).toBe(0);
  });

  it("pastes into a frame when asked, and does not touch the top level", () => {
    const doc = twoPages();
    const held = copyNodes(doc, ["home_a_box"])!;
    const before = doc.children.length;
    const { doc: pasted, ids } = pasteNodes(doc, held, { parentId: "shop_a" });
    expect(pasted.children).toHaveLength(before);
    const shop = findNode(pasted.children, "shop_a") as FrameNode;
    expect(shop.children!.some((n) => n.id === ids[0])).toBe(true);
  });

  it("falls back to the top level when the named parent cannot hold children", () => {
    const doc = twoPages();
    const held = copyNodes(doc, ["home_a_box"])!;
    const { doc: pasted, ids } = pasteNodes(doc, held, { parentId: "home_a_label", pageId: "shop" });
    expect(pasted.children.some((n) => n.id === ids[0])).toBe(true);
  });

  it("returns the document untouched when the clipboard is empty", () => {
    const doc = twoPages();
    const out = pasteNodes(doc, { nodes: [], fromRoot: true });
    expect(out.doc).toBe(doc);
    expect(out.ids).toEqual([]);
  });
});
