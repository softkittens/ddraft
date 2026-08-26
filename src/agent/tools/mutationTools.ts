import type { PenNode } from "../../model/types";
import { insertChild, moveNode, removeNode, replaceNode, setProperty, duplicateNode, getNextNodeId } from "../../model/edit";
import { childrenOf, findNode, maxNumericId } from "../../model/tree";
import { pageScopedDocument, setPageOf, IMPLICIT_PAGE_ID } from "../../model/pages";
import { digest, digestSubtree } from "../../digest/digest";
import { buildScreen, type ScreenSpec, type TabSpec } from "../../design/scaffold";
import { insertionNote } from "../../design/evaluator";
import {
  type DocumentToolDefinition,
  WHOLE_DOC_ALIASES,
  digestId,
  parentIdOf,
  chromeWriteError,
  scaffoldDeleteError,
  populatedScreenDeleteError,
  replacementScreenError,
  resolveIconGeometry,
  resolvePercentSizes
} from "./types";
import { normalizeNodeTree, describeNormalization, type NormalizeReport } from "./normalize";

export const createScreenTool: DocumentToolDefinition = {
  name: "create_screen",
  description:
    "Build a mobile or desktop screen frame. Desktop chrome follows the product: a site is topBar + main; a tool also gets rail and aside. Omit tabs except on multi-destination apps. Width is the device (390 or 1440). Height defaults to dynamic 'fit_content' with a viewport floor (844 mobile / 900 desktop) so stacked bands expand naturally without leaving empty space.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Screen name, e.g. 'Feed', 'Profile', 'Settings'"
      },
      kind: {
        type: "string",
        enum: ["mobile", "desktop"],
        description: "Screen form factor"
      },
      tabs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: {
              type: "string"
            },
            icon: {
              type: "string",
              description: "Lucide icon name, e.g. 'home', 'compass', 'user', 'bell', 'settings'"
            },
            active: {
              type: "boolean",
              description: "True for the currently active tab"
            }
          },
          required: ["label", "icon"]
        },
        description:
          "Bottom tab bar destinations. Mobile only, and only when the product is an app with multiple primary destinations. Omit for websites, landing pages, booking flows, and single-purpose screens."
      },
      height: {
        type: ["number", "string"],
        description:
          "Page height in px or 'fit_content'. Defaults to dynamic fit_content (with 844 / 900 viewport minimum floor) so stacked sections fit naturally without empty voids."
      }
    },
    required: ["name", "kind"]
  },
  execute: (ctx, a) => {
    let doc = ctx.doc;
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!name) return "error: name is required";
    if (a.kind !== "mobile" && a.kind !== "desktop") return "error: kind must be 'mobile' or 'desktop'";

    const replacement = replacementScreenError(ctx.pageDoc.children, a.kind, ctx.archetype, name);
    if (replacement) return replacement;

    let activeFound = false;
    const tabs: TabSpec[] = Array.isArray(a.tabs)
      ? (a.tabs as any[])
          .filter((t) => t && typeof t.label === "string" && typeof t.icon === "string")
          .map((t) => {
            const isActive = t.active === true && !activeFound;
            if (isActive) activeFound = true;
            return { label: t.label, icon: t.icon, active: isActive };
          })
      : [];
    if (tabs.length > 0 && !activeFound) tabs[0].active = true;

    const spec: ScreenSpec = {
      name,
      kind: a.kind,
      archetype: ctx.archetype,
      tabs: tabs.length > 0 ? tabs : undefined,
      height: typeof a.height === "number" || typeof a.height === "string" ? a.height : undefined
    };
    let counter = 0;
    const base = getNextNodeId(doc, "n").split("_")[1];
    const scaffold = buildScreen(spec, () => `n${Number(base) + counter++}`);
    resolveIconGeometry(scaffold.node);

    // Placed beside the screens on this page, not beside everything on the
    // canvas: a page whose screens sit in one band should keep them there
    // rather than trailing off past another page's work.
    const siblings = ctx.pageDoc.children;
    let maxX = 0;
    for (const root of siblings) {
      const isMob = (root as any).metadata?.screenKind === "mobile" || (typeof root.width === "number" && root.width <= 500);
      const rootW = typeof root.width === "number" ? root.width : isMob ? 390 : 1440;
      const right = (root.x ?? 0) + rootW;
      if (right > maxX) maxX = right;
    }
    (scaffold.node as any).x = siblings.length > 0 ? maxX + 80 : 0;
    (scaffold.node as any).y = siblings[0]?.y ?? 0;
    if (ctx.pageId && ctx.pageId !== IMPLICIT_PAGE_ID) {
      (scaffold.node as any).metadata = {
        ...((scaffold.node as any).metadata ?? {}),
        page: ctx.pageId
      };
    }

    doc = insertChild(doc, undefined, scaffold.node as PenNode);
    ctx.setDoc(doc);

    const slots = Object.entries(scaffold.slots)
      .map(([role, id]) => `  ${role}: ${id}`)
      .join("\n");
    const screenNote = insertionNote(doc, scaffold.node.id);
    return [
      `ok: built ${spec.kind} screen "${name}" (${scaffold.node.id}). Slots:`,
      slots,
      "",
      digestSubtree(doc, scaffold.node.id),
      ...(screenNote ? ["", screenNote] : [])
    ].join("\n");
  }
};

