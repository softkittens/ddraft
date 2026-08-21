import type { Document, PenNode, IconNode } from "../model/types";
import { insertChild, moveNode, removeNode, setProperty, duplicateNode, getNextNodeId } from "../model/edit";
import { childrenOf, findNode, maxNumericId } from "../model/tree";
import { resolveInstances } from "../model/instance";
import { digest, digestSubtree } from "../digest/digest";
import { layoutResolvedDocument, flattenLayoutTree } from "../layout/layout";
import type { LayoutNode } from "../layout/types";
import { auditDocument, formatAudit } from "../design/evaluator";
import { resolveStyle, styleGuidelines, StyleChoiceError, STYLE_METADATA_KEY } from "../design/styleSystem";
import { searchLucideIcons, getLucideIconPath } from "../model/icons";
import { buildScreen, type ScreenSpec, type TabSpec } from "../design/scaffold";
import { generateDesignImage, ImageGenUnavailableError } from "./image_gen";
import type { Tool } from "./provider";

const ALLOWED_PROPERTIES = new Set([
  "width", "height", "x", "y", "gap", "padding", "fill", "stroke", "strokeWidth",
  "name", "content", "fontSize", "fontWeight", "fontFamily", "letterSpacing",
  "lineHeight", "textAlign", "textGrowth", "layout", "justifyContent", "alignItems",
  "opacity", "rotation", "cornerRadius", "clip", "enabled", "layoutPosition",
  "effect", "icon", "strokeWidth", "textGrowth", "reusable", "ref"
]);

