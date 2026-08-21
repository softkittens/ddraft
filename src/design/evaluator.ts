import type { LayoutNode, Box } from "../layout/types";
import type { Document, TextNode, PenNode, FrameNode } from "../model/types";
import { childrenOf, indexDocument } from "../model/tree";
import { resolveVariable } from "../model/variables";
import { measureTextWidth } from "../layout/text";
import { flattenLayoutTree, layoutResolvedDocument } from "../layout/layout";
import { resolveInstances } from "../model/instance";

export type FindingRule = "collision" | "overflow" | "unreadable_size" | "off_canvas";

/** Below this, text is unreadable on any device. A blocker anywhere. */
export const HARD_MIN_FONT_SIZE = 9;

export interface Finding {
  rule: FindingRule;
  nodeId: string;
  message: string;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function checkCollision(nodes: LayoutNode[], doc: Document): Finding[] {
  const findings: Finding[] = [];
  const map = indexDocument(doc);

  function checkSiblings(siblings: LayoutNode[]) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i];
        const b = siblings[j];
        const aDoc = map.get(a.id);
        const bDoc = map.get(b.id);

        if (aDoc?.enabled === false || bDoc?.enabled === false) continue;
        if (aDoc?.layoutPosition === "absolute" || bDoc?.layoutPosition === "absolute") continue;

        if (a.box.width > 0 && a.box.height > 0 && b.box.width > 0 && b.box.height > 0) {
          if (boxesOverlap(a.box, b.box)) {
            findings.push({
              rule: "collision",
              nodeId: a.id,
              message: `Node "${a.id}" collides with sibling "${b.id}"`
            });
          }
        }
      }
      if (map.get(siblings[i].id)?.enabled !== false && siblings[i].children.length > 0) {
        checkSiblings(siblings[i].children);
      }
    }
  }

  checkSiblings(nodes);
  return findings;
}

export function checkOverflow(nodes: LayoutNode[], doc: Document): Finding[] {
  const findings: Finding[] = [];
  const map = indexDocument(doc);

  function walk(parent: LayoutNode) {
    if (map.get(parent.id)?.enabled === false) return;
    if (parent.type === "frame" && parent.box.width > 0 && parent.box.height > 0) {
      const parentDoc = map.get(parent.id) as FrameNode | undefined;
      const isClipped = parentDoc?.clip === true;

      for (const child of parent.children) {
        const childDoc = map.get(child.id);
        if (childDoc?.enabled === false) continue;
        if (!isClipped) continue;

        const overRight = child.box.x + child.box.width - parent.box.width;
        const overBottom = child.box.y + child.box.height - parent.box.height;
        const parts: string[] = [];
        if (child.box.x < -1.0) parts.push(`${Math.round(-child.box.x)}px past the left edge`);
        if (overRight > 1.0) parts.push(`${Math.round(overRight)}px past the right edge`);
        if (child.box.y < -1.0) parts.push(`${Math.round(-child.box.y)}px past the top edge`);
        if (overBottom > 1.0) parts.push(`${Math.round(overBottom)}px past the bottom edge`);
        if (parts.length > 0) {
          findings.push({
            rule: "overflow",
            nodeId: child.id,
            message:
              `"${child.id}" (${Math.round(child.box.width)}x${Math.round(child.box.height)}px) extends ` +
              `${parts.join(" and ")} of parent "${parent.id}" ` +
              `(${Math.round(parent.box.width)}x${Math.round(parent.box.height)}px). It will be clipped.`
          });
        }
      }
    }
    for (const child of parent.children) {
      walk(child);
    }
  }

  for (const root of nodes) {
    walk(root);
  }
  return findings;
}

