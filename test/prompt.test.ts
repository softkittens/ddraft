import { describe, it, expect } from "bun:test";
import { makeDoc } from "./harness";
import { agentSystemPrompt } from "../src/agent/prompt";
import { STYLE_METADATA_KEY, DIRECTION_METADATA_KEY } from "../src/design/styleSystem";

describe("System prompt carries rules, not a design", () => {
  const prompt = agentSystemPrompt(makeDoc(), [], "test-model");

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
  });

  it("requires real generated imagery for image-led products", () => {
    expect(prompt).toContain("generate_image");
    expect(prompt).toContain("first viewport");
  });

  it("does not treat every mobile screen as an app with a tab bar", () => {
    expect(prompt).toContain("Omit tabs unless this is a multi-destination app");
  });

  it("enforces universal craft disciplines and anti-pattern constraints", () => {
    expect(prompt).toContain("Anti-Box-in-Box Nesting");
    expect(prompt).toContain("Do not put an eyebrow or kicker above a heading");
    expect(prompt).toContain("at most two visible roles per screen");
    expect(prompt).toContain("Never invent a claim");
    expect(prompt).toContain("marketing, not content");
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
    expect(Math.max(...lengths)).toBeLessThan(22000);
  });

  it("states the chrome once in code, not as numbers to remember on every run", () => {
    expect(prompt).toContain("create_screen");
    expect(prompt).not.toMatch(/height 56|height: 56|cornerRadius 9999/);
    expect(prompt).not.toMatch(/padding \[0, ?16, ?12, ?16\]/);
    expect(prompt).not.toMatch(/Status bar — height 62|height 62/);
  });

  it("dynamically composes rules tailored to the user request intent", () => {
    // 1. Mobile Food Ordering request
    const foodPrompt = agentSystemPrompt(makeDoc(), [], "test-model", 0, [], "Create mobile app for ordering matcha cakes");
    expect(foodPrompt).toContain("MOBILE SCREEN COMPOSITION");
    expect(foodPrompt).toContain("E-COMMERCE & FOOD / CONSUMER ORDERING APP DENSITY");
    expect(foodPrompt).not.toContain("SITE & LANDING PAGE COMPOSITION");
    expect(foodPrompt).not.toContain("OPERATIONAL TOOL & DASHBOARD COMPOSITION");

    // 2. Desktop Landing Page request
    const sitePrompt = agentSystemPrompt(makeDoc(), [], "test-model", 0, [], "Landing page for Lisbon coworking space");
    expect(sitePrompt).toContain("SITE & LANDING PAGE COMPOSITION");
    expect(sitePrompt).not.toContain("MOBILE SCREEN COMPOSITION");
    expect(sitePrompt).not.toContain("E-COMMERCE & FOOD");

    // 3. Operational Dashboard request
    const dashPrompt = agentSystemPrompt(makeDoc(), [], "test-model", 0, [], "Kubernetes cluster monitoring dashboard");
    expect(dashPrompt).toContain("OPERATIONAL TOOL & DASHBOARD COMPOSITION");
    expect(dashPrompt).not.toContain("SITE & LANDING PAGE COMPOSITION");
    expect(dashPrompt).not.toContain("E-COMMERCE & FOOD");
  });

  it("switches to focused revision order-of-work on incremental edit requests", () => {
    const doc: any = {
      id: "doc_1",
      name: "Canvas",
      children: [
        {
          id: "screen_1",
          name: "Screen",
          type: "frame",
          width: 390,
          height: 844,
          children: [
            { id: "child_1", type: "frame", children: [] },
            { id: "child_2", type: "text", content: "Hello" }
          ]
        }
      ]
    };
    const editPrompt = agentSystemPrompt(doc, [], "test-model", 0, [], "change the title text to italic and fix padding");
    expect(editPrompt).toContain("ORDER OF WORK — REVISION & INCREMENTAL EDITS");
    expect(editPrompt).not.toContain("ORDER OF WORK — DESIGN REQUESTS ONLY");
  });
});
