export interface NormalizeReport {
  renamed: string[];
  unknown: string[];
  defaulted: string[];
  /** Values the engine has no equivalent for, with what to write instead. */
  unavailable?: string[];
}

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

/**
 * The values a model writes when it is thinking in CSS, and what they are here.
 *
 * The engine reads one spelling and ignores every other, silently: an
 * unrecognised alignItems falls through computeCrossAxisPosition's `default`
 * to `start`, and an unrecognised justifyContent does the same. Across the
 * logs that is 787 writes that did nothing —
 *
 *   justifyContent 'space-between'  256   the hyphen; rows meant to be
 *                                          justified rendered left-packed
 *   textGrowth     'fit_content'    232   text kept growing
 *   textGrowth     'fixed'          158
 *   alignItems     'stretch'         57
 *   alignItems     'flex_end'        37   bar charts hanging from the top of
 *                                          the plot instead of standing on it
 *   alignItems     'baseline'        28
 *
 * — and the last of those is instructed by our own bar-chart rule, which asked
 * for 'flex_end'. Renaming a property the model got wrong was already this
 * function's job; the value it was set to is the same problem one level down.
 */
const VALUE_ALIASES: Record<string, Record<string, string>> = {
  justifyContent: {
    "space-between": "space_between", "space-around": "space_around",
    "space-evenly": "space_around", "space_evenly": "space_around",
    "flex-start": "start", "flex_start": "start", "left": "start",
    "flex-end": "end", "flex_end": "end", "right": "end"
  },
  alignItems: {
    "flex-start": "start", "flex_start": "start", "top": "start",
    "flex-end": "end", "flex_end": "end", "bottom": "end"
  },
  layout: { row: "horizontal", column: "vertical", flex: "horizontal", stack: "vertical" },
  textAlign: { start: "left", end: "right" },
  textGrowth: {
    "fixed": "fixed-width", "fixed_width": "fixed-width",
    "fixed_width_height": "fixed-width-height", "fixed-width_height": "fixed-width-height",
    "fit_content": "auto", "fit-content": "auto", "hug": "auto"
  }
};

/**
 * Values with no equivalent here, and the shape that does the same job.
 *
 * Renaming these would be guessing. Saying what the engine has instead costs
 * one line and is the difference between the model choosing and the model
 * finding out from a screenshot.
 */
const VALUE_UNAVAILABLE: Record<string, Record<string, string>> = {
  alignItems: {
    stretch: "children fill the cross axis by setting their own width/height to 'fill_container'",
    baseline: "the engine aligns boxes, not text baselines — use 'end' for a row of mixed type sizes"
  }
};

const PROSE_LENGTH = 40;

function holdsProse(node: any): boolean {
  if (!Array.isArray(node?.children)) return false;
  return node.children.some(
    (c: any) => c?.type === "text" && typeof c.content === "string" && c.content.length > PROSE_LENGTH
  );
}

function isChipChild(child: any): boolean {
  if (!child) return false;
  if (child.type === "icon" || child.type === "text" || child.type === "ellipse") return true;
  if (child.type !== "frame" && child.type !== "rectangle") return false;
  if (Array.isArray(child.children) && child.children.length > 0) return false;
  const w = typeof child.width === "number" ? child.width : 0;
  const h = typeof child.height === "number" ? child.height : 0;
  return w > 0 && h > 0 && w <= 12 && h <= 12;
}

function isIconButtonOrBadge(node: any): boolean {
  if (node.type !== "frame" || !Array.isArray(node.children)) return false;
  const kids = node.children.filter((c: any) => c && c.enabled !== false);
  // A round button is one glyph. A status chip is a dot plus a word, sometimes
  // with a short label. Past three leaves this is a row, and centering it
  // would fight a left-aligned nav item.
  if (kids.length < 1 || kids.length > 3) return false;
  if (!kids.every(isChipChild)) return false;
  const w = typeof node.width === "number" ? node.width : 0;
  const h = typeof node.height === "number" ? node.height : 0;
  const radius = node.cornerRadius;
  const isPillOrCircle =
    (typeof radius === "number" && radius >= 12) ||
    (Array.isArray(radius) && radius.some((r: any) => typeof r === "number" && r >= 12));
  const isSquare = w > 0 && h > 0 && Math.abs(w - h) <= 8 && w <= 80;
  return isSquare || isPillOrCircle;
}

/**
 * Lucide draws on a 24x24 grid, and an icon with no size means that one.
 *
 * An icon node carries no intrinsic geometry here, so omitting width and height
 * resolved to 0x0 and the glyph simply was not there. It is the commonest icon
 * shape a model writes after `size`: of the 207 icons in one logged run, most
 * arrived as { type, name, icon, stroke } and nothing else, and 22 of them
 * shipped invisible under a clean audit. Nothing about that omission is a
 * design decision worth a round trip — 24 is what the library itself means by
 * an unspecified icon.
 */
const DEFAULT_ICON_SIZE = 24;

