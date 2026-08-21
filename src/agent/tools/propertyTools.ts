import { setProperty } from "../../model/edit";
import { findNode } from "../../model/tree";
import { digestSubtree } from "../../digest/digest";
import { layoutResolvedDocument, flattenLayoutTree } from "../../layout/layout";
import { resolveInstances } from "../../model/instance";
import {
  type DocumentToolDefinition,
  ALLOWED_PROPERTIES,
  GEOMETRY_PROPERTIES,
  digestId,
  splitInstanceId,
  setInstanceProperty,
  applyIconRename,
  resizesMobileScreen,
  mobileSizeError,
  measuredNote,
  formatLayout
} from "./types";

export const readDigestTool: DocumentToolDefinition = {
  name: "read_digest",
  description: "Return a structural digest. Omit id for the whole document. Pass a node id for a subtree.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string"
      }
    }
  },
  execute: (ctx, a) => {
    return digestSubtree(ctx.doc, digestId(ctx.doc, a.id));
  }
};

export const setPropertyTool: DocumentToolDefinition = {
  name: "set_property",
  description:
    "Update a property on an existing node. Valid properties: width, height, x, y, gap, padding, fill, stroke, strokeWidth, name, content, fontSize, fontWeight, fontFamily, letterSpacing, lineHeight, textAlign, textGrowth, layout, justifyContent, alignItems, opacity, rotation, cornerRadius, clip, enabled, layoutPosition, effect, icon, reusable, ref.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Node ID"
      },
      property: {
        type: "string",
        description: "Property name to update"
      },
      value: {
        description: "New value"
      }
    },
    required: ["id", "property", "value"]
  },
  execute: (ctx, a) => {
    let doc = ctx.doc;
    if (typeof a.id !== "string" || typeof a.property !== "string") {
      return "error: id and property are required";
    }
    if (!ALLOWED_PROPERTIES.has(a.property)) {
      return `error: invalid property "${a.property}"`;
    }
    if (!findNode(doc.children, a.id)) {
      const inside = splitInstanceId(doc, a.id);
      if (!inside) return `error: node ${a.id} not found`;
      const beforeInstance = doc;
      doc = setInstanceProperty(doc, inside, a.property, a.value);
      if (doc === beforeInstance) {
        return `error: could not override ${inside.descendantId} in ${inside.refId}`;
      }
      ctx.setDoc(doc);
      const loopNote = ctx.recordWrite(a.id, a.property, a.value);
      return [
        `ok: set ${a.property} on ${inside.descendantId} inside instance ${inside.refId}. Only this instance changed.`,
        GEOMETRY_PROPERTIES.has(a.property) ? measuredNote(doc, inside.refId) : "",
        loopNote
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (resizesMobileScreen(doc, a.id, a.property)) return mobileSizeError(a.id);
    const beforeWrite = doc;
    doc = setProperty(doc, a.id, a.property, a.value);
    doc = applyIconRename(doc, a.id, a.property, a.value);

    if (doc === beforeWrite) {
      return `no change: ${a.id}.${a.property} is already ${JSON.stringify(a.value)}. Something else is deciding this box — measure it, or change the parent instead.`;
    }
    ctx.setDoc(doc);
    const note = GEOMETRY_PROPERTIES.has(a.property) ? measuredNote(doc, a.id) : "";
    const loop = ctx.recordWrite(a.id, a.property, a.value);
    return [digestSubtree(doc, a.id), note, loop].filter(Boolean).join("\n");
  }
};

export const batchSetPropertiesTool: DocumentToolDefinition = {
  name: "batch_set_properties",
  description: "Update multiple properties across multiple nodes in one atomic call.",
  parameters: {
    type: "object",
    properties: {
      updates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string"
            },
            property: {
              type: "string"
            },
            value: {}
          },
          required: ["id", "property", "value"]
        },
        description: "Array of { id, property, value } updates to apply in order"
      }
    },
    required: ["updates"]
  },
  execute: (ctx, a) => {
    let doc = ctx.doc;
    const updates: Array<Record<string, unknown>> = Array.isArray(a.updates) ? a.updates : [];
    if (updates.length === 0) return "error: updates array is required";

    const blocked = updates.find(
      (u) =>
        u &&
        typeof u.id === "string" &&
        typeof u.property === "string" &&
        resizesMobileScreen(doc, u.id, u.property)
    );
    if (blocked) {
      return mobileSizeError(blocked.id as string);
    }

    let newDoc = doc;
    const modifiedIds: string[] = [];

    for (const u of updates) {
      if (!u || typeof u.id !== "string" || typeof u.property !== "string") continue;
      if (!ALLOWED_PROPERTIES.has(u.property)) continue;
      if (!findNode(newDoc.children, u.id)) {
        const inside = splitInstanceId(newDoc, u.id);
        if (!inside) continue;
        newDoc = setInstanceProperty(newDoc, inside, u.property, u.value);
        modifiedIds.push(`${u.id}.${u.property}`);
        continue;
      }
      newDoc = setProperty(newDoc, u.id, u.property, u.value);
      newDoc = applyIconRename(newDoc, u.id, u.property, u.value);
      modifiedIds.push(`${u.id}.${u.property}`);
    }

    const unchanged = newDoc === doc && modifiedIds.length > 0;
    doc = newDoc;
    ctx.setDoc(doc);
    const head = `ok: updated ${modifiedIds.length} properties (${modifiedIds.slice(0, 6).join(", ")}${modifiedIds.length > 6 ? "..." : ""})`;
    if (unchanged) {
      return `${head}\nno change: every value was already set. Something else is deciding these boxes — measure them, or change the parent instead.`;
    }
    const touched: string[] = [
      ...new Set(
        updates
          .filter(
            (u) =>
              u &&
              typeof u.id === "string" &&
              typeof u.property === "string" &&
              GEOMETRY_PROPERTIES.has(u.property)
          )
          .map((u) => u.id as string)
      )
    ].slice(0, 6);
    const notes = touched.map((id) => measuredNote(doc, id)).filter(Boolean);
    const loops = updates
      .filter((u) => u && typeof u.id === "string" && typeof u.property === "string")
      .map((u) => ctx.recordWrite(u.id as string, u.property as string, u.value))
      .filter(Boolean);
    return [head, ...notes, ...loops].join("\n");
  }
};

export const measureTool: DocumentToolDefinition = {
  name: "measure",
  description:
    "Inspect computed layout boxes (x, y, width, height) after layout has run. Useful to check actual sizes of fit_content / fill_container nodes.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Node ID to inspect (omit for all root frames)"
      }
    }
  },
  execute: (ctx, a) => {
    const doc = ctx.doc;
    const targetId = digestId(doc, a.id);
    const resolvedTree = layoutResolvedDocument(resolveInstances(doc));

    if (targetId) {
      const flat = flattenLayoutTree(resolvedTree);
      const node = flat.get(targetId);
      if (!node) return `error: node ${targetId} not found`;
      const name = findNode(doc.children, targetId)?.name;
      return [
        `Resolved geometry for ${name ? `"${name}" (${targetId})` : targetId}.`,
        "Each box is x,y,width,height in its parent's coordinate space.",
        formatLayout(node, doc, 0)
      ].join("\n");
    }

    if (resolvedTree.length === 0) return "The document has no top-level frames.";
    return [
      "Resolved geometry for every top-level frame.",
      "Each box is x,y,width,height in its parent's coordinate space.",
      ...resolvedTree.map((root) => formatLayout(root, doc, 0))
    ].join("\n");
  }
};

export const propertyTools = [
  readDigestTool,
  setPropertyTool,
  batchSetPropertiesTool,
  measureTool
];
