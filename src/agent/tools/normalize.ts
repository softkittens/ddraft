import {
  COMMON_KEYS,
  TYPE_KEYS,
  VALUE_ALIASES,
  VALUE_UNAVAILABLE,
  normalizePropertyValue
} from "../../model/vocabulary";

/*
 * Re-exported so the agent's tools keep one import site while the tables
 * themselves live in the model, where the editor can read them too.
 */
export { normalizePropertyValue };

export interface NormalizeReport {
  renamed: string[];
  unknown: string[];
  defaulted: string[];
  /** Values the engine has no equivalent for, with what to write instead. */
  unavailable?: string[];
}


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

const PROSE_LENGTH = 40;

function holdsProse(node: any): boolean {
  if (!Array.isArray(node?.children)) return false;
  return node.children.some(
    (c: any) => c?.type === "text" && typeof c.content === "string" && c.content.length > PROSE_LENGTH
  );
}

/**
 * Three or more children with no distinct x/y (and not marked absolute) will
 * paint on top of each other under layout none. DeepSeek's Casa Lume hero
 * (5f5d9706) shipped 573 collisions that way. A badge or play control on a
 * photo is one or two children; a positioned collage already has x/y.
 */
export function childrenWouldStackAtOrigin(node: any): boolean {
  const kids = (Array.isArray(node?.children) ? node.children : []).filter(
    (c: any) => c && c.enabled !== false
  );
  if (kids.length < 3) return false;
  const placed = kids.filter(
    (c: any) =>
      (typeof c.x === "number" && c.x > 8) ||
      (typeof c.y === "number" && c.y > 8) ||
      c.layoutPosition === "absolute"
  );
  return placed.length < 2;
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
    } else if (node.layout === "none" && childrenWouldStackAtOrigin(node)) {
      node.layout = "vertical";
      report.defaulted.push("layout: 'vertical' on a content frame that used none (children would stack)");
    } else if (node.layout === "horizontal" && Array.isArray(node.children) && node.children.length >= 2) {
      const cardKids = node.children.filter(
        (c: any) =>
          c &&
          c.type === "frame" &&
          (c.layout === "vertical" || c.layout === undefined) &&
          (c.width === "fill_container" || typeof c.width === "number")
      );
      if (cardKids.length >= 2 && cardKids.length === node.children.length) {
        for (const card of cardKids) {
          if (card.height === undefined) {
            card.height = "fill_container";
            report.defaulted.push("height: 'fill_container' on sibling cards in a row");
          }
        }
      }
    }
    return;
  }

  if (node.type !== "text") return;

  const spans = node.width === "fill_container" || typeof node.width === "number";
  const content = typeof node.content === "string" ? node.content : "";
  if (spans && (content.includes(" ") || content.length > 20) && node.textGrowth === undefined) {
    node.textGrowth = "fixed-width";
    report.defaulted.push("textGrowth: 'fixed-width' on wrapping text");
  }
}

export function snapHexToToken(hex: string, variables?: Record<string, any>): string | undefined {
  if (!variables || typeof hex !== "string" || !hex.startsWith("#")) return undefined;
  const cleanHex = hex.trim().toLowerCase();
  for (const [token, def] of Object.entries(variables)) {
    if (!token.startsWith("$")) continue;
    const val = typeof def === "string" ? def : def?.value;
    if (typeof val === "string" && val.trim().toLowerCase() === cleanHex) {
      return token;
    }
  }
  return undefined;
}

export function inferNodeType(node: any): string {
  if (typeof node?.type === "string" && node.type.trim().length > 0) {
    return node.type.trim();
  }
  if (node?.children !== undefined || node?.layout !== undefined || node?.gap !== undefined) return "frame";
  if (node?.content !== undefined || node?.fontSize !== undefined) return "text";
  if (node?.icon !== undefined) return "icon";
  return "frame";
}

export function normalizeNodeTree(node: any, report: NormalizeReport, variables?: Record<string, any>): any {
  if (!node || typeof node !== "object") return node;
  const type = inferNodeType(node);
  const allowed = TYPE_KEYS[type];
  const out: any = { type };
  if (typeof node.type !== "string") {
    report.renamed.push(`missing.type -> ${type}`);
  }

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
    if (key === "type") continue;
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
    let val = value;
    if (target === "content" && typeof val === "string") {
      val = val.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    }
    out[target] = val;
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

  if (variables) {
    if (typeof out.fill === "string") {
      const snapped = snapHexToToken(out.fill, variables);
      if (snapped) {
        report.renamed.push(`${type}.fill: '${out.fill}' -> '${snapped}'`);
        out.fill = snapped;
      }
    } else if (out.fill && typeof out.fill === "object" && typeof out.fill.color === "string") {
      const snapped = snapHexToToken(out.fill.color, variables);
      if (snapped) {
        report.renamed.push(`${type}.fill.color: '${out.fill.color}' -> '${snapped}'`);
        out.fill.color = snapped;
      }
    }
    if (typeof out.stroke === "string") {
      const snapped = snapHexToToken(out.stroke, variables);
      if (snapped) {
        report.renamed.push(`${type}.stroke: '${out.stroke}' -> '${snapped}'`);
        out.stroke = snapped;
      }
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
    out.children = out.children.map((c: any) => normalizeNodeTree(c, report, variables));
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
