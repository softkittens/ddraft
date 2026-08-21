import type { Document, PenNode, IconNode } from "../model/types";
import { insertChild, moveNode, removeNode, setProperty, duplicateNode, getNextNodeId } from "../model/edit";
import { childrenOf, findNode, maxNumericId } from "../model/tree";
import { resolveInstances } from "../model/instance";
import { digest, digestSubtree } from "../digest/digest";
import { layoutResolvedDocument, flattenLayoutTree } from "../layout/layout";
import type { LayoutNode } from "../layout/types";
import {
  designDirection,
  resolveStyle,
  styleGuidelines,
  StyleChoiceError,
  DIRECTION_METADATA_KEY,
  STYLE_METADATA_KEY
} from "../design/styleSystem";
// Registers the full icon catalog. Without it every name outside the
// browser core map resolves to nothing and paints the fallback glyph.
import "../model/iconCatalog";
import { searchLucideIcons, getLucideIconPath } from "../model/icons";
import { insertionNote } from "../design/evaluator";
import { buildScreen, MOBILE_HEIGHT, MOBILE_WIDTH, type ScreenSpec, type TabSpec } from "../design/scaffold";
import { generateDesignImage, ImageGenUnavailableError } from "./image_gen";
import type { FetchFn, Tool } from "./provider";
import toolDefs from "./tools.json";

const ALLOWED_PROPERTIES = new Set([
  "width", "height", "x", "y", "gap", "padding", "fill", "stroke", "strokeWidth",
  "name", "content", "fontSize", "fontWeight", "fontFamily", "letterSpacing",
  "lineHeight", "textAlign", "textGrowth", "layout", "justifyContent", "alignItems",
  "opacity", "rotation", "cornerRadius", "clip", "enabled", "layoutPosition",
  "effect", "icon", "strokeWidth", "textGrowth", "reusable", "ref"
]);

/**
 * Icon nodes carry their own geometry so the browser paints any Lucide icon
 * without bundling the catalog. Only insert_icon resolved it, so every icon
 * arriving through insert_node or create_screen's tab bar fell through to the
 * painter's generic fallback glyph.
 */
function resolveIconGeometry<T>(node: T): T {
  const item = node as any;
  if (!item || typeof item !== "object") return node;
  if (item.type === "icon" && typeof item.icon === "string" && !item.geometry) {
    const geom = getLucideIconPath(item.icon);
    if (geom) item.geometry = geom;
  }
  if (Array.isArray(item.children)) {
    for (const child of item.children) resolveIconGeometry(child);
  }
  return node;
}

/**
 * An icon rename must carry its geometry across, or the node keeps painting the
 * shape it had before. An unknown name clears it so the painter falls back
 * rather than lying with the previous icon.
 */
function applyIconRename(doc: Document, id: string, property: string, value: unknown): Document {
  if (property !== "icon" || typeof value !== "string") return doc;
  return setProperty(doc, id, "geometry", getLucideIconPath(value) || undefined);
}

/**
 * Properties whose effect is a box, not a value.
 *
 * A run spent 28 of 96 tool calls on `measure`, against three distinct ids, and
 * wrote one frame's height five times (410, fit_content, fit_content, 70, 90) —
 * the second fit_content being an exact repeat of the first. set_property
 * answered with the declared subtree, which just echoes back the value that was
 * just written, so the only way to learn what a size change actually did was
 * another round-trip. Answering with the resolved box removes the reason to ask.
 */
const GEOMETRY_PROPERTIES = new Set([
  "width", "height", "gap", "padding", "layout", "fontSize", "lineHeight",
  "letterSpacing", "textGrowth", "alignItems", "justifyContent", "strokeWidth"
]);

/** The measured box of a node and its parent, one line each. */
function measuredNote(doc: Document, id: string): string {
  try {
    const flat = flattenLayoutTree(layoutResolvedDocument(resolveInstances(doc)));
    const node = flat.get(id);
    if (!node) return "";
    const box = (n: { box: { width: number; height: number } }) =>
      `${Math.round(n.box.width)}x${Math.round(n.box.height)}`;
    const self = findNode(doc.children, id);
    const parts = [`measured: ${self?.name ? `"${self.name}"` : id} is now ${box(node)}px`];
    const parentId = parentOfNode(doc, id);
    const parent = parentId ? flat.get(parentId) : undefined;
    if (parent && parentId) {
      const parentNode = findNode(doc.children, parentId);
      parts.push(`inside ${parentNode?.name ? `"${parentNode.name}"` : parentId} at ${box(parent)}px`);
    }
    return parts.join(", ") + ".";
  } catch {
    // Measurement is an extra, never a reason to fail a write.
    return "";
  }
}