export function checkUnreadableSize(document: Document): Finding[] {
  const findings: Finding[] = [];

  function walk(n: PenNode) {
    if (n.enabled === false) return;
    if (n.type === "text") {
      const textNode = n as TextNode;
      if (textNode.fontSize !== undefined && textNode.fontSize < HARD_MIN_FONT_SIZE) {
        findings.push({
          rule: "unreadable_size",
          nodeId: n.id,
          message: `"${n.id}" sets fontSize ${textNode.fontSize}px, below the ${HARD_MIN_FONT_SIZE}px readable floor.`
        });
      }
    }
    for (const child of childrenOf(n)) walk(child);
  }

  document.children.forEach(walk);
  return findings;
}

export function checkOffCanvas(nodes: LayoutNode[]): Finding[] {
  const findings: Finding[] = [];

  for (const root of nodes) {
    if (root.box.x < 0 || root.box.y < 0) {
      findings.push({
        rule: "off_canvas",
        nodeId: root.id,
        message: `Node "${root.id}" is placed off canvas (${root.box.x}, ${root.box.y})`
      });
    }
  }
  return findings;
}

export function evaluateLayoutConstraints(tree: LayoutNode[], doc: Document): Finding[] {
  return [
    ...checkCollision(tree, doc),
    ...checkOverflow(tree, doc),
    ...checkUnreadableSize(doc),
    ...checkOffCanvas(tree)
  ];
}


function parseHexColor(colorStr: string): { r: number; g: number; b: number } | null {
  if (!colorStr.startsWith("#")) return null;
  const hex = colorStr.slice(1);
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16)
    };
  }
  if (hex.length >= 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }
  return null;
}

function getRelativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/* ------------------------------------------------------------------ *
 * Design audit
 *
 * Every finding must name a node and carry the numbers that produced it.
 * A finding without numbers cannot be acted on, and a rule that cannot
 * fail is not a rule. See test/audit.test.ts, which injects a fault for
 * each rule below and asserts it is reported.
 * ------------------------------------------------------------------ */

export type AuditRule =
  | "clipped"
  | "collision"
  | "text_too_small"
  | "low_contrast"
  | "tap_target"
  | "off_canvas"
  | "empty_container"
  | "type_scale"
  | "spacing_scale"
  | "radius_scale"
  | "token_bypass"
  | "nested_screen"
  | "text_clipped"
  | "empty_text"
  | "duplicate_region"
  | "accent_overuse";

export interface AuditFinding {
  rule: AuditRule;
  severity: "blocker" | "warning";
  nodeId: string;
  /** States what is wrong, with the measured values. */
  message: string;
  /** States the change that resolves it. */
  fix: string;
}

/** Smallest text the composition rules allow. */
export const MIN_FONT_SIZE = 11;
/** Smallest comfortable touch target, in points. */
export const MIN_TAP_TARGET = 44;

function collectSubtreeIds(doc: Document, rootId: string): Set<string> | undefined {
  const ids = new Set<string>();
  let found = false;

  function collect(node: PenNode) {
    ids.add(node.id);
    for (const child of childrenOf(node)) collect(child);
  }
  function search(nodes: PenNode[]) {
    for (const node of nodes) {
      if (node.id === rootId) {
        found = true;
        collect(node);
        return;
      }
      search(childrenOf(node));
      if (found) return;
    }
  }

  search(doc.children);
  return found ? ids : undefined;
}