export const insertNodeTool: DocumentToolDefinition = {
  name: "insert_node",
  description:
    "Insert a node with all its children. Every node must include type; every container uses type: 'frame' (other types: 'text', 'icon', 'rectangle', 'ellipse', 'polygon', 'path', 'ref'). Omit parentId to insert as a top-level canvas frame.",
  parameters: {
    type: "object",
    properties: {
      parentId: {
        type: "string",
        description: "Target parent frame ID. Omit to insert as a top-level frame."
      },
      node: {
        type: "object",
        description: "Complete node definition with all children. Every node must include type (e.g. type: 'frame' for containers, 'text', 'icon')."
      },
      index: {
        type: "number",
        description: "Zero-based child index. Omit to append at the end."
      }
    },
    required: ["node"]
  },
  execute: (ctx, a) => {
    let doc = ctx.doc;
    if (!a.node || typeof a.node !== "object") {
      return "error: node is required. If this call was cut off, insert one section at a time rather than the whole page in one tree.";
    }
    const rawParentId = typeof a.parentId === "string" ? a.parentId.trim() : undefined;
    const isRootInsert = !rawParentId || WHOLE_DOC_ALIASES.has(rawParentId);
    const targetParent = isRootInsert ? undefined : rawParentId;

    const report: NormalizeReport = { renamed: [], unknown: [], defaulted: [] };
    const nodeToInsert = resolveIconGeometry(normalizeNodeTree({ ...(a.node as any) }, report, doc.variables));
    const normalizationNote = describeNormalization(report);

    if (isRootInsert) {
      if (nodeToInsert.x === undefined || nodeToInsert.x === 0) {
        let maxX = 0;
        for (const root of doc.children) {
          const rightEdge = (root.x ?? 0) + (typeof root.width === "number" ? root.width : 1200);
          if (rightEdge > maxX) maxX = rightEdge;
        }
        if (doc.children.length > 0 && maxX > 0) {
          nodeToInsert.x = maxX + 80;
          if (nodeToInsert.y === undefined) nodeToInsert.y = doc.children[0].y ?? 0;
        }
      }
      if (nodeToInsert.width === undefined) nodeToInsert.width = 1360;
      if (nodeToInsert.height === undefined) nodeToInsert.height = 920;
    }

    const offParent = ctx.offPage(targetParent);
    if (offParent) return offParent;
    const chrome = chromeWriteError(doc, targetParent);
    if (chrome) return chrome;

    const before = doc;
    doc = insertChild(doc, targetParent, nodeToInsert as PenNode, typeof a.index === "number" ? a.index : undefined);
    if (doc === before) return `error: could not insert into ${rawParentId || "canvas"}`;

    // Only after the subtree is in the tree: a percentage is a share of a
    // parent, and the parent has no resolved box until the child is under it.
    const percent = resolvePercentSizes(doc);
    doc = percent.doc;
    ctx.setDoc(doc);

    const body = targetParent ? digestSubtree(doc, targetParent) : digest(ctx.pageDoc);
    const note = insertionNote(doc, (nodeToInsert as PenNode).id);
    return [normalizationNote, ...percent.notes, body, note].filter(Boolean).join("\n");
  }
};

