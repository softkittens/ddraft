import type { LayoutNode } from "../../layout/types";
import type { TextNode, FrameNode } from "../../model/types";
import { measureTextWidth } from "../../layout/text";
import {
  type AuditFinding,
  type AuditContext,
  blocker,
  warning,
  info,
  walkEnabled
} from "../helpers";
import { HARD_MIN_FONT_SIZE, MIN_FONT_SIZE } from "./constraints";

export function checkTextClipping(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  function walk(node: LayoutNode) {
    const data = ctx.nodes.get(node.id);
    if (data?.enabled === false) return;
    if (data?.type === "text") {
      const text = data as TextNode;
      const content = text.content ?? "";
      if (!content.trim()) {
        findings.push(
          blocker(
            "empty_text",
            node.id,
            `Text node "${text.name ?? node.id}" has no content, so it renders as nothing.`,
            "Set the copy on the `content` property. The engine reads `content`, not `text` or `label`."
          )
        );
      }
      const wraps = text.textGrowth === "fixed-width" || text.textGrowth === "fixed-width-height";
      if (content && !wraps && node.box.width > 0) {
        const intrinsic = measureTextWidth(
          content,
          text.fontSize ?? 16,
          text.fontFamily ?? "Inter",
          text.fontWeight,
          text.letterSpacing ?? 0,
          ctx.doc.variables
        );
        if (intrinsic > node.box.width + 1) {
          findings.push(
            blocker(
              "text_clipped",
              node.id,
              `"${content.slice(0, 40)}${content.length > 40 ? "…" : ""}" needs ${Math.round(intrinsic)}px on one line but its box is ${Math.round(node.box.width)}px. It will be cut off.`,
              "Set textGrowth: 'fixed-width' so the text wraps, together with width: 'fill_container'. Text only wraps when textGrowth says it may."
            )
          );
        }
      }
    }
    for (const child of node.children) walk(child);
  }
  for (const root of ctx.tree) walk(root);
  return findings;
}

const TIGHT_TRACKING = -0.04;
const CAPS_TRACKING = 0.06;

export function checkTracking(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    if (node.type === "text") {
      const text = node as TextNode;
      const size = text.fontSize;
      const content = text.content ?? "";
      const tracking = text.letterSpacing ?? 0;
      const capitals = (content.match(/[A-Z]/g) ?? []).length;

      if (typeof size === "number" && size > 0) {
        if (tracking < TIGHT_TRACKING * size) {
          findings.push(
            warning(
              "tracking",
              node.id,
              `"${node.name ?? node.id}" sets letterSpacing ${tracking} on ${size}px text, tighter than the ${TIGHT_TRACKING * 100}% floor.`,
              `Raise letterSpacing to ${(TIGHT_TRACKING * size).toFixed(2)} or above. Tight tracking is a display effect and it still has a floor.`
            )
          );
        } else if (
          capitals >= 3 &&
          content === content.toUpperCase() &&
          content !== content.toLowerCase() &&
          tracking < CAPS_TRACKING * size
        ) {
          findings.push(
            warning(
              "tracking",
              node.id,
              `"${node.name ?? node.id}" is set in capitals at ${size}px with letterSpacing ${tracking}. Capitals need opening up.`,
              `Set letterSpacing to ${(CAPS_TRACKING * size).toFixed(2)} or above, or write the label in sentence case.`
            )
          );
        }
      }
    }
  });
  return findings;
}

const MAX_MEASURE = 85;
const PROSE_LENGTH = 120;

export function checkProseMeasure(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const laid of ctx.boxes.values()) {
    const node = ctx.nodes.get(laid.id);
    if (!node || node.enabled === false || node.type !== "text") continue;

    const text = node as TextNode;
    const content = text.content ?? "";
    const size = text.fontSize ?? 0;
    if (content.length < PROSE_LENGTH || size <= 0 || size > 20) continue;

    const width = laid.box.width;
    if (width <= 0) continue;

    const drawn = measureTextWidth(
      content,
      size,
      text.fontFamily ?? "$font-body",
      text.fontWeight ?? 400,
      text.letterSpacing ?? 0,
      ctx.doc.variables
    );
    const perCharacter = drawn / content.length;
    if (perCharacter <= 0) continue;

    const measure = Math.round(width / perCharacter);
    if (measure <= MAX_MEASURE) continue;

    findings.push(
      warning(
        "prose_measure",
        node.id,
        `"${node.name ?? node.id}" sets ${content.length} characters of body copy ${Math.round(width)}pt wide — about ${measure} characters a line, against a comfortable 65-75.`,
        `Give it a maximum width near ${Math.round(perCharacter * 72)}pt with width: 'fit_content(${Math.round(perCharacter * 72)})', or move it into a narrower column.`
      )
    );
  }
  return findings;
}

export function checkScaleDiscipline(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const root of ctx.tree) {
    const fontSizes = new Set<number>();
    const spacings = new Set<number>();
    const radii = new Set<number>();
    const offGrid = new Set<number>();
    const belowStandard: { id: string; name?: string; size: number }[] = [];

    function walk(node: LayoutNode) {
      const data = ctx.nodes.get(node.id);
      if (data?.enabled === false) return;
      if (!data) {
        for (const child of node.children) walk(child);
        return;
      }
      if (data.type === "text" && typeof (data as TextNode).fontSize === "number") {
        const size = (data as TextNode).fontSize!;
        fontSizes.add(size);
        if (size >= HARD_MIN_FONT_SIZE && size < MIN_FONT_SIZE) {
          belowStandard.push({ id: data.id, name: data.name, size });
        }
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

    const name = ctx.nodes.get(root.id)?.name ?? root.id;

    for (const item of belowStandard) {
      findings.push(
        warning(
          "text_too_small",
          item.id,
          `"${item.name ?? item.id}" has fontSize ${item.size}px, below the ${MIN_FONT_SIZE}px design standard.`,
          `Raise it to ${MIN_FONT_SIZE}px. Captions and metadata sit at 11-12px; nothing sits below that.`
        )
      );
    }
    if (fontSizes.size > 7) {
      findings.push(
        info(
          "type_scale",
          root.id,
          `"${name}" uses ${fontSizes.size} distinct font sizes (${[...fontSizes].sort((a, b) => b - a).join(", ")}px). A type scale is 4-6 sizes.`,
          "Collapse near-duplicates onto one scale: 44-64 display, 28-34 title, 20-22 section, 15-17 list title, 13-14 body, 11-12 caption."
        )
      );
    }
    if (offGrid.size > 0) {
      findings.push(
        info(
          "spacing_scale",
          root.id,
          `"${name}" uses ${offGrid.size} odd spacing value${offGrid.size === 1 ? "" : "s"} (${[...offGrid].sort((a, b) => a - b).join(", ")}). Spacing steps are even.`,
          "Round each one to the nearest even step. The scale runs 4, 8, 12, 16, 20, 24."
        )
      );
    }
    if (spacings.size > 8) {
      findings.push(
        info(
          "spacing_scale",
          root.id,
          `"${name}" uses ${spacings.size} distinct spacing values (${[...spacings].sort((a, b) => a - b).join(", ")}). A spacing scale has 5-6 steps.`,
          "Collapse near-duplicates onto one scale: 4, 8, 12, 16, 20, 24."
        )
      );
    }
    if (radii.size > 5) {
      findings.push(
        info(
          "radius_scale",
          root.id,
          `"${name}" uses ${radii.size} distinct corner radii (${[...radii].sort((a, b) => a - b).join(", ")}). The shape scale has 5 steps.`,
          "Map each radius onto the scale in the style guidelines."
        )
      );
    }
  }

  return findings;
}