export function contrastRatio(
  fg: string | undefined,
  bg: string | undefined,
  variables?: Record<string, any>
): number | null {
  const fgHex = parseHexColor(resolveVariable(fg, variables));
  const bgHex = parseHexColor(resolveVariable(bg, variables));
  if (!fgHex || !bgHex) return null;
  const l1 = getRelativeLuminance(fgHex);
  const l2 = getRelativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Node types whose fill paints a background others sit on. */
const BACKGROUND_TYPES = new Set(["frame", "group", "rectangle", "ellipse", "polygon"]);

function solidFillOf(node: PenNode | undefined): string | undefined {
  if (!node || !BACKGROUND_TYPES.has(node.type)) return undefined;
  const fill = (node as any).fill;
  if (typeof fill === "string") return fill;
  if (Array.isArray(fill)) {
    const solid = fill.find((f: any) => f?.type === "color" && typeof f.color === "string");
    return solid?.color;
  }
  if (fill && typeof fill === "object" && fill.type === "color" && typeof fill.color === "string") {
    return fill.color;
  }
  return undefined;
}

function hasImageFill(node: PenNode | undefined): boolean {
  if (!node) return false;
  const fill = (node as any).fill;
  if (Array.isArray(fill)) return fill.some((f: any) => f?.type === "image");
  return !!fill && typeof fill === "object" && (fill as any).type === "image";
}

/** Text over a photo or gradient has no single background colour to measure. */
function overUnmeasurableBackground(node: PenNode | undefined): boolean {
  if (!node) return false;
  const fill = (node as any).fill;
  if (Array.isArray(fill)) return fill.some((f: any) => f?.type === "image" || f?.type === "gradient");
  return !!fill && typeof fill === "object" && ((fill as any).type === "image" || (fill as any).type === "gradient");
}

function checkContrast(tree: LayoutNode[], doc: Document, map: Map<string, PenNode>): AuditFinding[] {
  const findings: AuditFinding[] = [];

  function walk(node: LayoutNode, inheritedBg: string | undefined, unmeasurable: boolean) {
    const data = map.get(node.id);
    if (data?.enabled === false) return;
    const ownFill = solidFillOf(data);
    const bg = ownFill ?? inheritedBg;
    const nowUnmeasurable = unmeasurable || overUnmeasurableBackground(data);

    if (data?.type === "text" && !nowUnmeasurable) {
      const text = data as TextNode;
      const ratio = contrastRatio(
        typeof text.fill === "string" ? text.fill : undefined,
        bg,
        doc.variables
      );
      if (ratio !== null) {
        const size = text.fontSize ?? 16;
        const bold = text.fontWeight === "bold" || Number(text.fontWeight) >= 700;
        const isLarge = size >= 24 || (size >= 18.66 && bold);
        const required = isLarge ? 3 : 4.5;
        if (ratio < required) {
          findings.push({
            rule: "low_contrast",
            severity: "blocker",
            nodeId: node.id,
            message: `Text "${(text.content ?? "").slice(0, 32)}" at ${size}px measures ${ratio.toFixed(2)}:1 against its background (${resolveVariable(text.fill as string, doc.variables)} on ${resolveVariable(bg, doc.variables)}). ${required}:1 is required.`,
            fix: `Use $foreground-primary or $foreground-secondary on $surface-primary / $surface-secondary. $foreground-muted is only for text at 11-12px that is genuinely tertiary.`
          });
        }
      }
    }

    for (const child of node.children) walk(child, bg, nowUnmeasurable);
  }

  for (const root of tree) walk(root, solidFillOf(map.get(root.id)), false);
  return findings;
}

/**
 * A text node only wraps when textGrowth is 'fixed-width'. Left at the default
 * the engine measures one long line, the frame gives the node the container
 * width anyway, and the rest of the sentence is cut off — without ever
 * overflowing its own box, so the box-versus-parent check cannot see it. This
 * is the defect that shipped as "...loves morning gallops in open past".
 */
function checkTextClipping(
  tree: LayoutNode[],
  doc: Document,
  map: Map<string, PenNode>
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  function walk(node: LayoutNode) {
    const data = map.get(node.id);
    if (data?.enabled === false) return;
    if (data?.type === "text") {
      const text = data as TextNode;
      const content = text.content ?? "";
      if (!content.trim()) {
        findings.push({
          rule: "empty_text",
          severity: "blocker",
          nodeId: node.id,
          message: `Text node "${text.name ?? node.id}" has no content, so it renders as nothing.`,
          fix: "Set the copy on the `content` property. The engine reads `content`, not `text` or `label`."
        });
      }
      const wraps = text.textGrowth === "fixed-width" || text.textGrowth === "fixed-width-height";
      if (content && !wraps && node.box.width > 0) {
        const intrinsic = measureTextWidth(
          content,
          text.fontSize ?? 16,
          text.fontFamily ?? "Inter",
          text.fontWeight,
          text.letterSpacing ?? 0,
          doc.variables
        );
        if (intrinsic > node.box.width + 1) {
          findings.push({
            rule: "text_clipped",
            severity: "blocker",
            nodeId: node.id,
            message: `"${content.slice(0, 40)}${content.length > 40 ? "…" : ""}" needs ${Math.round(intrinsic)}px on one line but its box is ${Math.round(node.box.width)}px. It will be cut off.`,
            fix: "Set textGrowth: 'fixed-width' so the text wraps, together with width: 'fill_container'. Text only wraps when textGrowth says it may."
          });
        }
      }
    }
    for (const child of node.children) walk(child);
  }

  for (const root of tree) walk(root);
  return findings;
}

const INTERACTIVE_NAME = /(button|btn|tab|action|toggle|fab|chip|control|cta)/i;

function checkTapTargets(tree: LayoutNode[], map: Map<string, PenNode>): AuditFinding[] {
  const findings: AuditFinding[] = [];

  function walk(node: LayoutNode) {
    const data = map.get(node.id);
    if (data?.enabled === false) return;
    const named = INTERACTIVE_NAME.test(data?.name ?? "");
    if (named && node.box.width > 0 && node.box.height > 0) {
      const w = Math.round(node.box.width);
      const h = Math.round(node.box.height);
      if (w < MIN_TAP_TARGET || h < MIN_TAP_TARGET) {
        findings.push({
          rule: "tap_target",
          severity: "warning",
          nodeId: node.id,
          message: `"${data?.name ?? node.id}" measures ${w}x${h}px. A touch target needs ${MIN_TAP_TARGET}x${MIN_TAP_TARGET}px.`,
          fix: `Grow the frame, or add padding so the hit area reaches ${MIN_TAP_TARGET}px while the icon stays its current size.`
        });
      }
    }
    for (const child of node.children) walk(child);
  }

  for (const root of tree) walk(root);
  return findings;
}

/**
 * Discipline checks. A designed screen reuses a small set of values; a
 * generated one invents a new number every time it needs one. These count
 * distinct values per screen rather than judging any single node.
 */
function checkScaleDiscipline(root: LayoutNode, map: Map<string, PenNode>): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const fontSizes = new Set<number>();
  const spacings = new Set<number>();
  const radii = new Set<number>();
  const offGrid = new Set<number>();
  const belowStandard: number[] = [];

  function walk(node: LayoutNode) {
    const data = map.get(node.id);
    if (data?.enabled === false) return;
    if (!data) {
      for (const child of node.children) walk(child);
      return;
    }
    if (data.type === "text" && typeof (data as TextNode).fontSize === "number") {
      const size = (data as TextNode).fontSize!;
      fontSizes.add(size);
      if (size >= HARD_MIN_FONT_SIZE && size < MIN_FONT_SIZE) belowStandard.push(size);
    }
    const frame = data as FrameNode;
    if (typeof frame.gap === "number" && frame.gap > 0) {
      spacings.add(frame.gap);
      if (frame.gap % 2 !== 0) offGrid.add(frame.gap);
    }
    const pad = frame.padding;
    const padValues = typeof pad === "number" ? [pad] : Array.isArray(pad) ? pad : [];
    for (const p of padValues) {
      if (typeof p === "number" && p > 0) {
        spacings.add(p);
        if (p % 2 !== 0) offGrid.add(p);
      }
    }
    const radius = data.cornerRadius;
    const radiusValues = typeof radius === "number" ? [radius] : Array.isArray(radius) ? radius : [];
    for (const rv of radiusValues) if (typeof rv === "number" && rv > 0 && rv < 9999) radii.add(rv);

    for (const child of node.children) walk(child);
  }
  walk(root);

  const name = map.get(root.id)?.name ?? root.id;

  if (belowStandard.length > 0) {
    findings.push({
      rule: "text_too_small",
      severity: "warning",
      nodeId: root.id,
      message: `"${name}" has ${belowStandard.length} text node${belowStandard.length === 1 ? "" : "s"} below ${MIN_FONT_SIZE}px (${[...new Set(belowStandard)].sort((a, b) => a - b).join(", ")}px).`,
      fix: `Raise them to ${MIN_FONT_SIZE}px. Captions and metadata sit at 11-12px; nothing sits below that.`
    });
  }
  if (fontSizes.size > 7) {
    findings.push({
      rule: "type_scale",
      severity: "warning",
      nodeId: root.id,
      message: `"${name}" uses ${fontSizes.size} distinct font sizes (${[...fontSizes].sort((a, b) => b - a).join(", ")}px). A type scale is 4-6 sizes.`,
      fix: "Collapse near-duplicates onto one scale: 28-34 title, 20-22 section, 15-17 list title, 13-14 body, 11-12 caption."
    });
  }
  // Measured across 24 runs: 90% of the spacing a run produces already sits on
  // the 4px grid, and most of the rest is 10 and 14 — ordinary design values.
  // Held to 4, this rule fired on nearly every screen and the model spent
  // correction turns on it, which is how a rule loses the authority to be
  // believed when it is right. An odd number has no such defence.
  if (offGrid.size > 0) {
    findings.push({
      rule: "spacing_scale",
      severity: "warning",
      nodeId: root.id,
      message: `"${name}" uses ${offGrid.size} odd spacing value${offGrid.size === 1 ? "" : "s"} (${[...offGrid].sort((a, b) => a - b).join(", ")}). Spacing steps are even.`,
      fix: "Round each one to the nearest even step. The scale runs 4, 8, 12, 16, 20, 24."
    });
  }

  // Too many distinct steps is the inconsistency the grid check was standing in
  // for, and it says so directly.
  if (spacings.size > 8) {
    findings.push({
      rule: "spacing_scale",
      severity: "warning",
      nodeId: root.id,
      message: `"${name}" uses ${spacings.size} distinct spacing values (${[...spacings].sort((a, b) => a - b).join(", ")}). A spacing scale has 5-6 steps.`,
      fix: "Collapse near-duplicates onto one scale: 4, 8, 12, 16, 20, 24."
    });
  }
  if (radii.size > 5) {
    findings.push({
      rule: "radius_scale",
      severity: "warning",
      nodeId: root.id,
      message: `"${name}" uses ${radii.size} distinct corner radii (${[...radii].sort((a, b) => a - b).join(", ")}). The shape scale has 5 steps.`,
      fix: "Map each radius onto the scale in the style guidelines."
    });
  }
  return findings;
}

