import type { LayoutNode } from "../../layout/types";
import type { TextNode, PenNode } from "../../model/types";
import { resolveVariable } from "../../model/variables";
import { STYLE_METADATA_KEY, HARD_SHADOW_ELEVATION } from "../styleKeys";
import {
  type AuditFinding,
  type AuditContext,
  blocker,
  warning,
  solidFillOf,
  overUnmeasurableBackground,
  contrastRatio,
  extractHexColors,
  parseHexColor,
  getRelativeLuminance,
  walkEnabled,
  isScreen,
  childrenOf,
  BACKGROUND_TYPES,
  UNIVERSAL_LITERALS,
  INTERACTIVE_NAME,
  ACCENT_TOKEN
} from "../helpers";

export function checkContrast(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  function walk(
    node: LayoutNode,
    inheritedBg: string | undefined,
    unmeasurable: boolean,
    parentNode?: PenNode
  ) {
    const data = ctx.nodes.get(node.id);
    if (data?.enabled === false) return;
    const ownFill = solidFillOf(data);
    const bg = ownFill ?? inheritedBg;
    // If this node has its own solid fill, reset unmeasurable so text on solid cards is evaluated
    const nowUnmeasurable = ownFill ? false : (unmeasurable || overUnmeasurableBackground(data));

    if (data?.type === "text" && !nowUnmeasurable) {
      const text = data as TextNode;
      const textFill = (typeof text.fill === "string" ? text.fill : undefined) ?? "$foreground-primary";
      const effectiveBg = bg ?? "$surface-primary";
      const ratio = contrastRatio(
        textFill,
        effectiveBg,
        ctx.doc.variables
      );
      if (ratio !== null) {
        const size = text.fontSize ?? 16;
        const bold = text.fontWeight === "bold" || Number(text.fontWeight) >= 600;
        const isInteractive = Boolean(
          parentNode && (
            INTERACTIVE_NAME.test(parentNode.name ?? "") ||
            /button|btn|cta|chip|pill|action/i.test(parentNode.name ?? "") ||
            (parentNode as any).metadata?.scaffold === "chrome"
          )
        );
        const isLarge = size >= 24 || (size >= 18.66 && bold) || (isInteractive && size >= 13 && bold);
        const required = isLarge ? 3 : 4.5;

        const bgHex = parseHexColor(resolveVariable(effectiveBg, ctx.doc.variables));
        const fgHex = parseHexColor(resolveVariable(textFill, ctx.doc.variables));
        if (bgHex && fgHex) {
          const bgLum = getRelativeLuminance(bgHex);
          const fgLum = getRelativeLuminance(fgHex);
          // Dark text on mid-tone or dark colored action buttons/pills (e.g. dark text on olive green or terracotta)
          if (bgLum < 0.45 && fgLum < 0.25 && isInteractive) {
            findings.push(
              blocker(
                "low_contrast",
                node.id,
                `Action button/pill "${(text.content ?? "").slice(0, 32)}" has dark text on a colored surface (${resolveVariable(textFill, ctx.doc.variables)} on ${resolveVariable(effectiveBg, ctx.doc.variables)}). Solid colored buttons require white/light text ($surface-primary or #FFFFFF) for clean legibility.`,
                "Set text fill to $surface-primary or #FFFFFF for clean legibility on solid colored buttons."
              )
            );
          }
        }

        if (ratio < required) {
          findings.push(
            blocker(
              "low_contrast",
              node.id,
              `Text "${(text.content ?? "").slice(0, 32)}" at ${size}px measures ${ratio.toFixed(2)}:1 against its background (${resolveVariable(textFill, ctx.doc.variables)} on ${resolveVariable(effectiveBg, ctx.doc.variables)}). ${required}:1 is required.`,
              "Use $foreground-primary or $foreground-secondary on $surface-primary / $surface-secondary, or $surface-primary on dark/accent surfaces."
            )
          );
        }
      }
    }

    for (const child of node.children) walk(child, bg, nowUnmeasurable, data);
  }

  for (const root of ctx.tree) {
    const rootData = ctx.nodes.get(root.id);
    const rootFill = solidFillOf(rootData);
    walk(root, rootFill, overUnmeasurableBackground(rootData), undefined);
  }
  return findings;
}