export const TOOL_DEFS: Tool[] = [
  {
    name: "set_style",
    description:
      "Choose the document's visual system: palette, roundness, elevation and three typefaces. " +
      "Writes the colour and font tokens onto the document and returns the usage rules for the " +
      "chosen style. Call this before building anything on an unstyled document. Every argument " +
      "must name an option from the catalog in the system prompt.",
    parameters: {
      type: "object",
      properties: {
        palette: { type: "string", description: "Palette name, e.g. 'Carbon Frost'" },
        roundness: { type: "string", description: "Roundness scale name, e.g. 'Basic'" },
        elevation: { type: "string", description: "Elevation preset name, e.g. 'Soft Lift'" },
        headings: { type: "string", description: "Typeface for titles and section headings" },
        body: { type: "string", description: "Typeface for paragraphs and list titles" },
        captions: { type: "string", description: "Typeface for labels, metadata and badges" }
      },
      required: ["palette", "roundness", "elevation", "headings", "body", "captions"]
    }
  },
  {
    name: "read_digest",
    description:
      "Return a structural digest. Omit id for the whole document. Pass a node id for a subtree.",
    parameters: { type: "object", properties: { id: { type: "string" } } }
  },
  {
    name: "set_variable",
    description:
      "Update a theme token/variable (e.g. name: 'bg', value: '#FFFFFF'). Instantly updates all elements referencing $name across the document.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Variable name without $ (e.g. 'bg', 'surface', 'surface-raised', 'line', 'text', 'muted')" },
        value: { type: "string", description: "Hex color code or value (e.g. '#FFFFFF', '#0F172A')" }
      },
      required: ["name", "value"]
    }
  },
  {
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
              id: { type: "string" },
              property: { type: "string" },
              value: {}
            },
            required: ["id", "property", "value"]
          }
        }
      },
      required: ["updates"]
    }
  },
  {
    name: "set_property",
    description: "Set one property on one node. Returns the subtree digest.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        property: { type: "string" },
        value: {}
      },
      required: ["id", "property"]
    }
  },
  {
    name: "create_screen",
    description:
      "Create a new screen as a top-level frame, with its chrome already built and measured: a mobile screen gets a status bar, one content wrapper that owns the horizontal padding, and an optional capsule tab bar; a desktop screen gets a top bar, a left rail, a dominant main region and a right rail. Returns the id of each slot. Always start a screen with this rather than assembling the chrome by hand. Put the screen's own content inside the returned content or main id.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "What the screen is, e.g. 'Discover' or 'Order Detail'" },
        kind: { type: "string", enum: ["mobile", "desktop"] },
        tabs: {
          type: "array",
          description: "Mobile only. 3-5 destinations, exactly one marked active. Omit for a screen with no tab bar.",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              icon: { type: "string", description: "Lucide icon name" },
              active: { type: "boolean" }
            },
            required: ["label", "icon"]
          }
        }
      },
      required: ["name", "kind"]
    }
  },
  {
    name: "insert_node",
    description:
      "Insert a node. To insert as a new top-level root frame on the canvas, pass parentId: 'canvas' (or omit parentId). To insert inside an existing frame/group, pass its node id.",
    parameters: {
      type: "object",
      properties: {
        parentId: {
          type: "string",
          description: "Parent frame/group ID, or 'canvas' / omit for top-level canvas frame"
        },
        index: { type: "number" },
        node: {
          type: "object",
          description: "Node object (e.g. { type: 'frame', name: 'Layout B', width: 1360, height: 920, children: [...] })"
        }
      },
      required: ["node"]
    }
  },
  {
    name: "place_instances",
    description:
      "Place several instances of one component in a parent, each with its own text. Build the repeated structure once as a normal node, then call this with the values that differ. Cheaper and more consistent than writing the same subtree again: an edit to the component reaches every instance. Use it for list rows, cards, chips, and any structure that repeats.",
    parameters: {
      type: "object",
      properties: {
        componentId: { type: "string", description: "Id of the node to instance. It is marked reusable for you." },
        parentId: { type: "string", description: "Frame the instances go into." },
        items: {
          type: "array",
          description:
            "One entry per instance. Each is a map of descendant node id to the properties that differ, e.g. { \"row_title\": { \"content\": \"Bella\" }, \"row_meta\": { \"content\": \"7 · Mare\" } }. An empty object places an unmodified copy.",
          items: { type: "object" }
        }
      },
      required: ["componentId", "parentId", "items"]
    }
  },
  {
    name: "duplicate_node",
    description:
      "Duplicate an existing frame, component, or node subtree. When duplicating a root frame, it places the exact clone side-by-side on the canvas with fresh unique IDs for all children. Returns the new node's digest. Use this when asked to make a variation, alternate theme, or new version of an existing screen so no elements are lost!",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID of the node or root frame to duplicate" },
        name: { type: "string", description: "Optional new name for the duplicated node (e.g. 'Factory Control Panel — Light')" }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_node",
    description: "Remove a node. Returns the parent digest.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"]
    }
  },
  {
    name: "move_node",
    description: "Move a node to a new parent. Returns both parent digests.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        newParentId: { type: "string" },
        index: { type: "number" }
      },
      required: ["id", "newParentId"]
    }
  },
  {
    name: "measure",
    description:
      "Return the resolved geometry of a subtree after layout: the computed box of every node, " +
      "in its parent's coordinate space. Use this to find out what 'fill_container' and " +
      "'fit_content' actually resolved to, and whether a region is the size you intended. " +
      "The digest shows what you declared; measure shows what the engine computed.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Node or frame ID to measure (omit for every top-level frame)" }
      }
    }
  },
  {
    name: "review_design",
    description:
      "Measure the design and report what is wrong with it: clipped text, colliding nodes, " +
      "text below the readable floor, insufficient contrast, touch targets that are too small, " +
      "empty containers, hard-coded colours, and undisciplined type/spacing/radius scales. " +
      "Passing an id scopes the report to that node and everything inside it. " +
      "Reports findings only — there is no score to optimise.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Frame ID to audit, including its descendants (omit for the whole document)" }
      }
    }
  },
  {
    name: "search_icons",
    description:
      "Search available Lucide vector icons by keyword (e.g. 'heart', 'star', 'user', 'message', 'flame', 'arrow', 'filter', 'check', 'x', 'settings', 'bell', 'share', 'camera', 'sparkles', 'compass', etc.). Returns matching icon names you can use with insert_icon or type: 'icon'.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword (e.g. 'heart', 'navigation', 'media', 'social')" }
      },
      required: ["query"]
    }
  },
  {
    name: "insert_icon",
    description:
      "Insert a crisp Lucide vector icon into a container frame. Renders crisp vector SVG path geometry at any scale.",
    parameters: {
      type: "object",
      properties: {
        icon: { type: "string", description: "Lucide icon name (e.g. 'heart', 'star', 'flame', 'sparkles', 'x', 'check', 'message-circle', 'search', 'user')" },
        parentId: { type: "string", description: "Target container frame/group ID" },
        name: { type: "string", description: "Optional layer name (e.g. 'Like Icon')" },
        size: { type: "number", description: "Icon box size in pixels (default: 24)" },
        stroke: { type: "string", description: "Icon stroke color or token (e.g. '#FFFFFF', '$cyan', '$red', '$muted')" },
        strokeWidth: { type: "number", description: "Icon stroke width (default: 2)" },
        fill: { type: "string", description: "Optional fill color or token (default: 'none')" },
        index: { type: "number", description: "Optional index in parent container" }
      },
      required: ["icon", "parentId"]
    }
  },
  {
    name: "generate_image",
    description:
      "Generate a realistic photorealistic image or illustration in the background using Qwen-Image-3.0-Pro (DashScope). Can set as the image fill of an existing frame/card (via nodeId) or insert a new image container (via parentId).",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed description of the image to generate (e.g. 'A majestic Arabian stallion with glossy dark coat galloping in a sunset golden meadow')" },
        nodeId: { type: "string", description: "Optional existing node ID to apply this image fill to" },
        parentId: { type: "string", description: "Optional parent container ID to insert a new image frame into" },
        name: { type: "string", description: "Optional layer name (e.g. 'Hero Photo')" },
        aspectRatio: { type: "string", enum: ["square", "portrait", "landscape"], description: "Image aspect ratio (default: 'portrait')" }
      },
      required: ["prompt"]
    }
  }
];