export const placeInstancesTool: DocumentToolDefinition = {
  name: "place_instances",
  description:
    "Place multiple instances of a reusable component, optionally overriding descendant properties (e.g. text content, fills) per instance.",
  parameters: {
    type: "object",
    properties: {
      componentId: {
        type: "string",
        description: "ID of the reusable component to instantiate"
      },
      parentId: {
        type: "string",
        description: "Target parent frame ID"
      },
      items: {
        type: "array",
        items: {
          type: "object",
          description: "Map of descendantId -> property overrides for this instance"
        },
        description: "One entry per instance to place"
      }
    },
    required: ["componentId", "parentId", "items"]
  },
  execute: (ctx, a) => {
    let doc = ctx.doc;
    const componentId = typeof a.componentId === "string" ? a.componentId.trim() : "";
    const parentId = typeof a.parentId === "string" ? a.parentId.trim() : "";
    const items = Array.isArray(a.items) ? a.items : null;
    if (!componentId || !parentId || !items) return "error: componentId, parentId and items are required";

    const component = findNode(doc.children, componentId);
    if (!component) return `error: component ${componentId} not found`;
    if (!findNode(doc.children, parentId)) return `error: parent ${parentId} not found`;
    // Only the destination is guarded. Reusable components live at the top of
    // the canvas and are meant to be instanced from anywhere, so a component
    // on another page is a shared asset, not a trespass.
    const offParent = ctx.offPage(parentId);
    if (offParent) return offParent;
    const chrome = chromeWriteError(doc, parentId);
    if (chrome) return chrome;
    if (items.length === 0) return "error: items is empty. Give one entry per instance.";

    const known = new Set<string>();
    (function collect(n: PenNode) {
      known.add(n.id);
      for (const c of childrenOf(n)) collect(c);
    })(component);

    if (component.reusable !== true) doc = setProperty(doc, componentId, "reusable", true);

    const unknownKeys: string[] = [];
    let counter = maxNumericId(doc.children);
    const placed: string[] = [];

    for (const raw of items) {
      const overrides = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const descendants: Record<string, any> = {};
      for (const [id, props] of Object.entries(overrides)) {
        if (!known.has(id)) {
          unknownKeys.push(id);
          continue;
        }
        descendants[id] = props;
      }
      counter += 1;
      const instanceId = `ref_${counter}`;
      const before = doc;
      doc = insertChild(doc, parentId, {
        type: "ref",
        id: instanceId,
        ref: componentId,
        ...(Object.keys(descendants).length > 0 ? { descendants } : {})
      } as PenNode);
      if (doc === before) return `error: could not insert into ${parentId}`;
      placed.push(instanceId);
    }

    ctx.setDoc(doc);

    const notes: string[] = [];
    if (component.reusable !== true) notes.push(`note: marked ${componentId} reusable.`);
    if (unknownKeys.length > 0) {
      const unique = [...new Set(unknownKeys)];
      notes.push(
        `warning: ignored ${unknownKeys.length} override${unknownKeys.length === 1 ? "" : "s"} naming a node that is not in ${componentId} (${unique.slice(0, 5).join(", ")}${unique.length > 5 ? ", ..." : ""}). Read the component with read_digest for its ids.`
      );
    }
    const head = `ok: placed ${placed.length} instance${placed.length === 1 ? "" : "s"} of ${componentId} in ${parentId}.`;
    return [head, ...notes, digestSubtree(doc, parentId)].join("\n");
  }
};

export const duplicateNodeTool: DocumentToolDefinition = {
  name: "duplicate_node",
  description: "Duplicate a node and its entire subtree, assigning new IDs. Returns the new node ID.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Node ID to duplicate"
      },
      name: {
        type: "string",
        description: "Optional new name for the duplicate"
      }
    },
    required: ["id"]
  },
  execute: (ctx, a) => {
    let doc = ctx.doc;
    if (typeof a.id !== "string" || !a.id.trim()) return "error: id is required";
    const targetId = digestId(doc, a.id);
    if (!targetId || !findNode(doc.children, targetId)) return `error: node ${a.id} not found`;
    const off = ctx.offPage(targetId);
    if (off) return off;

    const res = duplicateNode(doc, targetId);
    if (!res) return `error: could not duplicate ${a.id}`;

    doc = res.doc;
    if (typeof a.name === "string" && a.name.trim()) {
      doc = setProperty(doc, res.newId, "name", a.name.trim());
    }
    ctx.setDoc(doc);
    return `ok: duplicated ${targetId} as ${res.newId}\n${digestSubtree(doc, res.newId)}`;
  }
};

