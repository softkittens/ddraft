import type { Document, PenNode, TextNode } from "../../model/types";
import { walkNodes } from "../../model/tree";
import { resolveVariable } from "../../model/variables";
import {
  designDirection,
  resolveStyle,
  styleGuidelines,
  StyleChoiceError,
  DIRECTION_METADATA_KEY,
  STYLE_METADATA_KEY
} from "../../design/styleSystem";
import type { DocumentToolDefinition } from "./types";

function freezeTokensOnChildren(nodes: PenNode[], oldVariables: Record<string, any>): void {
  walkNodes(nodes, (node) => {
    if (typeof (node as any).fill === "string" && (node as any).fill.startsWith("$")) {
      const resolved = resolveVariable((node as any).fill, oldVariables);
      if (resolved) (node as any).fill = resolved;
    } else if (
      (node as any).fill &&
      typeof (node as any).fill === "object" &&
      typeof (node as any).fill.color === "string" &&
      (node as any).fill.color.startsWith("$")
    ) {
      const resolved = resolveVariable((node as any).fill.color, oldVariables);
      if (resolved) (node as any).fill.color = resolved;
    }
    if (typeof (node as any).stroke === "string" && (node as any).stroke.startsWith("$")) {
      const resolved = resolveVariable((node as any).stroke, oldVariables);
      if (resolved) (node as any).stroke = resolved;
    }
    if (node.type === "text") {
      const text = node as TextNode;
      if (typeof text.fontFamily === "string" && text.fontFamily.startsWith("$")) {
        const resolved = resolveVariable(text.fontFamily, oldVariables);
        if (resolved) text.fontFamily = resolved;
      }
    }
  });
}

export const setStyleTool: DocumentToolDefinition = {
  name: "set_style",
  description:
    "Commit to a design direction, then choose its palette, roundness, elevation and typefaces. Writes the colour and font tokens onto the document and returns the usage rules for the chosen style. Call this before building on an unstyled document, or when the user explicitly requests a redesign, palette change, or theme update. Do not call this for localized element edits, copy changes, or image replacements.",
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
        /*
         * 8ca10dd0: "do not lock left/right topology" licensed generate_image
         * on the desktop rails. Subject, hierarchy, first action — not a
         * permission to invent a split the scaffold did not ask for.
         */
        description:
          "The first screen's intent: the focal subject, the hierarchy around it, and the first action a visitor can see. Describe only what a static canvas can show — not sticky, persistent or animated behaviour."
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
    if (newDoc.children.length > 0 && newDoc.variables && Object.keys(newDoc.variables).length > 0) {
      freezeTokensOnChildren(newDoc.children, newDoc.variables);
    }
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
      "Build and review against this contract as intent, not geometry. Where the",
      "canvas reads stronger than the arrangement you first imagined, keep the",
      "stronger canvas.",
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