/**
 * Properties every node type understands.
 */
const COMMON_KEYS = new Set([
  "id", "type", "name", "x", "y", "width", "height", "fill", "fills", "stroke", "strokes",
  "strokeWidth", "cornerRadius", "rotation", "opacity", "layoutPosition", "clip", "reusable",
  "enabled", "effect", "metadata", "children"
]);

const TYPE_KEYS: Record<string, Set<string>> = {
  frame: new Set(["layout", "gap", "padding", "justifyContent", "alignItems"]),
  group: new Set([]),
  text: new Set([
    "content", "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight",
    "textAlign", "textGrowth"
  ]),
  icon: new Set(["icon", "library", "geometry"]),
  rectangle: new Set([]),
  ellipse: new Set(["innerRadius", "startAngle", "sweepAngle"]),
  polygon: new Set(["points"]),
  path: new Set(["geometry", "viewBox"]),
  ref: new Set(["ref", "descendants"])
};

/**
 * Names a model reaches for that the schema does not use. Silently ignoring
 * them cost a whole run once: every string was written as `text` instead of
 * `content`, so 44 text nodes rendered blank and nothing reported it.
 */
const ALIASES: Record<string, string> = {
  text: "content",
  label: "content",
  value: "content",
  title: "content",
  color: "fill",
  background: "fill",
  backgroundColor: "fill",
  radius: "cornerRadius",
  borderRadius: "cornerRadius",
  iconName: "icon",
  font: "fontFamily",
  weight: "fontWeight",
  size: "fontSize",
  align: "textAlign",
  direction: "layout",
  justify: "justifyContent",
  align_items: "alignItems"
};

export interface NormalizeReport {
  renamed: string[];
  unknown: string[];
  defaulted: string[];
}

/**
 * Prose long enough that one line will not hold it. Below this a string is a
 * label, a value or a heading, and wrapping it would be wrong.
 */
const PROSE_LENGTH = 40;

/**
 * Fill in what the engine can work out for itself.
 *
 * Every rule here used to be a sentence in the system prompt asking the model
 * to remember something on every node of every run. A sentence is a request a
 * stochastic model answers most of the time; a default is a fact. Moving one
 * down here deletes a prompt rule, an audit rule and a class of run.
 */
/**
 * Directly, not anywhere below. The frame that sizes to a paragraph is the one
 * holding it; a fixed height further up is a deliberate frame, and taking it
 * away resized a whole screen because one caption inside it wrapped.
 */
function holdsProse(node: any): boolean {
  if (!Array.isArray(node?.children)) return false;
  return node.children.some(
    (c: any) => c?.type === "text" && typeof c.content === "string" && c.content.length > PROSE_LENGTH
  );
}