const LITERAL_COLOR = /^#[0-9a-fA-F]{3,8}$/;
/** Not a bypass: these carry no brand decision and no theme to break. */
const UNIVERSAL_LITERALS = /^#(fff(f{0,5})?|ffffff[0-9a-f]{2}|000(0{0,5})?|000000[0-9a-f]{2})$/i;

/**
 * A literal hex where the document defines tokens means the screen will not
 * follow a theme change. Text over photography is exempt: white on an image
 * is a legitimate literal.
 */
function checkTokenBypass(doc: Document): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const variables = doc.variables;
  if (!variables || Object.keys(variables).length === 0) return findings;

  function walk(node: PenNode, underImage: boolean) {
    if (node.enabled === false) return;
    const nowUnderImage = underImage || overUnmeasurableBackground(node);
    if (!nowUnderImage) {
      for (const prop of ["fill", "stroke"] as const) {
        const value = (node as any)[prop];
        const literal =
          typeof value === "string" && LITERAL_COLOR.test(value)
            ? value
            : value && typeof value === "object" && (value as any).type === "color" && LITERAL_COLOR.test((value as any).color ?? "")
              ? (value as any).color
              : undefined;
        if (literal && !UNIVERSAL_LITERALS.test(literal)) {
          findings.push({
            rule: "token_bypass",
            severity: "warning",
            nodeId: node.id,
            message: `"${node.name ?? node.id}" sets ${prop}: "${literal}" directly while the document defines colour tokens.`,
            fix: `Replace with the token that carries this role ($surface-primary, $surface-secondary, $foreground-primary, $foreground-secondary, $foreground-muted, $border-subtle, $accent-primary, $accent-secondary).`
          });
        }
      }
    }
    for (const child of childrenOf(node)) walk(child, nowUnderImage);
  }

  doc.children.forEach((n) => walk(n, false));
  return findings;
}