export const deleteNodeTool: DocumentToolDefinition = {
  name: "delete_node",
  description: "Delete a node and all its children from the document. Pass confirm: true when intentionally deleting a populated root screen.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Node ID to delete"
      },
      confirm: {
        type: "boolean",
        description: "Set to true when intentionally deleting a top-level screen that already contains authored content."
      }
    },
    required: ["id"]
  },
  execute: (ctx, a) => {
    let doc = ctx.doc;
    if (typeof a.id !== "string") return "error: id is required";
    const targetId = a.id.trim();
    if (!findNode(doc.children, targetId)) return `error: node ${targetId} not found`;
    const off = ctx.offPage(targetId);
    if (off) return off;
    const slot = scaffoldDeleteError(doc, targetId);
    if (slot) return slot;

    const pageRoots = ctx.pageDoc.children;
    if (pageRoots.length === 1 && targetId === pageRoots[0].id && !a.confirm) {
      return `error: cannot delete "${targetId}" because it is the only root screen on the canvas. To confirm deleting it, pass { confirm: true }, or edit its child nodes instead.`;
    }
    const populated = populatedScreenDeleteError(pageRoots, targetId, a.confirm === true);
    if (populated) return populated;

    const parentId = parentIdOf(doc, targetId);
    doc = removeNode(doc, targetId);
    ctx.setDoc(doc);
    return parentId ? digestSubtree(doc, parentId) : digest(ctx.pageDoc);
  }
};

export const moveNodeTool: DocumentToolDefinition = {
  name: "move_node",
  description:
    "Move a node to a new parent and/or new index among its siblings. Omit newParentId or pass 'canvas'/'root' to un-nest a node and place it directly on the top-level canvas.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Node ID to move"
      },
      newParentId: {
        type: "string",
        description: "Target parent frame ID, or 'canvas'/'root' to move to the top-level canvas."
      },
      index: {
        type: "number",
        description: "Zero-based index in the new parent's children. Omit to append at the end."
      }
    },
    required: ["id"]
  },
  execute: (ctx, a) => {
    let doc = ctx.doc;
    if (typeof a.id !== "string") return "error: id is required";
    const targetId = a.id.trim();
    if (!findNode(doc.children, targetId)) return `error: could not find node ${targetId}`;
    const off = ctx.offPage(targetId);
    if (off) return off;
    const slot = scaffoldDeleteError(doc, targetId);
    if (slot) return slot;

    const rawParentId = typeof a.newParentId === "string" ? a.newParentId.trim() : undefined;
    const offParent = ctx.offPage(rawParentId);
    if (offParent) return offParent;
    const isRootMove = !rawParentId || rawParentId === "canvas" || rawParentId === "root" || rawParentId === "document";
    if (!isRootMove) {
      const chrome = chromeWriteError(doc, rawParentId);
      if (chrome) return chrome;
    }
    const oldParent = parentIdOf(doc, targetId);

    const before = digest(doc);
    doc = moveNode(doc, targetId, isRootMove ? undefined : rawParentId, typeof a.index === "number" ? a.index : undefined);
    if (digest(doc) === before) return `error: could not move ${targetId}`;
    // A node moved out to the canvas becomes a screen, and a screen with no
    // label belongs to no page. It joins the page the run is working on.
    if (isRootMove && ctx.pageId) doc = setPageOf(doc, targetId, ctx.pageId);
    ctx.setDoc(doc);

    const parts = [isRootMove ? digest(pageScopedDocument(doc, ctx.pageId)) : digestSubtree(doc, rawParentId!)];
    if (oldParent && oldParent !== rawParentId && !isRootMove) parts.unshift(digestSubtree(doc, oldParent));
    const loop = ctx.recordWrite(targetId, "parent", rawParentId ?? "canvas");
    return [parts.join("\n---\n"), loop].filter(Boolean).join("\n");
  }
};

