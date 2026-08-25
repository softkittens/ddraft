import { describe, it, expect } from "bun:test";
import { createDocumentTools } from "../src/agent/tools";
import { frame, rect, txt } from "./harness";
import { PAGE_METADATA_KEY, pageIdOf, screensOfPage } from "../src/model/pages";
import type { Document, FrameNode } from "../src/model/types";

/**
 * A canvas holding two pages, so every assertion below can name a node the run
 * is allowed to touch and a node it is not.
 */
function twoPageDoc(): Document {
  const screen = (id: string, page: string, x: number): FrameNode =>
    frame(id, 390, 844, [txt(`${id}_label`, "Hello"), rect(`${id}_box`, 40, 40)], {
      x,
      name: id,
      metadata: { screenKind: "mobile", [PAGE_METADATA_KEY]: page }
    } as Partial<FrameNode>);
  return {
    version: "2.17",
    children: [screen("home_a", "home", 0), screen("home_b", "home", 470), screen("shop_a", "shop", 940)],
    variables: {}
  };
}

const onPage = (doc: Document) => createDocumentTools(doc, {}, "home");

describe("The agent is contained to one page", () => {
  it("shows the run only the screens on its page", async () => {
    const digest = await onPage(twoPageDoc()).execute("read_digest", {});
    expect(digest).toContain("home_a");
    expect(digest).toContain("home_b");
    expect(digest).not.toContain("shop_a");
  });

  it("refuses to read a subtree on another page", async () => {
    const out = await onPage(twoPageDoc()).execute("read_digest", { id: "shop_a" });
    expect(out).toContain("another page");
  });

  it("refuses to write a property on another page, and leaves it unchanged", async () => {
    const tools = onPage(twoPageDoc());
    const out = await tools.execute("set_property", { id: "shop_a_label", property: "content", value: "Hijacked" });
    expect(out).toContain("another page");
    expect(JSON.stringify(tools.doc)).toContain("Hello");
    expect(JSON.stringify(tools.doc)).not.toContain("Hijacked");
  });

  it("fails a whole batch rather than applying the part of it that is in reach", async () => {
    const tools = onPage(twoPageDoc());
    const out = await tools.execute("batch_set_properties", {
      updates: [
        { id: "home_a_label", property: "content", value: "Allowed" },
        { id: "shop_a_label", property: "content", value: "Not allowed" }
      ]
    });
    expect(out).toContain("another page");
    // Atomic: the reachable half must not land either, or the model is told the
    // call failed while half of it silently took effect.
    expect(JSON.stringify(tools.doc)).not.toContain("Allowed");
  });

  it("refuses to delete, duplicate, move or revert a node on another page", async () => {
    for (const [tool, args] of [
      ["delete_node", { id: "shop_a" }],
      ["duplicate_node", { id: "shop_a" }],
      ["move_node", { id: "shop_a", newParentId: "home_a" }],
      ["revert_node", { id: "shop_a" }]
    ] as const) {
      const tools = onPage(twoPageDoc());
      const out = await tools.execute(tool, args);
      expect(out).toContain("another page");
      expect(screensOfPage(tools.doc, "shop").map((n) => n.id)).toEqual(["shop_a"]);
    }
  });

  it("refuses to insert into a parent on another page", async () => {
    const tools = onPage(twoPageDoc());
    const out = await tools.execute("insert_node", {
      parentId: "shop_a",
      node: { type: "rectangle", id: "smuggled", width: 10, height: 10 }
    });
    expect(out).toContain("another page");
    expect(JSON.stringify(tools.doc)).not.toContain("smuggled");
  });

  it("still says a node is missing when it is missing, not that it is elsewhere", async () => {
    const out = await onPage(twoPageDoc()).execute("set_property", {
      id: "no_such_node",
      property: "width",
      value: 10
    });
    expect(out).toContain("not found");
    expect(out).not.toContain("another page");
  });
});

describe("What the agent creates joins its page", () => {
  it("stamps a new screen with the page the run is working on", async () => {
    const tools = onPage(twoPageDoc());
    await tools.execute("create_screen", { name: "Settings", kind: "mobile" });
    const created = tools.doc.children[tools.doc.children.length - 1];
    expect(pageIdOf(created)).toBe("home");
    expect(screensOfPage(tools.doc, "home")).toHaveLength(3);
    expect(screensOfPage(tools.doc, "shop")).toHaveLength(1);
  });

  it("places a new screen beside its own page, not past every other page", async () => {
    const tools = onPage(twoPageDoc());
    await tools.execute("create_screen", { name: "Settings", kind: "mobile" });
    const created = tools.doc.children[tools.doc.children.length - 1] as FrameNode;
    // home_b ends at 470 + 390 = 860. Placing past shop_a would put it at 1410.
    expect(created.x).toBe(940);
  });

  it("puts a node moved out to the canvas on the page rather than nowhere", async () => {
    const tools = onPage(twoPageDoc());
    await tools.execute("move_node", { id: "home_a_box", newParentId: "canvas" });
    const moved = tools.doc.children.find((n) => n.id === "home_a_box");
    expect(moved).toBeDefined();
    expect(pageIdOf(moved!)).toBe("home");
  });

  it("reports the page, not the canvas, after a move out to the root", async () => {
    const tools = onPage(twoPageDoc());
    const out = await tools.execute("move_node", { id: "home_a_box", newParentId: "canvas" });
    expect(out).not.toContain("shop_a");
  });
});

describe("A document with no pages behaves exactly as before", () => {
  const noPages = (): Document => ({
    version: "2.17",
    children: [
      frame("a", 390, 844, [txt("a_label", "Hello")], { name: "A" } as Partial<FrameNode>),
      frame("b", 390, 844, [], { name: "B", x: 470 } as Partial<FrameNode>)
    ],
    variables: {}
  });

  it("shows every screen and guards nothing", async () => {
    const tools = createDocumentTools(noPages());
    const digest = await tools.execute("read_digest", {});
    expect(digest).toContain("a");
    expect(digest).toContain("b");

    const wrote = await tools.execute("set_property", { id: "a_label", property: "content", value: "Changed" });
    expect(wrote).not.toContain("another page");
    expect(JSON.stringify(tools.doc)).toContain("Changed");
  });

  it("leaves a new screen unlabelled, so it stays on the implicit page", async () => {
    const tools = createDocumentTools(noPages());
    await tools.execute("create_screen", { name: "Third", kind: "mobile" });
    const created = tools.doc.children[tools.doc.children.length - 1];
    expect(pageIdOf(created)).toBeUndefined();
  });

  it("pins operations to targetPageId across passes even if active page changes", async () => {
    // Unpaged document pinned to undefined keeps all screens in reach
    const unpaged = noPages();
    const toolsUnpaged = createDocumentTools(unpaged, {}, undefined);
    const digestUnpaged = await toolsUnpaged.execute("read_digest", {});
    expect(digestUnpaged).toContain("a");
    expect(digestUnpaged).toContain("b");

    // Multi-page document pinned to "home" stays on "home" even when other pages exist
    const doc = twoPageDoc();
    const toolsHome = createDocumentTools(doc, {}, "home");
    const digestHome = await toolsHome.execute("read_digest", {});
    expect(digestHome).toContain("home_a");
    expect(digestHome).not.toContain("shop_a");

    const toolsShop = createDocumentTools(doc, {}, "shop");
    const digestShop = await toolsShop.execute("read_digest", {});
    expect(digestShop).toContain("shop_a");
    expect(digestShop).not.toContain("home_a");
  });
});