function parentOfNode(doc: Document, id: string): string | undefined {
  let found: string | undefined;
  function walk(node: PenNode) {
    for (const child of childrenOf(node)) {
      if (child.id === id) found = node.id;
      else walk(child);
    }
  }
  for (const root of doc.children) {
    if (root.id === id) return undefined;
    walk(root);
  }
  return found;
}

/**
 * Write through a synthetic instance id.
 *
 * resolveInstances names an instance's descendants "<refId>:<originalId>" so
 * the resolved tree has unique ids, and `measure` reports those names because
 * it measures the resolved tree. Nothing accepted them back: a run read
 * ref_9322:frame_vi6l6f out of a measure result, tried to set a property on it,
 * and got "node not found" three times. One tool handing out an identifier
 * another refuses is a trap the tools set themselves.
 *
 * The name already says what the write means — this descendant, in this
 * instance — which is exactly what place_instances takes as an override.
 */
function splitInstanceId(doc: Document, id: string): { refId: string; descendantId: string } | undefined {
  const at = id.indexOf(":");
  if (at <= 0) return undefined;
  const refId = id.slice(0, at);
  const descendantId = id.slice(at + 1);
  const host = findNode(doc.children, refId);
  if (!host || host.type !== "ref" || !descendantId) return undefined;

  // The descendant has to exist in the component, or the override is a typo
  // that writes a key nothing will ever read. place_instances already refuses
  // those by name; a write through a synthetic id is the same promise.
  const component = (host as PenNode & { ref?: string }).ref
    ? findNode(doc.children, (host as PenNode & { ref?: string }).ref!)
    : null;
  if (!component) return undefined;
  let known = false;
  (function walk(node: PenNode) {
    if (node.id === descendantId) known = true;
    for (const child of childrenOf(node)) walk(child);
  })(component);
  if (!known) return undefined;

  return { refId, descendantId };
}

function setInstanceProperty(
  doc: Document,
  target: { refId: string; descendantId: string },
  property: string,
  value: unknown
): Document {
  const host = findNode(doc.children, target.refId) as (PenNode & { descendants?: Record<string, any> }) | null;
  if (!host) return doc;
  const descendants = {
    ...(host.descendants ?? {}),
    [target.descendantId]: { ...(host.descendants?.[target.descendantId] ?? {}), [property]: value }
  };
  return setProperty(doc, target.refId, "descendants", descendants);
}

function resizesMobileScreen(doc: Document, id: string, property: string): boolean {
  if (property !== "width" && property !== "height") return false;
  const root = doc.children.find((node) => node.id === id);
  return root?.type === "frame" && root.metadata?.screenKind === "mobile";
}

function mobileSizeError(id: string): string {
  return `error: ${id} is a fixed ${MOBILE_WIDTH}x${MOBILE_HEIGHT} mobile screen. Keep the root size; shorten or remove content, or reduce inner gaps and padding so it fits.`;
}

/**
 * What the model is offered, as the wire format the provider reads.
 *
 * The definitions are a JSON Schema per tool plus the sentence that tells the
 * model when to reach for it — data and prose, not behaviour, and two hundred
 * and forty lines of object literal when they lived here. tools.json holds them
 * verbatim; execute() below is the part that is code.
 */
export const TOOL_DEFS: Tool[] = toolDefs;

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

