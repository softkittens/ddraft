import type { IconNode, PenNode } from "../../model/types";
import { insertChild, setProperty } from "../../model/edit";
import { findNode } from "../../model/tree";
import { digestSubtree } from "../../digest/digest";
import { layoutResolvedDocument, flattenLayoutTree } from "../../layout/layout";
import { resolveInstances } from "../../model/instance";
import { searchLucideIcons, getLucideIconPath } from "../../model/icons";
import { generateDesignImage, ImageGenUnavailableError } from "../image_gen";
import {
  type DocumentToolDefinition,
  digestId,
  splitInstanceId,
  setInstanceProperty
} from "./types";

export const searchIconsTool: DocumentToolDefinition = {
  name: "search_icons",
  description: "Search for available Lucide icons by keyword. Returns matching icon names.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search keyword, e.g. 'arrow', 'user', 'settings', 'cart', 'heart'"
      }
    },
    required: ["query"]
  },
  execute: (_ctx, a) => {
    const query = typeof a.query === "string" ? a.query : "";
    const matches = searchLucideIcons(query);
    if (matches.length === 0) {
      return `No Lucide icons matching "${query}". Try related keywords like 'heart', 'star', 'user', 'arrow', 'check', 'x', 'bell', 'message', 'sparkles', 'flame', 'filter', 'camera', 'compass', 'trash'.`;
    }
    return `Found ${matches.length} Lucide vector icons for "${query}":\n${matches.map((m) => `• ${m}`).join("\n")}`;
  }
};

export const insertIconTool: DocumentToolDefinition = {
  name: "insert_icon",
  description: "Insert a Lucide icon into a parent frame. Resolves icon geometry automatically.",
  parameters: {
    type: "object",
    properties: {
      icon: {
        type: "string",
        description: "Lucide icon name, e.g. 'search', 'chevron-right', 'star', 'shopping-cart'"
      },
      parentId: {
        type: "string",
        description: "Target parent frame ID"
      },
      size: {
        type: "number",
        description: "Icon width and height in pixels (default 24)"
      },
      stroke: {
        type: "string",
        description: "Stroke color (default '$text')"
      },
      strokeWidth: {
        type: "number",
        description: "Stroke width (default 2)"
      },
      fill: {
        type: "string",
        description: "Optional fill color"
      },
      name: {
        type: "string",
        description: "Optional descriptive layer name"
      },
      index: {
        type: "number",
        description: "Zero-based child index. Omit to append at the end."
      }
    },
    required: ["icon", "parentId"]
  },
  execute: (ctx, a) => {
    let doc = ctx.doc;
    if (typeof a.icon !== "string" || typeof a.parentId !== "string") {
      return "error: icon and parentId are required";
    }
    const geom = getLucideIconPath(a.icon);
    if (!geom) {
      const suggestions = searchLucideIcons(a.icon, 5);
      return `error: unknown Lucide icon "${a.icon}". Did you mean: ${suggestions.join(", ")}? Use search_icons to find valid icon names.`;
    }

    const size = typeof a.size === "number" ? a.size : 24;
    const iconNode: IconNode = {
      id: `icon_${Math.random().toString(36).slice(2, 8)}`,
      type: "icon",
      name: typeof a.name === "string" ? a.name : `${a.icon} icon`,
      icon: a.icon,
      geometry: geom,
      width: size,
      height: size,
      stroke: typeof a.stroke === "string" ? a.stroke : "$text",
      strokeWidth: typeof a.strokeWidth === "number" ? a.strokeWidth : 2,
      fill: typeof a.fill === "string" ? a.fill : undefined
    };

    const targetParent = digestId(doc, a.parentId);
    doc = insertChild(doc, targetParent, iconNode as PenNode, typeof a.index === "number" ? a.index : undefined);
    ctx.setDoc(doc);
    return `ok: inserted Lucide icon "${a.icon}" (${size}x${size}px) into ${a.parentId}\n${digestSubtree(doc, targetParent)}`;
  }
};

export const generateImageTool: DocumentToolDefinition = {
  name: "generate_image",
  description:
    "Generate an image via AI for an existing node (e.g. hero photo, avatar, product image). Sets the fill property of the target node.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Detailed description of the image to generate"
      },
      nodeId: {
        type: "string",
        description: "ID of the existing node to receive the image fill"
      }
    },
    required: ["prompt", "nodeId"]
  },
  execute: async (ctx, a) => {
    let doc = ctx.doc;
    const prompt = typeof a.prompt === "string" ? a.prompt.trim() : "";
    if (!prompt) return "error: prompt is required for image generation";

    const targetId = digestId(doc, a.nodeId);
    if (!targetId) return "error: existing nodeId is required for image generation";

    const instanceTarget = findNode(doc.children, targetId) ? undefined : splitInstanceId(doc, targetId);
    if (!findNode(doc.children, targetId) && !instanceTarget) {
      return `error: node ${targetId} not found. Pass the id of an existing node to fill.`;
    }

    const target = flattenLayoutTree(layoutResolvedDocument(resolveInstances(doc))).get(targetId);
    let aspectRatio: "landscape" | "portrait" | "square" = "landscape";
    let targetSize = "target";

    if (target && target.box.width > 0 && target.box.height > 0) {
      const ratio = target.box.width / target.box.height;
      aspectRatio = ratio > 1.15 ? "landscape" : ratio < 0.87 ? "portrait" : "square";
      targetSize = `${Math.round(target.box.width)}x${Math.round(target.box.height)}`;
    } else {
      const rawNode = findNode(doc.children, targetId);
      const w = typeof (rawNode as any)?.width === "number" ? (rawNode as any).width : 0;
      const h = typeof (rawNode as any)?.height === "number" ? (rawNode as any).height : 0;
      if (w > 0 && h > 0) {
        const ratio = w / h;
        aspectRatio = ratio > 1.15 ? "landscape" : ratio < 0.87 ? "portrait" : "square";
        targetSize = `${Math.round(w)}x${Math.round(h)}`;
      }
    }

    let result;
    try {
      result = await generateDesignImage(prompt, {
        aspectRatio,
        providerId: ctx.image.providerId,
        apiKey: ctx.image.apiKey,
        fetch: ctx.image.fetch
      });
    } catch (err) {
      if (err instanceof ImageGenUnavailableError) {
        return `error: ${err.message} Do not retry image generation in this run or replace required photography with a placeholder; report that the imagery could not be completed.`;
      }
      throw err;
    }
    const imgUrl = result.url;

    if (instanceTarget) {
      doc = setInstanceProperty(doc, instanceTarget, "fill", { type: "image", url: imgUrl });
      ctx.setDoc(doc);
      return `ok: generated image (${result.provider}) using ${aspectRatio} composition for the ${targetSize} target and set fill on ${instanceTarget.descendantId} inside instance ${instanceTarget.refId}. Only this instance changed.`;
    }
    doc = setProperty(doc, targetId, "fill", { type: "image", url: imgUrl });
    ctx.setDoc(doc);
    return `ok: generated image (${result.provider}) using ${aspectRatio} composition for the ${targetSize} target and set fill on ${targetId}\n${digestSubtree(doc, targetId)}`;
  }
};

export const mediaTools = [searchIconsTool, insertIconTool, generateImageTool];
