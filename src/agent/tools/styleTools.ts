import type { Document } from "../../model/types";
import {
  designDirection,
  resolveStyle,
  styleGuidelines,
  StyleChoiceError,
  DIRECTION_METADATA_KEY,
  STYLE_METADATA_KEY
} from "../../design/styleSystem";
import type { DocumentToolDefinition } from "./types";

export const setStyleTool: DocumentToolDefinition = {
  name: "set_style",
  description:
    "Commit to a design direction, then choose its palette, roundness, elevation and typefaces. Writes the colour and font tokens onto the document and returns the usage rules for the chosen style. Call this before building anything on an unstyled document. Every argument must name an option from the catalog in the system prompt.",
  parameters: {
    type: "object",
    properties: {
      palette: {
        type: "string",
        description: "Palette name, e.g. 'Carbon Frost'"
      },
      roundness: {
        type: "string",
        description: "Roundness scale name, e.g. 'Basic'"
      },
      elevation: {
        type: "string",
        description: "Elevation preset name, e.g. 'Soft Lift'"
      },
      headings: {
        type: "string",
        description: "Typeface for titles and section headings"
      },
      body: {
        type: "string",
        description: "Typeface for paragraphs and list titles"
      },
      captions: {
        type: "string",
        description: "Typeface for labels, metadata and badges"
      },
      thesis: {
        type: "string",
        description: "The visual idea and the familiar category arrangement this design refuses"
      },
      ownWorld: {
        type: "string",
        description: "Palette and component language recognizable even with the copy removed"
      },
      firstViewport: {
        type: "string",
        description: "Exact first-screen composition, including dominant element and scale"
      }
    },
    required: [
      "palette",
      "roundness",
      "elevation",
      "headings",
      "body",
      "captions",
      "thesis",
      "ownWorld",
      "firstViewport"
    ]
  },
  execute: (ctx, a) => {
    let style;
    try {
      style = resolveStyle(a as Record<string, unknown>);
    } catch (err) {
      if (err instanceof StyleChoiceError) return `error: ${err.message}`;
      throw err;
    }
    const direction = designDirection(a);
    if (!direction) return "error: thesis, ownWorld and firstViewport are required";

    const newDoc: Document = structuredClone(ctx.doc);
    newDoc.variables = { ...(newDoc.variables ?? {}), ...style.variables };
    newDoc.metadata = {
      ...(newDoc.metadata ?? {}),
      [STYLE_METADATA_KEY]: style.choice,
      [DIRECTION_METADATA_KEY]: direction
    };
    ctx.setDoc(newDoc);

    return [
      `ok: style set. ${Object.keys(style.variables).length} tokens written to the document.`,
      "Use these tokens everywhere. Follow these rules for the rest of the design:",
      "",
      `DIRECTION — ${direction.thesis}`,
      `OWN WORLD — ${direction.ownWorld}`,
      `FIRST VIEWPORT — ${direction.firstViewport}`,
      "Build and review against this contract. If the canvas contradicts it, revise the canvas.",
      "",
      styleGuidelines(style)
    ].join("\n");
  }
};

export const setVariableTool: DocumentToolDefinition = {
  name: "set_variable",
  description:
    "Update a theme token/variable (e.g. name: 'bg', value: '#FFFFFF'). Instantly updates all elements referencing $name across the document.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Variable name without $ (e.g. 'bg', 'surface', 'surface-raised', 'line', 'text', 'muted')"
      },
      value: {
        type: "string",
        description: "Hex color code or value (e.g. '#FFFFFF', '#0F172A')"
      }
    },
    required: ["name", "value"]
  },
  execute: (ctx, a) => {
    const rawName = typeof a.name === "string" ? a.name.replace(/^\$/, "").trim() : "";
    if (!rawName) return "error: variable name is required";
    if (a.value === undefined) return "error: variable value is required";

    const newDoc: Document = structuredClone(ctx.doc);
    if (!newDoc.variables) newDoc.variables = {};

    const isColorString =
      typeof a.value === "string" &&
      (a.value.startsWith("#") ||
        a.value.startsWith("rgb(") ||
        a.value.startsWith("rgba(") ||
        a.value.startsWith("hsl(") ||
        a.value.startsWith("hsla("));

    const existing = newDoc.variables[rawName];
    if (typeof existing === "object" && existing !== null && "type" in existing) {
      newDoc.variables[rawName] = { ...existing, value: a.value };
    } else {
      newDoc.variables[rawName] = isColorString ? { type: "color", value: a.value } : a.value;
    }

    ctx.setDoc(newDoc);
    return `ok: variable $${rawName} = ${JSON.stringify(a.value)}`;
  }
};

export const styleTools = [setStyleTool, setVariableTool];