export function createDocumentTools(
  initial: Document,
  image: { providerId?: string; apiKey?: string; fetch?: FetchFn } = {}
) {
  let doc = initial;

  /**
   * Every value each property has been given during this session.
   *
   * A review pass in one trace wrote frame_qcdz6z.height as 450, 250, 450, 250
   * and frame_ju30uo.height as fit_content, 188, 188, fit_content — landing back
   * where it started after four writes. That is not converging on an answer, it
   * is alternating between two guesses, and nothing in the loop said so. Naming
   * the repeat turns an invisible oscillation into something the model can act
   * on: the value is not the problem, so stop trying values.
   */
  const writeHistory = new Map<string, string[]>();
  /**
   * The repeats since the session loop last asked, so it can price them.
   *
   * The note below is advice, and advice is refusable: one run read it four
   * times and kept alternating, because every round still counted as progress
   * — the document changed each time. The loop needs the same finding as a
   * fact it can act on, and it should come from here rather than from a second
   * history built by re-reading tool arguments, which would be free to drift
   * from what the tools actually did.
   */
  const revisited = new Map<string, string[]>();

  function recordWrite(id: string, property: string, value: unknown): string {
    const key = `${id}.${property}`;
    const seen = writeHistory.get(key) ?? [];
    const encoded = JSON.stringify(value ?? null);
    const repeat = seen.includes(encoded);
    writeHistory.set(key, [...seen, encoded]);
    if (!repeat || seen.length < 2) return "";
    revisited.set(key, [...seen, encoded]);
    return `note: ${key} has now been ${seen.length + 1} values this session and is back to one it already had (${seen.map((v) => v).join(" -> ")}). The value is not what decides this box. Change the parent's layout, or delete the node and rebuild it.`;
  }

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
        const direction = designDirection(a);
        if (!direction) return "error: thesis, ownWorld and firstViewport are required";

        const newDoc: Document = structuredClone(doc);
        newDoc.variables = { ...(newDoc.variables ?? {}), ...style.variables };
        newDoc.metadata = {
          ...(newDoc.metadata ?? {}),
          [STYLE_METADATA_KEY]: style.choice,
          [DIRECTION_METADATA_KEY]: direction
        };
        doc = newDoc;

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

        const blocked = updates.find((u) =>
          u && typeof u.id === "string" && typeof u.property === "string" &&
          resizesMobileScreen(doc, u.id, u.property)
        );
        if (blocked) {
          return mobileSizeError(blocked.id);
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
        const head = `ok: updated ${modifiedIds.length} properties (${modifiedIds.slice(0, 6).join(", ")}${modifiedIds.length > 6 ? "..." : ""})`;
        if (unchanged) {
          return `${head}\nno change: every value was already set. Something else is deciding these boxes — measure them, or change the parent instead.`;
        }
        const touched = [...new Set(
          updates
            .filter((u) => u && typeof u.property === "string" && GEOMETRY_PROPERTIES.has(u.property))
            .map((u) => u.id as string)
        )].slice(0, 6);
        const notes = touched.map((id) => measuredNote(doc, id)).filter(Boolean);
        const loops = updates
          .filter((u) => u && typeof u.id === "string" && typeof u.property === "string")
          .map((u) => recordWrite(u.id as string, u.property as string, u.value))
          .filter(Boolean);
        return [head, ...notes, ...loops].join("\n");
      }

      case "set_property": {
        if (typeof a.id !== "string" || typeof a.property !== "string") return "error: id and property are required";
        if (!ALLOWED_PROPERTIES.has(a.property)) return `error: invalid property "${a.property}"`;
        if (!findNode(doc.children, a.id)) {
          const inside = splitInstanceId(doc, a.id);
          if (!inside) return `error: node ${a.id} not found`;
          const beforeInstance = doc;
          doc = setInstanceProperty(doc, inside, a.property, a.value);
          if (doc === beforeInstance) return `error: could not override ${inside.descendantId} in ${inside.refId}`;
          const loopNote = recordWrite(a.id, a.property, a.value);
          return [
            `ok: set ${a.property} on ${inside.descendantId} inside instance ${inside.refId}. Only this instance changed.`,
            GEOMETRY_PROPERTIES.has(a.property) ? measuredNote(doc, inside.refId) : "",
            loopNote
          ].filter(Boolean).join("\n");
        }
        if (resizesMobileScreen(doc, a.id, a.property)) return mobileSizeError(a.id);
        const beforeWrite = doc;
        doc = setProperty(doc, a.id, a.property, a.value);
        doc = applyIconRename(doc, a.id, a.property, a.value);
        // A write that changed nothing is worth saying out loud. The same value
        // set twice reads as ok twice, and the model keeps pulling a lever that
        // is not attached to anything.
        if (doc === beforeWrite) {
          return `no change: ${a.id}.${a.property} is already ${JSON.stringify(a.value)}. Something else is deciding this box — measure it, or change the parent instead.`;
        }
        const note = GEOMETRY_PROPERTIES.has(a.property) ? measuredNote(doc, a.id) : "";
        const loop = recordWrite(a.id, a.property, a.value);
        return [digestSubtree(doc, a.id), note, loop].filter(Boolean).join("\n");
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
        resolveIconGeometry(scaffold.node);

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
        const screenNote = insertionNote(doc, scaffold.node.id);
        return [
          `ok: built ${spec.kind} screen "${name}" (${scaffold.node.id}). Slots:`,
          slots,
          "",
          digestSubtree(doc, scaffold.node.id),
          ...(screenNote ? ["", screenNote] : [])
        ].join("\n");
      }

      case "insert_node": {
        if (!a.node || typeof a.node !== "object") return "error: node is required";
        const rawParentId = typeof a.parentId === "string" ? a.parentId.trim() : undefined;
        const isRootInsert = !rawParentId || WHOLE_DOC_ALIASES.has(rawParentId);
        const targetParent = isRootInsert ? undefined : rawParentId;

        const report: NormalizeReport = { renamed: [], unknown: [], defaulted: [] };
        const nodeToInsert = resolveIconGeometry(normalizeNodeTree({ ...(a.node as any) }, report));
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
        // Measured here rather than at the end of the run: a defect found now
        // costs one tool result, and the same defect found after three more
        // sections costs a round-trip that replays the whole context.
        const note = insertionNote(doc, (nodeToInsert as PenNode).id);
        return [normalizationNote, body, note].filter(Boolean).join("\n");
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
        // Where a node lives is a slot like any other, and moving it back and
        // forth between two parents is the same failure as toggling a value.
        const loop = recordWrite(a.id, "parent", a.newParentId);
        return [parts.join("\n---\n"), loop].filter(Boolean).join("\n");
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

        const targetId = digestId(doc, a.nodeId);
        if (!targetId) return "error: existing nodeId is required for image generation";
        // A per-instance image is the ordinary case — three list rows showing
        // three different cats — and the id measure reports for that frame is
        // the synthetic one. Rejecting it sent one run through three retries
        // before it gave up and built separate frames instead.
        const instanceTarget = findNode(doc.children, targetId) ? undefined : splitInstanceId(doc, targetId);
        if (!findNode(doc.children, targetId) && !instanceTarget) {
          return `error: node ${targetId} not found. Pass the id of an existing node to fill.`;
        }

        const target = flattenLayoutTree(layoutResolvedDocument(resolveInstances(doc))).get(targetId);
        if (!target || target.box.width <= 0 || target.box.height <= 0) {
          return `error: node ${targetId} must have measurable dimensions before image generation`;
        }
        const ratio = target.box.width / target.box.height;
        const aspectRatio = ratio > 1.15 ? "landscape" : ratio < 0.87 ? "portrait" : "square";
        const targetSize = `${Math.round(target.box.width)}x${Math.round(target.box.height)}`;

        let result;
        try {
          result = await generateDesignImage(prompt, {
            aspectRatio,
            providerId: image.providerId,
            apiKey: image.apiKey,
            fetch: image.fetch
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
          return `ok: generated image (${result.provider}) using ${aspectRatio} composition for the ${targetSize} target and set fill on ${instanceTarget.descendantId} inside instance ${instanceTarget.refId}. Only this instance changed.`;
        }
        doc = setProperty(doc, targetId, "fill", { type: "image", url: imgUrl });
        return `ok: generated image (${result.provider}) using ${aspectRatio} composition for the ${targetSize} target and set fill on ${targetId}\n${digestSubtree(doc, targetId)}`;
      }

      default:
        return `error: unknown tool "${name}"`;
    }
  }

  return {
    execute,
    get doc() {
      return doc;
    },
    /** Slots put back to a value they already held, and cleared as they are read. */
    drainRevisits(): { key: string; values: string[] }[] {
      const out = [...revisited].map(([key, values]) => ({ key, values }));
      revisited.clear();
      return out;
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