/**
 * Name the status token when the literal is obviously reaching for one.
 *
 * Almost every raw hex in the logs is a state colour the vocabulary could not
 * express: one run alone carries eleven `#4ADE80` dots meaning "online". Now
 * that $status-ok exists, saying so turns a generic scolding into the one
 * substitution the model was looking for.
 */
function statusHint(literal: string): string {
  const rgb = parseHexColor(literal);
  if (!rgb) return "";
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 40) return "";
  let hue: number;
  if (max === r) hue = (((g - b) / (max - min)) % 6 + 6) % 6 * 60;
  else if (max === g) hue = ((b - r) / (max - min) + 2) * 60;
  else hue = ((r - g) / (max - min) + 4) * 60;
  if (hue >= 95 && hue <= 175) return " This reads as a success/online colour — $status-ok carries that.";
  if (hue >= 25 && hue < 70) return " This reads as a warning colour — $status-warn carries that.";
  if (hue >= 340 || hue < 20) return " This reads as a fault colour — $status-fault carries that.";
  return "";
}

export function checkTokenBypass(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const variables = ctx.doc.variables;
  if (!variables || Object.keys(variables).length === 0) return findings;

  function walk(node: PenNode, underImage: boolean) {
    if (node.enabled === false) return;
    if (!underImage) {
      for (const prop of ["fill", "stroke"] as const) {
        const hexes = extractHexColors((node as any)[prop]);
        for (const literal of hexes) {
          if (!UNIVERSAL_LITERALS.test(literal)) {
            findings.push(
              warning(
                "token_bypass",
                node.id,
                `"${node.name ?? node.id}" sets ${prop}: "${literal}" directly while the document defines colour tokens.${statusHint(literal)}`,
                "Replace with the token that carries this role ($surface-primary, $surface-secondary, $foreground-primary, $foreground-secondary, $foreground-muted, $border-subtle, $accent-primary, $accent-secondary, $status-ok, $status-warn, $status-fault)."
              )
            );
          }
        }
      }
    }
    const nextUnderImage = underImage || overUnmeasurableBackground(node);
    for (const child of childrenOf(node)) walk(child, nextUnderImage);
  }

  ctx.doc.children.forEach((n) => walk(n, false));
  return findings;
}

/**
 * How many distinct jobs the accent is doing, not how many nodes wear it.
 *
 * Rule 3 asks for the accent in at most two visible roles per screen. This
 * check counted elements instead, so a chart with eight bars was eight
 * violations of a two-role budget, and any dashboard tripped it by existing:
 * 18 of the logged runs carry the warning, most of them for a data series plus
 * a status dot plus the active nav item — three nodes doing two jobs.
 *
 * Counting by parent fixes the unit. Siblings under one parent are one role,
 * because that is what a role is: a series, a set of dots, a row of tabs. The
 * cost of the old count was not the noise, it was the direction — it told
 * every design to remove colour, and a telemetry dashboard whose data carries
 * no colour is the one thing our screens keep losing on.
 */
/** Rule 3's budget: the accent may do two jobs on a screen, not one. */
const MAX_ACCENT_ROLES = 2;

export function checkAccentOveruse(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  function countIn(node: PenNode, parentId: string, roles: Map<string, PenNode[]>): void {
    if (node.enabled === false) return;
    if (BACKGROUND_TYPES.has(node.type)) {
      const fill = (node as any).fill;
      const value = typeof fill === "string" ? fill : fill?.color ?? fill?.value;
      if (typeof value === "string" && /\$accent-primary\b/.test(value)) {
        roles.set(parentId, [...(roles.get(parentId) ?? []), node]);
      }
    }
    for (const child of childrenOf(node)) countIn(child, node.id, roles);
  }

  for (const root of ctx.doc.children) {
    if (!isScreen(root)) continue;
    const roles = new Map<string, PenNode[]>();
    countIn(root, root.id, roles);
    if (roles.size <= MAX_ACCENT_ROLES) continue;
    const named = [...roles.values()].map((group) =>
      group.length > 1
        ? `${group[0].name ?? group[0].id} +${group.length - 1} more`
        : (group[0].name ?? group[0].id)
    );
    findings.push(
      warning(
        "accent_overuse",
        root.id,
        `Screen "${root.name ?? root.id}" puts $accent-primary in ${roles.size} separate roles (${named.slice(0, 4).join(", ")}${named.length > 4 ? ", ..." : ""}). At most ${MAX_ACCENT_ROLES} carry it.`,
        `Pick the ${MAX_ACCENT_ROLES} that mean the most — usually the primary action and the live data series — and give the rest $surface-secondary, or the accent as a text or icon colour rather than a fill.`
      )
    );
  }

  return findings;
}