function applyDefaults(node: any, report: NormalizeReport): void {
  // A fixed height on a frame holding prose cannot hold text that wraps. The
  // number in fit_content(N) is a fallback for when content cannot be measured,
  // not a floor, so converting to it would shrink the frame rather than let it
  // grow. Dropping the height is what lets the box follow its text.
  if (node.type === "frame" && typeof node.height === "number" && holdsProse(node)) {
    delete node.height;
    report.defaulted.push("height: fit_content on a frame holding prose");
  }

  if (node.type !== "text") return;

  // Text is measured as a single line unless a wrapping mode is set, and such
  // text never overflows its own box, so nothing downstream can see the damage.
  // The sentence is simply cut. Only a span with a known width can wrap.
  const spans = node.width === "fill_container" || typeof node.width === "number";
  const content = typeof node.content === "string" ? node.content : "";
  if (spans && content.length > PROSE_LENGTH && node.textGrowth === undefined) {
    node.textGrowth = "fixed-width";
    report.defaulted.push("textGrowth: 'fixed-width' on wrapping text");
  }
}

/**
 * Rewrite the aliases a node used and collect the keys that mean nothing to the
 * engine, so the caller can be told rather than left with a blank screen.
 */
export function normalizeNodeTree(node: any, report: NormalizeReport): any {
  if (!node || typeof node !== "object") return node;
  const type = typeof node.type === "string" ? node.type : "frame";
  const allowed = TYPE_KEYS[type];
  const out: any = {};

  for (const [key, value] of Object.entries(node)) {
    let target = key;
    const known = COMMON_KEYS.has(key) || allowed?.has(key);
    if (!known) {
      const alias = ALIASES[key];
      if (alias && (COMMON_KEYS.has(alias) || allowed?.has(alias))) {
        target = alias;
        report.renamed.push(`${type}.${key} -> ${alias}`);
      } else {
        report.unknown.push(`${type}.${key}`);
        continue;
      }
    }
    out[target] = value;
  }

  if (Array.isArray(out.children)) {
    out.children = out.children.map((c: any) => normalizeNodeTree(c, report));
  }
  applyDefaults(out, report);
  return out;
}

function describeNormalization(report: NormalizeReport): string {
  const parts: string[] = [];
  if (report.renamed.length > 0) {
    const unique = [...new Set(report.renamed)];
    parts.push(`note: renamed ${report.renamed.length} propert${report.renamed.length === 1 ? "y" : "ies"} to the schema name (${unique.slice(0, 4).join(", ")}${unique.length > 4 ? ", ..." : ""}).`);
  }
  if (report.defaulted.length > 0) {
    const unique = [...new Set(report.defaulted)];
    parts.push(`note: filled in ${report.defaulted.length} value${report.defaulted.length === 1 ? "" : "s"} the engine can derive (${unique.join(", ")}).`);
  }
  if (report.unknown.length > 0) {
    const unique = [...new Set(report.unknown)];
    parts.push(`warning: dropped ${report.unknown.length} propert${report.unknown.length === 1 ? "y" : "ies"} the engine does not have (${unique.slice(0, 6).join(", ")}${unique.length > 6 ? ", ..." : ""}). Check the node type's property list before you set them again.`);
  }
  return parts.join("\n");
}

const WHOLE_DOC_ALIASES = new Set(["root", "document", "canvas"]);

function digestId(doc: Document, id: unknown): string | undefined {
  if (typeof id !== "string") return undefined;
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  if (findNode(doc.children, trimmed)) return trimmed;
  if (WHOLE_DOC_ALIASES.has(trimmed)) return undefined;
  return trimmed;
}

