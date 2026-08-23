import type { Document } from "../../model/types";
import { setProperty } from "../../model/edit";
import { childrenOf, findNode, findParent } from "../../model/tree";
import { digestSubtree } from "../../digest/digest";
import { layoutResolvedDocument, flattenLayoutTree } from "../../layout/layout";
import { resolveInstances, setInstanceProperty, splitInstanceId } from "../../model/instance";
import {
  type DocumentToolDefinition,
  ALLOWED_PROPERTIES,
  GEOMETRY_PROPERTIES,
  digestId,
  applyIconRename,
  screenSizeError,
  measuredNote,
  formatLayout,
  resolvePercentSizes
} from "./types";
import { normalizePropertyValue } from "./normalize";

function checkLayoutTransition(
  beforeDoc: Document,
  nodeId: string,
  property: string,
  value: unknown
): string {
  if (property !== "layout" || (value !== "vertical" && value !== "horizontal")) {
    return "";
  }
  const target = findNode(beforeDoc.children, nodeId);
  if (!target || target.type !== "frame" || (target.layout && target.layout !== "none")) {
    return "";
  }
  const oversized = childrenOf(target).filter(
    (c) => typeof c.height === "number" && c.height > 600
  );
  if (oversized.length === 0) return "";
  const names = oversized.map((k) => `"${k.name ?? k.id}" (${k.height}px)`).join(", ");
  return `\nnote: Switched "${target.name ?? nodeId}" from absolute to ${value} layout. Child ${names} still has a large fixed height from absolute layout. Consider resizing it to fit normal flow (e.g. 400-520px or fill_container).`;
}

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
    const off = ctx.offPage(typeof a.id === "string" ? a.id.trim() : undefined);
    if (off) return off;
    return digestSubtree(ctx.pageDoc, digestId(ctx.pageDoc, a.id));
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
    const vocabulary = normalizePropertyValue(a.property, a.value);
    if (vocabulary.value === undefined) return vocabulary.note;
    a.value = vocabulary.value;
    const vocabularyNote = vocabulary.note;
    const offTarget = ctx.offPage(a.id);
    if (offTarget) return offTarget;
    if (!findNode(doc.children, a.id)) {
      const inside = splitInstanceId(doc, a.id);
      if (!inside) return `error: node ${a.id} not found`;
      // A composite instance id is not a node, so the guard above passed it
      // through. The ref it names is a node, and that is what gets written.
      const offInstance = ctx.offPage(inside.refId);
      if (offInstance) return offInstance;
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
    const sizeError = screenSizeError(doc, a.id, a.property, a.value);
    if (sizeError) return sizeError;
    const beforeWrite = doc;
    doc = setProperty(doc, a.id, a.property, a.value);
    doc = applyIconRename(doc, a.id, a.property, a.value);

    const parent = findParent(doc.children, a.id);
    const parentLayout = parent && parent.type === "frame" ? (parent as any).layout : undefined;
    const isAutoLayout = parentLayout === "horizontal" || parentLayout === "vertical";
    let layoutTip =
      (a.property === "x" || a.property === "y") && isAutoLayout
        ? `\nnote: "${a.id}" is inside auto-layout parent "${parent!.name ?? parent!.id}" (layout: "${parentLayout}"). Position coordinates (x, y) are ignored by auto-layout. To center or align this child, set justifyContent: "center" and alignItems: "center" on parent "${parent!.id}".`
        : "";

    const transitionTip = checkLayoutTransition(beforeWrite, a.id, a.property, a.value);
    if (transitionTip) layoutTip += transitionTip;

    if (doc === beforeWrite) {
      return `no change: ${a.id}.${a.property} is already ${JSON.stringify(a.value)}. Something else is deciding this box — measure it, or change the parent instead.${layoutTip}`;
    }
    const percent = resolvePercentSizes(doc);
    doc = percent.doc;
    ctx.setDoc(doc);
    const note = GEOMETRY_PROPERTIES.has(a.property) ? measuredNote(doc, a.id) : "";
    const loop = ctx.recordWrite(a.id, a.property, a.value);
    return [digestSubtree(doc, a.id), vocabularyNote, ...percent.notes, note, loop, layoutTip].filter(Boolean).join("\n");
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

    for (const u of updates) {
      if (!u || typeof u.id !== "string") continue;
      // The batch is atomic, so one off-page id fails the call rather than
      // silently applying the rest against a page the run cannot see.
      const off = ctx.offPage(u.id) ?? ctx.offPage(splitInstanceId(doc, u.id)?.refId);
      if (off) return off;
    }

    const blocked = updates.find((u) => {
      if (!u || typeof u.id !== "string" || typeof u.property !== "string") return false;
      return Boolean(screenSizeError(doc, u.id, u.property, u.value));
    });
    if (blocked) {
      return screenSizeError(doc, blocked.id as string, blocked.property as string, blocked.value)!;
    }

    let newDoc = doc;
    const modifiedIds: string[] = [];
    const vocabularyNotes: string[] = [];

    for (const u of updates) {
      if (!u || typeof u.id !== "string" || typeof u.property !== "string") continue;
      if (!ALLOWED_PROPERTIES.has(u.property)) continue;
      const vocabulary = normalizePropertyValue(u.property, u.value);
      if (vocabulary.value === undefined) { vocabularyNotes.push(vocabulary.note); continue; }
      if (vocabulary.note) vocabularyNotes.push(vocabulary.note);
      u.value = vocabulary.value;
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
    const percent = resolvePercentSizes(newDoc);
    doc = percent.doc;
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
    const notes = [...percent.notes, ...touched.map((id) => measuredNote(doc, id)).filter(Boolean)];
    const loops = updates
      .filter((u) => u && typeof u.id === "string" && typeof u.property === "string")
      .map((u) => ctx.recordWrite(u.id as string, u.property as string, u.value))
      .filter(Boolean);
    const transitionTips = updates
      .filter((u) => u && typeof u.id === "string" && typeof u.property === "string")
      .map((u) => checkLayoutTransition(doc, u.id as string, u.property as string, u.value))
      .filter(Boolean);
    return [head, ...new Set(vocabularyNotes), ...notes, ...loops, ...transitionTips].join("\n");
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
    const off = ctx.offPage(typeof a.id === "string" ? a.id.trim() : undefined);
    if (off) return off;
    // Measured against the page: with no id this lists every root frame, and
    // the roots worth listing are the ones this run is allowed to touch.
    const doc = ctx.pageDoc;
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
