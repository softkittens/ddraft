import { describe, it, expect } from "bun:test";
import { makeDoc } from "./harness";
import { agentSystemPrompt } from "../src/agent/prompt";
import { STYLE_METADATA_KEY, DIRECTION_METADATA_KEY } from "../src/design/styleSystem";

describe("System prompt carries rules, not a design", () => {
  const prompt = agentSystemPrompt(makeDoc(), [], "test-model");

  it("contains no product, no copy and no palette of its own", () => {
    const leakedFromATemplate = [
      "MANE",
      "Thunderbolt",
      "Arabian",
      "Grass-fed",
      "Grand Prix",
      "Carrot",
      "Portland",
      "Starlight",
      "Maya Bennett",
      "gallops",
      "Lorem",
      "SYSTEMS NOMINAL",
      "Shift Handoff",
      "Fleet Registry",
      "Floor 03",
      "Live Production",
      "MAINT"
    ];
    for (const literal of leakedFromATemplate) {
      expect(prompt).not.toContain(literal);
    }
  });

  it("contains no emoji, having told the model not to use them", () => {
    expect(prompt).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("asks for a style before anything is built", () => {
    expect(prompt).toContain("set_style");
    expect(prompt).toContain("No style is set on this document yet.");
  });

  it("lets the model distinguish design work from ordinary conversation", () => {
    expect(prompt).toContain("Decide whether the request requires design work");
    expect(prompt).toMatch(/Otherwise,\s+call answer_user/);
    expect(prompt).not.toContain("[no canvas change]");
  });

  it("requires real generated imagery for image-led products", () => {
    expect(prompt).toContain("product depends on photography or illustration");
    expect(prompt).toContain("first viewport");
    expect(prompt).toMatch(/call\s+generate_image/);
    expect(prompt).not.toContain("review_design");
  });

  it("does not treat every mobile screen as an app with a tab bar", () => {
    expect(prompt).toContain("Omit tabs unless this is a multi-destination app");
  });

  it("splits site pages from tools and tells a site to stay tall", () => {
    expect(prompt).toContain("SITE (persuade)");
    expect(prompt).toContain("from the surface, not the product");
    expect(prompt).toContain("A landing page is still SITE");
    expect(prompt).toContain("leave rail and aside empty");
    expect(prompt).toContain("height 2800-4500");
    expect(prompt).toContain("one shoot");
  });

  it("names the template reflexes it refuses and exposes full-bleed composition", () => {
    expect(prompt).toContain("edge-to-edge imagery or colour in bleed");
    expect(prompt).toContain("Do not put an eyebrow or kicker above a heading");
    expect(prompt).toContain("same-size icon + heading + text cards");
    expect(prompt).toContain("Three or more equal cards");
    expect(prompt).toContain("not a product");
    expect(prompt).toContain("about a third of the screen");
    expect(prompt).toContain("nest cards inside cards");
    expect(prompt).toContain("at most two visible roles per screen");
    expect(prompt).toContain("gradient text");
    expect(prompt).toContain("decorative blobs");
    expect(prompt).toContain("blur as decoration");
    expect(prompt).not.toContain("monospace as a costume");
  });

  it("separates inventing content from inventing a claim", () => {
    expect(prompt).toMatch(/Invent the names, numbers and copy/);
    expect(prompt).toContain("Never invent a claim");
    expect(prompt).toContain("marketing, not content");
  });

  it("takes the colour scheme from the use scene rather than the category", () => {
    expect(prompt).toContain("Take light or dark from where the product is used");
  });

  it("tells the model it can name an icon without looking it up first", () => {
    expect(prompt).toContain("Write the name straight onto the node");
    expect(prompt).toContain("search_icons is only for a name you doubt exists");
  });

  it("states the tool budget instead of enforcing one it never mentioned", () => {
    expect(prompt).toContain("BUDGET");
    expect(prompt).toContain("Reuse ids from earlier tool results");
  });

  it("states the style rules once a style is chosen, and drops the catalog", () => {
    const doc = makeDoc();
    doc.metadata = {
      [STYLE_METADATA_KEY]: {
        palette: "Terminal Green",
        roundness: "Sharp",
        elevation: "Flat",
        headings: "Geist Mono",
        body: "Geist Mono",
        captions: "IBM Plex Mono"
      }
    };
    const styled = agentSystemPrompt(doc, [], "test-model");
    expect(styled).toContain("Terminal Green");
    expect(styled).not.toContain("No style is set");
    expect(styled).not.toContain("Deep Space Neon");
  });

  it("restates the recorded direction as a build contract", () => {
    const doc = makeDoc();
    doc.metadata = {
      [STYLE_METADATA_KEY]: {
        palette: "Terminal Green",
        roundness: "Sharp",
        elevation: "Flat",
        headings: "Geist Mono",
        body: "Geist Mono",
        captions: "IBM Plex Mono"
      },
      [DIRECTION_METADATA_KEY]: {
        thesis: "A command surface, not a card dashboard",
        ownWorld: "Black phosphor field with hard dividers",
        firstViewport: "A 56px alert over one dense queue"
      }
    };
    const styled = agentSystemPrompt(doc, [], "test-model");
    expect(styled).toContain("RECORDED DIRECTION CONTRACT");
    expect(styled).toContain("THESIS: A command surface, not a card dashboard");
    expect(styled).toContain("A claim not visible on the canvas is unfinished");
  });

  it("costs less than the template it replaced", () => {
    const lengths = [...Array(60)].map((_, seed) =>
      agentSystemPrompt({ id: "d", name: "d", children: [] } as any, [], "test-model", seed).length
    );
    expect(Math.max(...lengths)).toBeLessThan(12000);
  });

  it("states the chrome once in code, not as numbers to remember on every run", () => {
    expect(prompt).toContain("create_screen");
    expect(prompt).not.toMatch(/height 56|height: 56|cornerRadius 9999/);
    expect(prompt).not.toMatch(/padding \[0, ?16, ?12, ?16\]/);
    expect(prompt).not.toMatch(/Status bar — height 62|height 62/);
  });
});
