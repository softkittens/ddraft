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

  it("requires 44px icon-only controls only for mobile surfaces", () => {
    const mobile = agentSystemPrompt(makeDoc(), [], "test-model", 0, [], "Create a mobile ordering app");
    const desktop = agentSystemPrompt(makeDoc(), [], "test-model", 0, [], "Create a desktop ordering website");

    expect(mobile).toContain("Icon-only controls");
    expect(mobile).toContain("44x44px container");
    expect(desktop).not.toContain("44x44px container");
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
    expect(prompt).toContain("100 rounds");
  });

  it("states the round cap this run will actually enforce", () => {
    // eval/run.ts cuts at 14 while the prompt printed MAX_MODEL_ROUNDS (100).
    // Wrap-up uses the real cap, so the model was told it had 100 rounds and
    // then heard "4 rounds left" at turn 10.
    const evalPrompt = agentSystemPrompt(makeDoc(), [], "test-model", 0, [], "", "", 14);
    expect(evalPrompt).toContain("14 rounds");
    expect(evalPrompt).not.toContain("100 rounds");
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
    // 8ca10dd0: "not a geometry specification" plus "don't lock left/right"
    // licensed a rail collage the critic then blessed. Subject, hierarchy,
    // first action, static canvas — not a permission to invent a topology.
    expect(styled).not.toContain("geometry specification");
    expect(styled).not.toContain("left/right");
    expect(styled).toContain("static canvas");
    expect(styled).not.toContain("A claim not visible on the canvas is unfinished");
  });

  it("tells a site run the slots create_screen will actually return, not rails to leave empty", () => {
    // 8ca10dd0: "leave rail empty" next to create_screen returning rail ids
    // taught the model the slots existed. Interpolate the real list instead.
    const site = agentSystemPrompt(makeDoc(), [], "test-model", 0, [], "Landing page for Lisbon coworking space");
    expect(site).toContain("returns topBar, main");
    expect(site).not.toContain("returns topBar, rail, main, aside");
    expect(site).not.toContain("never insert_node or generate_image");
    expect(site).not.toContain("left/right");
  });

  it("tells a tool run that desktop chrome includes the rails", () => {
    const tool = agentSystemPrompt(makeDoc(), [], "test-model", 0, [], "Kubernetes cluster monitoring dashboard");
    expect(tool).toContain("returns topBar, rail, main, aside");
  });

  it("costs less than the template it replaced", () => {
    const lengths = [...Array(60)].map((_, seed) =>
      agentSystemPrompt({ id: "d", name: "d", children: [] } as any, [], "test-model", seed).length
    );
    expect(Math.max(...lengths)).toBeLessThan(25000);
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
    expect(foodPrompt).toContain("E-COMMERCE & FOOD / CONSUMER ORDERING CAPABILITIES");
    expect(foodPrompt).toContain("Do not automatically produce header + search + dark hero");
    expect(foodPrompt).not.toContain("strictly follow this mobile hierarchy");
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
    expect(editPrompt).toContain("batch_set_properties, set_property, or insert_node");
    expect(editPrompt).not.toContain(", set_properties");

    // A focused revision instruction loses to a blueprint telling the model to
    // stack eight narrative bands, so the blueprints do not ship with it.
    expect(editPrompt).not.toContain("SITE & LANDING PAGE COMPOSITION");
    expect(editPrompt).not.toContain("OPERATIONAL TOOL & DASHBOARD COMPOSITION");
    expect(editPrompt).not.toContain("E-COMMERCE & FOOD");
    // The surface blueprint stays: its ergonomics and token rules apply to any edit.
    expect(editPrompt).toContain("MOBILE SCREEN COMPOSITION");
  });

  it("never sends a 1440 blueprint to a request that asked only for a phone", () => {
    const mobileTool = agentSystemPrompt(makeDoc(), [], "test-model", 0, [], "Mobile analytics app");
    expect(mobileTool).toContain("MOBILE SCREEN COMPOSITION");
    expect(mobileTool).not.toContain("OPERATIONAL TOOL & DASHBOARD COMPOSITION");
    expect(mobileTool).not.toContain("SITE & LANDING PAGE COMPOSITION");
  });

  it("keeps a landing page for a dashboard product on the site blueprint", () => {
    const p = agentSystemPrompt(makeDoc(), [], "test-model", 0, [], "Landing page for an analytics dashboard product");
    expect(p).toContain("SITE & LANDING PAGE COMPOSITION");
    expect(p).not.toContain("OPERATIONAL TOOL & DASHBOARD COMPOSITION");
  });

  it("deals the style hand from the brief, not a generic costume table", () => {
    const p = agentSystemPrompt(
      makeDoc(),
      [],
      "test-model",
      7,
      [],
      "Warm minimal booking site for a Lisbon coworking space"
    );
    expect(p).not.toContain("If the look is guessable");
    expect(p).not.toContain("Neobrutalism");
    expect(p).toContain("Four Distinct Hero Archetypes");
    expect(p).toContain("AVOID THE ROBOTIC 6-BAND CLONE");
  });

  it("supplies the style and composition catalog when a review reports a direction or style mismatch", () => {
    const doc = makeDoc();
    doc.metadata = {
      [STYLE_METADATA_KEY]: {
        composition: "Cinematic Hero & Narrative",
        palette: "Retro",
        roundness: "Sharp",
        elevation: "Flat",
        headings: "Funnel Display",
        body: "Inter",
        captions: "Inter"
      }
    };
    const mismatchPrompt = agentSystemPrompt(
      doc,
      [],
      "test-model",
      42,
      [],
      "[Visual review revision - Direction mismatch: restyle permitted]\nOriginal brief: Space tourism landing page\n- Direction mismatch: The nostalgic 1969 diner aesthetic undermines aerospace passenger trust. Call set_style to select a contemporary credible visual foundation."
    );
    expect(mismatchPrompt).toContain("COMPOSITION (choose one for composition)");
    expect(mismatchPrompt).toContain("PALETTES (name — world)");
    expect(mismatchPrompt).toContain("set_style");
  });

  it("omits the style catalog for normal visual review revisions that do not have direction mismatch", () => {
    const doc = makeDoc();
    doc.metadata = {
      [STYLE_METADATA_KEY]: {
        composition: "Cinematic Hero & Narrative",
        palette: "Carbon Frost",
        roundness: "Basic",
        elevation: "Soft Lift",
        headings: "Inter",
        body: "Inter",
        captions: "Inter"
      }
    };
    const normalRevisionPrompt = agentSystemPrompt(
      doc,
      [],
      "test-model",
      42,
      [],
      "[Visual review revision]\nOriginal brief: Space tourism landing page\n- [Desktop] Button alignment (btn-1): Center icon within container and increase horizontal padding to 20px."
    );
    expect(normalRevisionPrompt).not.toContain("COMPOSITION (choose one for composition)");
    expect(normalRevisionPrompt).not.toContain("PALETTES (name — world)");
    expect(normalRevisionPrompt).toContain("The document already has a style. Keep it for normal edits.");
  });
});
