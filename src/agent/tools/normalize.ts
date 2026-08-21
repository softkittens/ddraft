export interface NormalizeReport {
  renamed: string[];
  unknown: string[];
  defaulted: string[];
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

const PROSE_LENGTH = 40;

function holdsProse(node: any): boolean {
  if (!Array.isArray(node?.children)) return false;
  return node.children.some(
    (c: any) => c?.type === "text" && typeof c.content === "string" && c.content.length > PROSE_LENGTH
  );
}

function applyDefaults(node: any, report: NormalizeReport): void {
  if (node.type === "frame" && typeof node.height === "number" && holdsProse(node)) {
    delete node.height;
    report.defaulted.push("height: fit_content on a frame holding prose");
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
  if (report.unknown.length > 0) {
    const unique = [...new Set(report.unknown)];
    parts.push(
      `warning: dropped ${report.unknown.length} propert${report.unknown.length === 1 ? "y" : "ies"} the engine does not have (${unique.slice(0, 6).join(", ")}${unique.length > 6 ? ", ..." : ""}). Check the node type's property list before you set them again.`
    );
  }
  return parts.join("\n");
}