/**
 * A screen owns its chrome: a status bar on mobile, a top bar on desktop.
 *
 * Read as status-bar-only, this skipped every desktop document, so the accent
 * rule, the nested-screen rule and the per-screen scale checks never ran on one
 * and the harness reported desktop runs as having no screens at all.
 *
 * A screen inside another screen means the second was built into the first
 * instead of onto the canvas; the outer frame then grows to the height of all
 * of them stacked, and neither reads as a device.
 */
/** The chrome that marks a frame as a screen: mobile status bar, desktop top bar. */
const SCREEN_CHROME_NAME = /(status|top) ?bar/i;

function isScreen(node: PenNode): boolean {
  if (node.type !== "frame") return false;
  // The chrome is not the screen. A bar holding something the model also called
  // a bar was otherwise read as a screen nested inside its own screen.
  if (SCREEN_CHROME_NAME.test(node.name ?? "")) return false;
  return childrenOf(node).some((c) => SCREEN_CHROME_NAME.test(c.name ?? ""));
}

const REGION_ROLES: { role: string; pattern: RegExp }[] = [
  { role: "status bar", pattern: /status ?bar/i },
  { role: "tab bar", pattern: /tab ?bar|bottom ?nav/i }
];

/**
 * A screen has one status bar and one tab bar. Two of either means the region
 * was inserted twice — usually once inside the screen tree and once again in a
 * later call. Both render, stacked, and the screen grows to hold them.
 */