export const replaceNodeTool: DocumentToolDefinition = {
  name: "replace_node",
  description:
    "Atomically replace a node and all its children in-place in a single call. Every node must include type; every container uses type: 'frame' (other types: 'text', 'icon', 'rectangle', 'ellipse', 'polygon', 'path', 'ref').",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Node ID of the existing element to replace"
      },
      node: {
        type: "object",
        description: "Complete new node definition with all its children. Every node must include type (e.g. type: 'frame' for containers, 'text', 'icon')."
      }
    },
    required: ["id", "node"]
  },
  execute: (ctx, a) => {
    let doc = ctx.doc;
    if (typeof a.id !== "string" || !a.id.trim()) return "error: id is required";
    if (!a.node || typeof a.node !== "object") return "error: node is required";

    const targetId = a.id.trim();
    const existing = findNode(doc.children, targetId);
    if (!existing) return `error: node "${targetId}" not found`;

    const off = ctx.offPage(targetId);
    if (off) return off;
    const slot = scaffoldDeleteError(doc, targetId);
    if (slot) return slot;

    const report: NormalizeReport = { renamed: [], unknown: [], defaulted: [] };
    const nodeToInsert = resolveIconGeometry(normalizeNodeTree({ ...(a.node as any) }, report, doc.variables));
    if (!(nodeToInsert as any).id) (nodeToInsert as any).id = targetId;
    const normalizationNote = describeNormalization(report);

    const before = doc;
    doc = replaceNode(doc, targetId, nodeToInsert as PenNode);
    if (doc === before) return `error: could not replace "${targetId}"`;

    const percent = resolvePercentSizes(doc);
    doc = percent.doc;
    ctx.setDoc(doc);

    const parentId = parentIdOf(doc, (nodeToInsert as PenNode).id);
    const body = parentId ? digestSubtree(doc, parentId) : digestSubtree(doc, (nodeToInsert as PenNode).id);
    const note = insertionNote(doc, (nodeToInsert as PenNode).id);
    const loop = ctx.recordWrite(targetId, "subtree", (nodeToInsert as PenNode).id);
    return [
      `ok: replaced "${targetId}" with "${(nodeToInsert as PenNode).id}" in-place.`,
      normalizationNote,
      ...percent.notes,
      body,
      note,
      loop
    ]
      .filter(Boolean)
      .join("\n");
  }
};

export const revertNodeTool: DocumentToolDefinition = {
  name: "revert_node",
  description:
    "Atomically restore a node and its entire subtree to its state at the beginning of this pass, or delete it if it was created in this pass.",
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Node ID to revert"
      }
    },
    required: ["id"]
  },
  execute: (ctx, a) => {
    if (typeof a.id !== "string" || !a.id.trim()) {
      return "error: id is required";
    }
    const targetId = a.id.trim();
    const off = ctx.offPage(targetId);
    if (off) return off;
    const initialNode = findNode(ctx.initialDoc.children, targetId);

    if (initialNode) {
      let nextDoc: typeof ctx.doc;
      if (findNode(ctx.doc.children, targetId)) {
        nextDoc = replaceNode(ctx.doc, targetId, initialNode);
      } else {
        const initialParentId = parentIdOf(ctx.initialDoc, targetId);
        const initialParent = initialParentId
          ? findNode(ctx.initialDoc.children, initialParentId)
          : undefined;
        const initialSiblings = initialParent ? childrenOf(initialParent) : ctx.initialDoc.children;
        const initialIndex = initialSiblings.findIndex((node) => node.id === targetId);
        if (initialParentId && !findNode(ctx.doc.children, initialParentId)) {
          return `error: cannot restore "${targetId}" because its initial parent "${initialParentId}" is missing`;
        }
        nextDoc = insertChild(ctx.doc, initialParentId, initialNode, initialIndex);
      }
      if (!findNode(nextDoc.children, targetId)) {
        return `error: could not restore "${targetId}" to its initial state`;
      }
      ctx.setDoc(nextDoc);
      return `ok: reverted "${targetId}" and its entire subtree to its initial state before this pass.\n${digestSubtree(nextDoc, targetId)}`;
    }

    const current = findNode(ctx.doc.children, targetId);
    if (!current) {
      return `error: node "${targetId}" not found in current document or initial snapshot`;
    }

    const nextDoc = removeNode(ctx.doc, targetId);
    ctx.setDoc(nextDoc);
    return `ok: node "${targetId}" was created during this pass and has been removed.`;
  }
};

export const mutationTools = [
  createScreenTool,
  insertNodeTool,
  replaceNodeTool,
  placeInstancesTool,
  duplicateNodeTool,
  deleteNodeTool,
  moveNodeTool,
  revertNodeTool
];
