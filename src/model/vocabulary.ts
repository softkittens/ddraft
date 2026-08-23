/**
 * What properties exist, which node types carry them, and how their values are
 * spelled here.
 *
 * This is a fact about the document format, not about the agent, which is why
 * it sits in the model. Two doors lead to the same engine — a tool call and a
 * click in the editor — and a value the layout engine ignores is just as dead
 * whichever door it came through. Both read these tables.
 */

/** Every property a write is allowed to set. The renderer honours these and no others. */
export const ALLOWED_PROPERTIES = new Set([
  "width", "height", "x", "y", "gap", "padding", "fill", "stroke", "strokeWidth",
  "name", "content", "fontSize", "fontWeight", "fontFamily", "letterSpacing",
  "lineHeight", "textAlign", "textGrowth", "layout", "justifyContent", "alignItems",
  "opacity", "rotation", "cornerRadius", "clip", "enabled", "layoutPosition",
  "effect", "icon", "reusable", "ref"
]);

/** Properties every node type carries. */
export const COMMON_KEYS = new Set([
  "id", "type", "name", "x", "y", "width", "height", "fill", "fills", "stroke", "strokes",
  "strokeWidth", "cornerRadius", "rotation", "opacity", "layoutPosition", "clip", "reusable",
  "enabled", "effect", "metadata", "children"
]);

/** Properties only some node types carry. */
export const TYPE_KEYS: Record<string, Set<string>> = {
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
  note: new Set(["content"]),
  prompt: new Set(["content", "model"]),
  context: new Set(["content"]),
  ref: new Set(["ref", "descendants"])
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
 * module's job; the value it was set to is the same problem one level down.
 */
export const VALUE_ALIASES: Record<string, Record<string, string>> = {
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
 * one line and is the difference between the caller choosing and the caller
 * finding out from a screenshot.
 */
export const VALUE_UNAVAILABLE: Record<string, Record<string, string>> = {
  alignItems: {
    stretch: "children fill the cross axis by setting their own width/height to 'fill_container'",
    baseline: "the engine aligns boxes, not text baselines — use 'end' for a row of mixed type sizes"
  }
};

/**
 * Whether a node of this type carries this property.
 *
 * Used to fan a single edit across a mixed selection: setting the font size of
 * two labels and a frame should set two font sizes, not stamp a meaningless
 * one onto the frame. A type the table does not know carries the common
 * properties and nothing more.
 */
export function propertyAppliesTo(nodeType: string, property: string): boolean {
  if (COMMON_KEYS.has(property)) return true;
  return TYPE_KEYS[nodeType]?.has(property) ?? false;
}

/**
 * The value vocabulary, for the single-property write path.
 *
 * insert_node normalizes because it builds whole trees; set_property never did,
 * so `set_property(id, 'justifyContent', 'space-between')` stayed the CSS
 * spelling and did nothing. A `value` of undefined means the write should not
 * happen and `note` says why.
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