function checkDuplicateRegions(doc: Document): AuditFinding[] {
  const findings: AuditFinding[] = [];

  function screensOf(node: PenNode, out: PenNode[]) {
    if (isScreen(node) && node.enabled !== false) out.push(node);
    for (const child of childrenOf(node)) screensOf(child, out);
  }
  const screens: PenNode[] = [];
  doc.children.forEach((n) => screensOf(n, screens));

  for (const screen of screens) {
    for (const { role, pattern } of REGION_ROLES) {
      const matches: PenNode[] = [];
      function collect(node: PenNode) {
        if (node.enabled === false) return;
        if (node !== screen && pattern.test(node.name ?? "")) matches.push(node);
        for (const child of childrenOf(node)) collect(child);
      }
      collect(screen);

      // A wrapper that only holds the real region is not a second region.
      const innermost = matches.filter(
        (m) => !matches.some((other) => other !== m && isDescendant(m, other))
      );
      if (innermost.length > 1) {
        findings.push({
          rule: "duplicate_region",
          severity: "blocker",
          nodeId: innermost[1].id,
          message: `Screen "${screen.name ?? screen.id}" has ${innermost.length} ${role}s (${innermost.map((m) => m.name ?? m.id).join(", ")}). They stack on top of each other.`,
          fix: `Delete the extra ${role} with delete_node. A screen has exactly one.`
        });
      }
    }
  }
  return findings;
}

/** True when `node` sits somewhere inside `ancestor`. */
function isDescendant(node: PenNode, ancestor: PenNode): boolean {
  for (const child of childrenOf(ancestor)) {
    if (child === node || isDescendant(node, child)) return true;
  }
  return false;
}

/**
 * One solid accent fill per screen.
 *
 * The prompt has asked for this since the rewrite and the measured runs put it
 * at eight across three screens. A rule the model reads and does not follow is
 * not guidance, it is decoration; this is the same rule with a number attached.
 * Accent on a text fill or an icon stroke is not counted — that is emphasis,
 * not a claim to be the primary action.
 */
