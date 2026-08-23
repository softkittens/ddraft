import type { IconNode, PenNode } from "../../model/types";
import { insertChild, setProperty } from "../../model/edit";
import { findNode } from "../../model/tree";
import { digestSubtree } from "../../digest/digest";
import { layoutResolvedDocument, flattenLayoutTree } from "../../layout/layout";
import { resolveInstances } from "../../model/instance";
import { searchLucideIcons, getLucideIconPath } from "../../model/icons";
import { generateDesignImage, ImageGenUnavailableError } from "../image_gen";
import {
  SEVERE_CROP,
  croppedFraction,
  nearestGeneratedAspect,
  servableHeights
} from "../../design/photography";
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
    const rawNode = findNode(doc.children, targetId);
    const nodeName = `${(rawNode as any)?.name ?? ""} ${targetId}`.toLowerCase();
    let aspectRatio: "landscape" | "portrait" | "square" = "landscape";
    let targetSize = "target";
    /*
     * How much of the picture this frame will crop away, said out loud.
     *
     * The providers return one of three shapes and the canvas paints them with
     * cover, so a frame that matches none of the three silently discards the
     * difference. A 390x1320 phone band keeps 39% of a 3:4 photograph — which
     * is why one logged run's hero came back as a vertical slice of a fountain
     * after the frame was resized for a composition that was later undone.
     */
    let cropNote = "";
    const noteCrop = (width: number, height: number, ratio: number) => {
      const chosen = nearestGeneratedAspect(ratio);
      const lost = croppedFraction(ratio, chosen.ratio);
      if (lost <= SEVERE_CROP) return;
      cropNote =
        `\nnote: ${Math.round(width)}x${Math.round(height)} is ${ratio.toFixed(2)}:1, and the closest shape ` +
        `available is ${chosen.label}, so cover fit crops ${Math.round(lost * 100)}% of the picture away. ` +
        `Sizes that hold a whole photograph at this width: ${servableHeights(width, ratio)}.`;
    };

    if (target && target.box.width > 0 && target.box.height > 0) {
      const ratio = target.box.width / target.box.height;
      aspectRatio = nearestGeneratedAspect(ratio).name;
      targetSize = `${Math.round(target.box.width)}x${Math.round(target.box.height)}`;
      noteCrop(target.box.width, target.box.height, ratio);
    } else {
      const w = typeof (rawNode as any)?.width === "number" ? (rawNode as any).width : 0;
      const h = typeof (rawNode as any)?.height === "number" ? (rawNode as any).height : 0;
      if (w > 0 && h > 0) {
        const ratio = w / h;
        aspectRatio = nearestGeneratedAspect(ratio).name;
        targetSize = `${Math.round(w)}x${Math.round(h)}`;
        noteCrop(w, h, ratio);
      } else if (/avatar|thumbnail|thumb|profile|icon|circle|user/i.test(nodeName)) {
        aspectRatio = "square";
        targetSize = "square";
      } else if (/portrait|story|card|vertical|stand/i.test(nodeName)) {
        aspectRatio = "portrait";
        targetSize = "portrait";
      } else {
        aspectRatio = "landscape";
        targetSize = "landscape";
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
      return `ok: generated image (${result.provider}) using ${aspectRatio} composition for the ${targetSize} target and set fill on ${instanceTarget.descendantId} inside instance ${instanceTarget.refId}. Only this instance changed.${cropNote}`;
    }
    doc = setProperty(doc, targetId, "fill", { type: "image", url: imgUrl });
    ctx.setDoc(doc);
    return `ok: generated image (${result.provider}) using ${aspectRatio} composition for the ${targetSize} target and set fill on ${targetId}${cropNote}\n${digestSubtree(doc, targetId)}`;
  }
};

export const mediaTools = [searchIconsTool, insertIconTool, generateImageTool];