function shadowsOf(node: PenNode): { x: number; y: number; blur: number }[] {
  const raw = node.effect;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .filter((e: any) => e && e.enabled !== false && (e.type === "shadow" || e.type === "inner_shadow" || e.shadowType !== undefined || e.offset !== undefined))
    .map((e: any) => ({
      x: e.x ?? e.offset?.x ?? 0,
      y: e.y ?? e.offset?.y ?? 0,
      blur: e.blur ?? e.radius ?? 0
    }));
}

export function checkShadowQuality(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const chosen = (ctx.doc.metadata?.[STYLE_METADATA_KEY] as { elevation?: string } | undefined)?.elevation;
  const blockAllowed = chosen === HARD_SHADOW_ELEVATION;

  walkEnabled(ctx.doc.children, (node) => {
    for (const s of shadowsOf(node)) {
      if (s.blur > 0) continue;
      const offset = Math.abs(s.x) + Math.abs(s.y);
      if (offset === 0) {
        findings.push(
          warning(
            "shadow_quality",
            node.id,
            `"${node.name ?? node.id}" has a shadow with no offset and no blur. That is a coloured halo, not depth.`,
            "Give it an offset and a soft blur, or drop the effect and separate with stroke: '$border-subtle'."
          )
        );
      } else if (!blockAllowed) {
        findings.push(
          warning(
            "shadow_quality",
            node.id,
            `"${node.name ?? node.id}" has a hard block shadow (${s.x}, ${s.y}, blur 0). That belongs to a world built on it, and this document chose a different elevation.`,
            `Blur the shadow to match the chosen elevation, or call set_style with elevation: '${HARD_SHADOW_ELEVATION}' and commit the whole screen to it.`
          )
        );
      }
      break;
    }
  });

  return findings;
}

function loneStroke(node: PenNode): { side: string; width: number } | undefined {
  const sw = node.strokeWidth;
  if (!sw || typeof sw !== "object" || Array.isArray(sw)) return undefined;
  const sides = ["top", "right", "bottom", "left"] as const;
  const set = sides.filter((s) => typeof (sw as any)[s] === "number" && (sw as any)[s] > 0);
  if (set.length !== 1) return undefined;
  return { side: set[0], width: (sw as any)[set[0]] as number };
}

export function checkBorderAccent(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  walkEnabled(ctx.doc.children, (node) => {
    const edge = loneStroke(node);
    const radius = node.cornerRadius;
    const rounded = typeof radius === "number"
      ? radius > 0
      : Array.isArray(radius) && radius.some((v) => typeof v === "number" && v > 0);
    const strokeValue = typeof node.stroke === "string" ? node.stroke : (node.stroke as any)?.color;

    if (
      edge &&
      (edge.side === "left" || edge.side === "right") &&
      edge.width > 1 &&
      rounded &&
      typeof strokeValue === "string" &&
      ACCENT_TOKEN.test(strokeValue)
    ) {
      findings.push(
        warning(
          "border_accent",
          node.id,
          `"${node.name ?? node.id}" is a rounded surface with a ${edge.width}px accent border on the ${edge.side}. That shape is the stock AI dashboard tile.`,
          "Drop either the radius or the accent border. Carry the state with the value's own weight, a small indicator, or the row's background."
        )
      );
    }
  });

  return findings;
}

export function checkSingleElevation(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "frame") return;
    const hasShadow = shadowsOf(node).length > 0;
    const hasStroke = Boolean(
      node.stroke &&
      (typeof node.strokeWidth === "number"
        ? node.strokeWidth > 0
        : typeof node.strokeWidth === "object" &&
          Object.values(node.strokeWidth).some((w) => typeof w === "number" && w > 0))
    );

    if (hasShadow && hasStroke) {
      findings.push(
        warning(
          "single_elevation",
          node.id,
          `"${node.name ?? node.id}" sets both a stroke border and a shadow effect. That is a ghost card — declare elevation once.`,
          "Choose either a subtle border (stroke: '$border-subtle') or a soft elevation shadow, not both on the same container."
        )
      );
    }
  });

  return findings;
}