function checkAccentOveruse(doc: Document): AuditFinding[] {
  const findings: AuditFinding[] = [];

  function countIn(node: PenNode, hits: PenNode[]): void {
    if (node.enabled === false) return;
    if (BACKGROUND_TYPES.has(node.type)) {
      const fill = (node as any).fill;
      const value = typeof fill === "string" ? fill : fill?.color ?? fill?.value;
      if (typeof value === "string" && /\$accent-primary\b/.test(value)) hits.push(node);
    }
    for (const child of childrenOf(node)) countIn(child, hits);
  }

  for (const root of doc.children) {
    if (!isScreen(root)) continue;
    const hits: PenNode[] = [];
    countIn(root, hits);
    if (hits.length <= 1) continue;
    findings.push({
      rule: "accent_overuse",
      severity: "warning",
      nodeId: root.id,
      message: `Screen "${root.name ?? root.id}" has ${hits.length} elements filled with $accent-primary (${hits.slice(0, 4).map((h) => h.name ?? h.id).join(", ")}${hits.length > 4 ? ", ..." : ""}). One element per screen carries it.`,
      fix: "Keep the accent fill on the primary action only. Everything else takes $surface-secondary, or the accent as a text or icon colour."
    });
  }

  return findings;
}

function checkNestedScreens(doc: Document): AuditFinding[] {
  const findings: AuditFinding[] = [];

  function walk(node: PenNode, outerScreen: PenNode | undefined) {
    if (node.enabled === false) return;
    const screenHere = isScreen(node);
    if (screenHere && outerScreen) {
      findings.push({
        rule: "nested_screen",
        severity: "blocker",
        nodeId: node.id,
        message: `"${node.name ?? node.id}" is a screen built inside the screen "${outerScreen.name ?? outerScreen.id}". The outer frame grows to hold both.`,
        fix: "Each screen is its own top-level frame on the canvas. Delete this node and insert it again with insert_node and no parentId."
      });
    }
    for (const child of childrenOf(node)) walk(child, screenHere ? node : outerScreen);
  }

  doc.children.forEach((n) => walk(n, undefined));
  return findings;
}

function checkEmptyContainers(doc: Document, map: Map<string, LayoutNode>): AuditFinding[] {
  const findings: AuditFinding[] = [];
  function walk(node: PenNode) {
    if (node.enabled === false) return;
    if (node.type === "frame") {
      const kids = childrenOf(node);
      // The resolved box, not the declared size. Read from `width` alone, a
      // frame set to fill_container measured 0 and could never trip this, so
      // the rule was blind to exactly the frames the model actually writes.
      const box = map.get(node.id)?.box;
      const w = box?.width ?? (typeof node.width === "number" ? node.width : 0);
      const h = box?.height ?? (typeof node.height === "number" ? node.height : 0);
      const decorative = /(spacer|divider|indicator|rule|line|dot|track|bar)/i.test(node.name ?? "");
      if (kids.length === 0 && !hasImageFill(node) && w > 80 && h > 80 && !decorative) {
        findings.push({
          rule: "empty_container",
          severity: "warning",
          nodeId: node.id,
          message: `Frame "${node.name ?? node.id}" renders ${Math.round(w)}x${Math.round(h)}px with no children and no image fill.`,
          fix: "Give it content, apply an image fill, or delete it. An empty box reads as an unfinished wireframe."
        });
      }
    }
    for (const child of childrenOf(node)) walk(child);
  }
  doc.children.forEach(walk);
  return findings;
}

const SEVERITY_OF: Record<FindingRule, "blocker" | "warning"> = {
  collision: "blocker",
  overflow: "blocker",
  unreadable_size: "blocker",
  off_canvas: "warning"
};

const RULE_OF: Record<FindingRule, AuditRule> = {
  collision: "collision",
  overflow: "clipped",
  unreadable_size: "text_too_small",
  off_canvas: "off_canvas"
};