function parentIdOf(doc: Document, id: string): string | undefined {
  function walk(nodes: PenNode[], parent?: PenNode): string | undefined {
    for (const n of nodes) {
      if (n.id === id) return parent?.id;
      const found = walk(childrenOf(n), n);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return walk(doc.children);
}

export function createDocumentTools(initial: Document) {
  let doc = initial;

  async function execute(name: string, args: unknown): Promise<string> {
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    switch (name) {
      case "read_digest":
        return digestSubtree(doc, digestId(doc, a.id));

      case "set_style": {
        let style;
        try {
          style = resolveStyle(a as Record<string, unknown>);
        } catch (err) {
          if (err instanceof StyleChoiceError) return `error: ${err.message}`;
          throw err;
        }

        const newDoc: Document = structuredClone(doc);
        newDoc.variables = { ...(newDoc.variables ?? {}), ...style.variables };
        newDoc.metadata = { ...(newDoc.metadata ?? {}), [STYLE_METADATA_KEY]: style.choice };
        doc = newDoc;

        return [
          `ok: style set. ${Object.keys(style.variables).length} tokens written to the document.`,
          "Use these tokens everywhere. Follow these rules for the rest of the design:",
          "",
          styleGuidelines(style)
        ].join("\n");
      }

      case "set_variable": {
        const rawName = typeof a.name === "string" ? a.name.replace(/^\$/, "").trim() : "";
        if (!rawName) return "error: variable name is required";
        if (a.value === undefined) return "error: variable value is required";

        const newDoc: Document = structuredClone(doc);
        if (!newDoc.variables) newDoc.variables = {};

        const existing = newDoc.variables[rawName];
        if (typeof existing === "object" && existing !== null && "type" in existing) {
          newDoc.variables[rawName] = { ...existing, value: a.value };
        } else {
          newDoc.variables[rawName] = typeof a.value === "string" && a.value.startsWith("#")
            ? { type: "color", value: a.value }
            : a.value;
        }

        doc = newDoc;
        return `ok: variable $${rawName} = ${JSON.stringify(a.value)}`;
      }

      case "batch_set_properties": {
        const updates = Array.isArray(a.updates) ? a.updates : [];
        if (updates.length === 0) return "error: updates array is required";

        let newDoc = doc;
        const modifiedIds: string[] = [];

        for (const u of updates) {
          if (!u || typeof u.id !== "string" || typeof u.property !== "string") continue;
          if (!ALLOWED_PROPERTIES.has(u.property)) continue;
          if (!findNode(newDoc.children, u.id)) continue;
          newDoc = setProperty(newDoc, u.id, u.property, u.value);
          modifiedIds.push(`${u.id}.${u.property}`);
        }

        doc = newDoc;
        return `ok: updated ${modifiedIds.length} properties (${modifiedIds.slice(0, 6).join(", ")}${modifiedIds.length > 6 ? "..." : ""})`;
      }

      case "set_property": {
        if (typeof a.id !== "string" || typeof a.property !== "string") return "error: id and property are required";
        if (!ALLOWED_PROPERTIES.has(a.property)) return `error: invalid property "${a.property}"`;
        if (!findNode(doc.children, a.id)) return `error: node ${a.id} not found`;
        doc = setProperty(doc, a.id, a.property, a.value);
        return digestSubtree(doc, a.id);
      }

      case "create_screen": {
        const name = typeof a.name === "string" ? a.name.trim() : "";
        if (!name) return "error: name is required";
        if (a.kind !== "mobile" && a.kind !== "desktop") return "error: kind must be 'mobile' or 'desktop'";

        const tabs: TabSpec[] = Array.isArray(a.tabs)
          ? (a.tabs as any[])
              .filter((t) => t && typeof t.label === "string" && typeof t.icon === "string")
              .map((t) => ({ label: t.label, icon: t.icon, active: t.active === true }))
          : [];
        // Exactly one destination is current. Zero leaves the bar with no state
        // and more than one is two answers to "where am I".
        if (tabs.length > 0 && !tabs.some((t) => t.active)) tabs[0].active = true;

        const spec: ScreenSpec = { name, kind: a.kind, tabs: tabs.length > 0 ? tabs : undefined };
        let counter = 0;
        const base = getNextNodeId(doc, "n").split("_")[1];
        const scaffold = buildScreen(spec, () => `n${Number(base) + counter++}`);

        // Screens sit side by side on the canvas. Nesting one inside another is
        // the single most expensive mistake a run can make.
        let maxX = 0;
        for (const root of doc.children) {
          const right = (root.x ?? 0) + (typeof root.width === "number" ? root.width : 1200);
          if (right > maxX) maxX = right;
        }
        (scaffold.node as any).x = doc.children.length > 0 ? maxX + 80 : 0;
        (scaffold.node as any).y = doc.children[0]?.y ?? 0;

        doc = insertChild(doc, undefined, scaffold.node as PenNode);
        const slots = Object.entries(scaffold.slots)
          .map(([role, id]) => `  ${role}: ${id}`)
          .join("\n");
        return `ok: built ${spec.kind} screen "${name}" (${scaffold.node.id}). Slots:\n${slots}\n\n${digestSubtree(doc, scaffold.node.id)}`;
      }

      case "insert_node": {
        if (!a.node || typeof a.node !== "object") return "error: node is required";
        const rawParentId = typeof a.parentId === "string" ? a.parentId.trim() : undefined;
        const isRootInsert = !rawParentId || WHOLE_DOC_ALIASES.has(rawParentId);
        const targetParent = isRootInsert ? undefined : rawParentId;

        const report: NormalizeReport = { renamed: [], unknown: [], defaulted: [] };
        const nodeToInsert = normalizeNodeTree({ ...(a.node as any) }, report);
        const normalizationNote = describeNormalization(report);

        // If inserting as a root frame, ensure clean side-by-side positioning
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

        const before = doc;
        doc = insertChild(doc, targetParent, nodeToInsert as PenNode, typeof a.index === "number" ? a.index : undefined);
        if (doc === before) return `error: could not insert into ${rawParentId || "canvas"}`;
        const body = targetParent ? digestSubtree(doc, targetParent) : digest(doc);
        return normalizationNote ? `${normalizationNote}\n${body}` : body;
      }

      case "place_instances": {
        const componentId = typeof a.componentId === "string" ? a.componentId.trim() : "";
        const parentId = typeof a.parentId === "string" ? a.parentId.trim() : "";
        const items = Array.isArray(a.items) ? a.items : null;
        if (!componentId || !parentId || !items) return "error: componentId, parentId and items are required";

        const component = findNode(doc.children, componentId);
        if (!component) return `error: component ${componentId} not found`;
        if (!findNode(doc.children, parentId)) return `error: parent ${parentId} not found`;
        if (items.length === 0) return "error: items is empty. Give one entry per instance.";

        // Every id inside the component, so a descendant override that names
        // something that is not there is reported rather than dropped. A typo
        // that silently does nothing is a decision made by a typo.
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

      case "duplicate_node": {
        if (typeof a.id !== "string" || !a.id.trim()) return "error: id is required";
        const targetId = digestId(doc, a.id);
        if (!targetId || !findNode(doc.children, targetId)) return `error: node ${a.id} not found`;

        const res = duplicateNode(doc, targetId);
        if (!res) return `error: could not duplicate ${a.id}`;

        doc = res.doc;
        if (typeof a.name === "string" && a.name.trim()) {
          doc = setProperty(doc, res.newId, "name", a.name.trim());
        }
        return `ok: duplicated ${targetId} as ${res.newId}\n${digestSubtree(doc, res.newId)}`;
      }

      case "delete_node": {
        if (typeof a.id !== "string") return "error: id is required";
        if (!findNode(doc.children, a.id)) return `error: node ${a.id} not found`;
        const parentId = parentIdOf(doc, a.id);
        doc = removeNode(doc, a.id);
        return parentId ? digestSubtree(doc, parentId) : digest(doc);
      }

      case "move_node": {
        if (typeof a.id !== "string" || typeof a.newParentId !== "string") return "error: id and newParentId are required";
        if (!findNode(doc.children, a.id)) return `error: could not move ${a.id}`;
        const oldParent = parentIdOf(doc, a.id);
        const before = digest(doc);
        doc = moveNode(doc, a.id, a.newParentId, typeof a.index === "number" ? a.index : undefined);
        if (digest(doc) === before) return `error: could not move ${a.id}`;
        const parts = [digestSubtree(doc, a.newParentId)];
        if (oldParent && oldParent !== a.newParentId) parts.unshift(digestSubtree(doc, oldParent));
        return parts.join("\n---\n");
      }

      case "measure": {
        const targetId = digestId(doc, a.id);
        // Instances expanded, so `measure` reports the geometry the canvas draws.
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

      case "review_design": {
        const targetId = digestId(doc, a.id);
        if (targetId && !findNode(doc.children, targetId)) {
          return `error: node ${targetId} not found`;
        }
        const findings = auditDocument(doc, targetId);
        const label = targetId
          ? `Audit of ${targetId} and its descendants`
          : "Audit of the whole document";
        return formatAudit(findings, label);
      }

      case "search_icons": {
        const query = typeof a.query === "string" ? a.query : "";
        const matches = searchLucideIcons(query);
        if (matches.length === 0) {
          return `No Lucide icons matching "${query}". Try related keywords like 'heart', 'star', 'user', 'arrow', 'check', 'x', 'bell', 'message', 'sparkles', 'flame', 'filter', 'camera', 'compass', 'trash'.`;
        }
        return `Found ${matches.length} Lucide vector icons for "${query}":\n${matches.map((m) => `• ${m}`).join("\n")}`;
      }

      case "insert_icon": {
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
        return `ok: inserted Lucide icon "${a.icon}" (${size}x${size}px) into ${a.parentId}\n${digestSubtree(doc, targetParent)}`;
      }

      case "generate_image": {
        const prompt = typeof a.prompt === "string" ? a.prompt.trim() : "";
        if (!prompt) return "error: prompt is required for image generation";

        const aspectRatio = (a.aspectRatio === "square" || a.aspectRatio === "landscape" || a.aspectRatio === "portrait")
          ? a.aspectRatio
          : "portrait";

        let result;
        try {
          result = await generateDesignImage(prompt, { aspectRatio });
        } catch (err) {
          if (err instanceof ImageGenUnavailableError) {
            return `error: ${err.message} Design without photography: use a solid or gradient fill, a Lucide icon, or a typographic treatment instead.`;
          }
          throw err;
        }
        const imgUrl = result.url;

        // If a target node ID was provided, update its fill to be this image
        if (typeof a.nodeId === "string") {
          const targetId = digestId(doc, a.nodeId);
          if (targetId && findNode(doc.children, targetId)) {
            doc = setProperty(doc, targetId, "fill", { type: "image", url: imgUrl });
            return `ok: generated image (${result.provider}) and set fill on ${targetId}\n[IMAGE_PREVIEW]: ${imgUrl}\n${digestSubtree(doc, targetId)}`;
          }
        }

        // If a parent ID was provided, insert a new image card frame
        if (typeof a.parentId === "string") {
          const targetParent = digestId(doc, a.parentId);
          const isLandscape = aspectRatio === "landscape";
          const imgFrameNode: PenNode = {
            id: `img_${Math.random().toString(36).slice(2, 8)}`,
            type: "frame",
            name: typeof a.name === "string" ? a.name : `Image — ${prompt.slice(0, 24)}`,
            width: isLandscape ? 350 : 350,
            height: isLandscape ? 200 : 280,
            cornerRadius: 20,
            clip: true,
            fill: { type: "image", url: imgUrl }
          };
          doc = insertChild(doc, targetParent, imgFrameNode);
          return `ok: generated image (${result.provider}) and inserted frame into ${a.parentId}\n[IMAGE_PREVIEW]: ${imgUrl}\n${digestSubtree(doc, targetParent)}`;
        }

        return `ok: generated image (${result.provider})\n[IMAGE_PREVIEW]: ${imgUrl}`;
      }

      default:
        return `error: unknown tool "${name}"`;
    }
  }

  return {
    execute,
    get doc() {
      return doc;
    }
  };
}

/** One line per node: id, name, and the box layout computed for it. */
function formatLayout(node: LayoutNode, doc: Document, depth: number): string {
  const data = findNode(doc.children, node.id);
  const indent = "  ".repeat(depth);
  const name = data?.name ? ` ${data.name}` : "";
  const text =
    data?.type === "text" && typeof (data as any).content === "string"
      ? ` "${(data as any).content.slice(0, 40)}"`
      : "";
  const b = node.box;
  const box = `${round(b.x)},${round(b.y)} ${round(b.width)}x${round(b.height)}`;
  const line = `${indent}${node.id}${name}${text} — ${box}`;
  const children = node.children.map((c) => formatLayout(c, doc, depth + 1));
  return [line, ...children].join("\n");
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
