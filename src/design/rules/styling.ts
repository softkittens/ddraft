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
  walkEnabled,
  isScreen,
  childrenOf,
  BACKGROUND_TYPES,
  UNIVERSAL_LITERALS,
  ACCENT_TOKEN
} from "../helpers";

export function checkContrast(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  function walk(node: LayoutNode, inheritedBg: string | undefined, unmeasurable: boolean) {
    const data = ctx.nodes.get(node.id);
    if (data?.enabled === false) return;
    const ownFill = solidFillOf(data);
    const bg = ownFill ?? inheritedBg;
    const nowUnmeasurable = unmeasurable || overUnmeasurableBackground(data);

    if (data?.type === "text" && !nowUnmeasurable) {
      const text = data as TextNode;
      const ratio = contrastRatio(
        typeof text.fill === "string" ? text.fill : undefined,
        bg,
        ctx.doc.variables
      );
      if (ratio !== null) {
        const size = text.fontSize ?? 16;
        const bold = text.fontWeight === "bold" || Number(text.fontWeight) >= 700;
        const isLarge = size >= 24 || (size >= 18.66 && bold);
        const required = isLarge ? 3 : 4.5;
        if (ratio < required) {
          findings.push(
            blocker(
              "low_contrast",
              node.id,
              `Text "${(text.content ?? "").slice(0, 32)}" at ${size}px measures ${ratio.toFixed(2)}:1 against its background (${resolveVariable(text.fill as string, ctx.doc.variables)} on ${resolveVariable(bg, ctx.doc.variables)}). ${required}:1 is required.`,
              "Use $foreground-primary or $foreground-secondary on $surface-primary / $surface-secondary. $foreground-muted is only for text at 11-12px that is genuinely tertiary."
            )
          );
        }
      }
    }

    for (const child of node.children) walk(child, bg, nowUnmeasurable);
  }

  for (const root of ctx.tree) walk(root, solidFillOf(ctx.nodes.get(root.id)), false);
  return findings;
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
                `"${node.name ?? node.id}" sets ${prop}: "${literal}" directly while the document defines colour tokens.`,
                "Replace with the token that carries this role ($surface-primary, $surface-secondary, $foreground-primary, $foreground-secondary, $foreground-muted, $border-subtle, $accent-primary, $accent-secondary)."
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

export function checkAccentOveruse(ctx: AuditContext): AuditFinding[] {
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

  for (const root of ctx.doc.children) {
    if (!isScreen(root)) continue;
    const hits: PenNode[] = [];
    countIn(root, hits);
    if (hits.length <= 1) continue;
    findings.push(
      warning(
        "accent_overuse",
        root.id,
        `Screen "${root.name ?? root.id}" has ${hits.length} elements filled with $accent-primary (${hits.slice(0, 4).map((h) => h.name ?? h.id).join(", ")}${hits.length > 4 ? ", ..." : ""}). One element per screen carries it.`,
        "Keep the accent fill on the primary action only. Everything else takes $surface-secondary, or the accent as a text or icon colour."
      )
    );
  }

  return findings;
}

function shadowsOf(node: PenNode): { x: number; y: number; blur: number }[] {
  const raw = node.effect;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .filter((e: any) => e && e.enabled !== false && (e.type === "shadow" || e.type === "inner_shadow"))
    .map((e: any) => ({ x: e.x ?? 0, y: e.y ?? 0, blur: e.blur ?? 0 }));
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