function applyDefaults(node: any, report: NormalizeReport): void {
  if (node.type === "icon") {
    if (node.width === undefined && node.height === undefined) {
      node.width = DEFAULT_ICON_SIZE;
      node.height = DEFAULT_ICON_SIZE;
      report.defaulted.push(`width/height: ${DEFAULT_ICON_SIZE} on an icon with no size`);
    } else if (node.width === undefined && typeof node.height === "number") {
      node.width = node.height;
      report.defaulted.push("width: matched to height on a square icon");
    } else if (node.height === undefined && typeof node.width === "number") {
      node.height = node.width;
      report.defaulted.push("height: matched to width on a square icon");
    }
    return;
  }

  if (node.type === "frame") {
    if (typeof node.height === "number" && holdsProse(node)) {
      delete node.height;
      report.defaulted.push("height: fit_content on a frame holding prose");
    }
    if (isIconButtonOrBadge(node)) {
      if (node.layout === "none") {
        node.layout = "horizontal";
        report.defaulted.push("layout: 'horizontal' on icon/badge container");
      }
      if (node.justifyContent === undefined) {
        node.justifyContent = "center";
        report.defaulted.push("justifyContent: 'center' on icon/badge container");
      }
      if (node.alignItems === undefined) {
        node.alignItems = "center";
        report.defaulted.push("alignItems: 'center' on icon/badge container");
      }
    }
    return;
  }

  if (node.type !== "text") return;

  const spans = node.width === "fill_container" || typeof node.width === "number";
  const content = typeof node.content === "string" ? node.content : "";
  if (spans && content.length > PROSE_LENGTH && node.textGrowth === undefined) {
    node.textGrowth = "fixed-width";
    report.defaulted.push("textGrowth: 'fixed-width' on wrapping text");
  }
}

export function normalizeNodeTree(node: any, report: NormalizeReport): any {
  if (!node || typeof node !== "object") return node;
  const type = typeof node.type === "string" ? node.type : "frame";
  const allowed = TYPE_KEYS[type];
  const out: any = {};

  /*
   * `size` means fontSize on text and a square box on everything else.
   *
   * The flat alias map could only pick one, and it picked fontSize, so
   * `{ type: "icon", icon: "map-pin", size: 14 }` — the shape a model reaches
   * for by default — had its only dimension dropped as an unknown property and
   * resolved to a 0x0 icon. Two logged runs shipped 39 and 11 invisible icons
   * that way, both with a clean audit, because a zero-sized leaf was nobody's
   * business to check.
   */
  let squareSize: number | undefined;

  for (const [key, value] of Object.entries(node)) {
    let target = key;
    const known = COMMON_KEYS.has(key) || allowed?.has(key);
    if (!known) {
      if (key === "size" && type !== "text" && typeof value === "number") {
        squareSize = value;
        continue;
      }
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

  for (const [key, table] of Object.entries(VALUE_ALIASES)) {
    const value = out[key];
    if (typeof value !== "string") continue;
    const mapped = table[value];
    if (mapped && mapped !== value) {
      out[key] = mapped;
      report.renamed.push(`${type}.${key}: '${value}' -> '${mapped}'`);
    }
  }
  for (const [key, table] of Object.entries(VALUE_UNAVAILABLE)) {
    const value = out[key];
    if (typeof value !== "string") continue;
    const advice = table[value];
    if (advice) {
      delete out[key];
      (report.unavailable ??= []).push(`${key}: '${value}' — ${advice}`);
    }
  }

  if (squareSize !== undefined) {
    const axes: string[] = [];
    if (out.width === undefined) { out.width = squareSize; axes.push("width"); }
    if (out.height === undefined) { out.height = squareSize; axes.push("height"); }
    if (axes.length > 0) report.renamed.push(`${type}.size -> ${axes.join(" + ")}`);
    else report.unknown.push(`${type}.size`);
  }

  if (Array.isArray(out.children)) {
    out.children = out.children.map((c: any) => normalizeNodeTree(c, report));
  }
  applyDefaults(out, report);
  return out;
}

export function describeNormalization(report: NormalizeReport): string {
  const parts: string[] = [];
  if (report.renamed.length > 0) {
    const unique = [...new Set(report.renamed)];
    parts.push(
      `note: renamed ${report.renamed.length} propert${report.renamed.length === 1 ? "y" : "ies"} to the schema name (${unique.slice(0, 4).join(", ")}${unique.length > 4 ? ", ..." : ""}).`
    );
  }
  if (report.defaulted.length > 0) {
    const unique = [...new Set(report.defaulted)];
    parts.push(
      `note: filled in ${report.defaulted.length} value${report.defaulted.length === 1 ? "" : "s"} the engine can derive (${unique.join(", ")}).`
    );
  }
  if (report.unavailable && report.unavailable.length > 0) {
    const unique = [...new Set(report.unavailable)];
    parts.push(
      `warning: dropped ${unique.length} value${unique.length === 1 ? "" : "s"} the engine has no equivalent for. ${unique.join("; ")}.`
    );
  }
  if (report.unknown.length > 0) {
    const unique = [...new Set(report.unknown)];
    parts.push(
      `warning: dropped ${report.unknown.length} propert${report.unknown.length === 1 ? "y" : "ies"} the engine does not have (${unique.slice(0, 6).join(", ")}${unique.length > 6 ? ", ..." : ""}). Check the node type's property list before you set them again.`
    );
  }
  return parts.join("\n");
}

/**
 * The same value vocabulary, for the single-property write path.
 *
 * insert_node normalizes because it builds whole trees; set_property never did,
 * so `set_property(id, 'justifyContent', 'space-between')` stayed the CSS
 * spelling and did nothing. Both doors lead to the same engine.
 */
export function normalizePropertyValue(
  property: string,
  value: unknown
): { value: unknown; note: string } {
  if (typeof value !== "string") return { value, note: "" };
  const mapped = VALUE_ALIASES[property]?.[value];
  if (mapped && mapped !== value) {
    return { value: mapped, note: `note: ${property} '${value}' is written '${mapped}' here; applied as '${mapped}'.` };
  }
  const advice = VALUE_UNAVAILABLE[property]?.[value];
  if (advice) {
    return { value: undefined, note: `error: ${property} has no '${value}' — ${advice}.` };
  }
  return { value, note: "" };
}