const FIX_OF: Record<FindingRule, string> = {
  collision: "Put both nodes in a frame with layout: 'vertical' or 'horizontal' and a gap, instead of positioning them by hand.",
  overflow:
    "The child does not fit. Either set the child's width to 'fill_container' so it wraps inside the parent, or let the parent size to its content with height: 'fit_content'. Do not clip.",
  unreadable_size: `Raise to at least ${MIN_FONT_SIZE}px.`,
  off_canvas: "Move the frame to positive coordinates."
};

/**
 * A row of chips that is wider than its container cannot be fixed by making it
 * fill the container — it is already too wide. Say what will actually work.
 */
function overflowFix(node: PenNode | undefined): string {
  if (node && node.type === "frame" && (node as FrameNode).layout === "horizontal") {
    return (
      "This row is wider than the space it has. Content does not wrap onto a " +
      "second line, so widening it will not help: remove an item, shorten the " +
      "labels, or reduce the gap and padding. If the items must all stay, put " +
      "them in a vertical stack instead."
    );
  }
  return FIX_OF.overflow;
}

/**
 * Run every rule. `targetId` scopes the result to that node's subtree —
 * a finding about a descendant is a finding about the target, which is the
 * whole point of asking about a frame.
 */
export function auditDesign(
  tree: LayoutNode[],
  doc: Document,
  targetId?: string
): AuditFinding[] {
  const map = indexDocument(doc);
  const boxes = flattenLayoutTree(tree);

  const findings: AuditFinding[] = [
    ...evaluateLayoutConstraints(tree, doc).map((f) => ({
      rule: RULE_OF[f.rule],
      severity: SEVERITY_OF[f.rule],
      nodeId: f.nodeId,
      message: f.message,
      fix: f.rule === "overflow" ? overflowFix(map.get(f.nodeId)) : FIX_OF[f.rule]
    })),
    ...checkContrast(tree, doc, map),
    ...checkTextClipping(tree, doc, map),
    ...checkTapTargets(tree, map),
    ...checkEmptyContainers(doc, boxes),
    ...checkNestedScreens(doc),
    ...checkDuplicateRegions(doc),
    ...checkAccentOveruse(doc),
    ...checkTokenBypass(doc)
  ];

  for (const root of tree) {
    findings.push(...checkScaleDiscipline(root, map));
  }

  if (!targetId) return dedupe(findings);

  const scope = collectSubtreeIds(doc, targetId);
  if (!scope) return dedupe(findings);
  return dedupe(findings.filter((f) => scope.has(f.nodeId)));
}

function dedupe(findings: AuditFinding[]): AuditFinding[] {
  const seen = new Set<string>();
  const out: AuditFinding[] = [];
  for (const f of findings) {
    const key = `${f.rule}|${f.nodeId}|${f.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  const order = { blocker: 0, warning: 1 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Render an audit for a model to read. Reports state, never a score. */
export function formatAudit(findings: AuditFinding[], label: string): string {
  if (findings.length === 0) {
    return `${label}: no findings. Every rule ran and none matched.`;
  }
  const blockers = findings.filter((f) => f.severity === "blocker");
  const warnings = findings.filter((f) => f.severity === "warning");
  const lines = [
    `${label}: ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`
  ];
  for (const f of findings) {
    lines.push(`[${f.severity}] ${f.rule} ${f.nodeId}: ${f.message}`);
    lines.push(`  fix: ${f.fix}`);
  }
  return lines.join("\n");
}

/**
 * Audit a document as it will actually render.
 *
 * Instances have to be expanded first. Called with a raw document, every
 * `{ type: "ref" }` lays out as a 0x0 box, so a screen built the way the craft
 * rules ask — one component, many instances — measured as a screen full of
 * nothing. The canvas and the renderer both resolved; only the agent's own
 * eyes did not, which taught it that components break the design.
 *
 * Prefer this over calling auditDesign with a hand-built tree.
 */
export function auditDocument(doc: Document, targetId?: string): AuditFinding[] {
  const resolved = resolveInstances(doc);
  return auditDesign(layoutResolvedDocument(resolved), resolved, targetId);
}
