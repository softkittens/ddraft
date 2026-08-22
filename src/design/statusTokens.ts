import { parseHexColor, getRelativeLuminance } from "./helpers";
import type { PaletteTokens, Scheme } from "./styleSystem";

/**
 * The status colours, derived from each palette rather than authored into it.
 *
 * A telemetry screen has three states — running, waiting, faulted — and the
 * eight-token vocabulary had no way to say any of them. One logged run shows
 * the squeeze exactly: the model put its twelve unit-status dots on
 * $accent-primary and drew an accent_overuse warning naming all twelve, then
 * retokenized them to a raw #4ADE80 and drew eleven token_bypass warnings for
 * the same dots. Both warnings were correct. Neither had an answer, because
 * the answer was a token that did not exist.
 *
 * Derived, not authored, for two reasons. There are 58 palettes and three more
 * hand-picked hex values each is 174 decisions nobody will keep consistent;
 * and a status green that is the same green in Warm Linen and in Obsidian is a
 * sticker rather than part of the system. What is fixed here is the meaning —
 * green reads as good in every palette — and what is derived is everything
 * that makes it belong: how saturated, how light, and how far it has to move
 * to stay legible on that palette's cards.
 */

export type StatusRole = "status-ok" | "status-warn" | "status-fault";

/**
 * Where each meaning sits on the wheel, and how far it may be pushed.
 *
 * The hues are the conventional ones, and they are conventional because they
 * are legible without a legend. The tolerance is how far each may rotate to
 * separate from a palette whose accent is already sitting there: green survives
 * a wider shift than red, which stops reading as danger by the time it reaches
 * orange.
 */
const STATUS_HUES: Record<StatusRole, { hue: number; drift: number }> = {
  "status-ok": { hue: 145, drift: 18 },
  "status-warn": { hue: 42, drift: 10 },
  "status-fault": { hue: 8, drift: 8 }
};

/** Small bold labels — WARN, MAINT, 92% — are the hardest case these carry. */
const TARGET_CONTRAST = 4.5;

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] :
    hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r1)}${to(g1)}${to(b1)}`.toUpperCase();
}

function ratio(a: string, b: string): number {
  const ca = parseHexColor(a), cb = parseHexColor(b);
  if (!ca || !cb) return 0;
  const la = getRelativeLuminance(ca), lb = getRelativeLuminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The shortest way around the wheel between two hues. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Rotate a status hue clear of the palette's accent, within its tolerance.
 *
 * A palette whose accent is already a green — Warm Linen's is #4F6B3B — would
 * otherwise hand back a $status-ok the eye cannot tell from the primary action,
 * and a dashboard where "online" and "the button" are the same colour has lost
 * both meanings.
 */
function separateFromAccent(hue: number, drift: number, accentHue: number | null): number {
  if (accentHue === null) return hue;
  const gap = hueGap(hue, accentHue);
  if (gap >= 30) return hue;
  const away = Math.min(drift, 30 - gap);
  const forward = hueGap(hue + away, accentHue);
  const back = hueGap(hue - away, accentHue);
  return forward >= back ? hue + away : hue - away;
}

/**
 * Walk lightness outward from where the scheme naturally puts it and stop at
 * the first step that is legible.
 *
 * Outward rather than straight to the extreme: the most contrasting green
 * against a dark card is nearly white, which is legible and no longer green.
 * The first passing step keeps as much of the hue as the contrast allows.
 */
function legibleLightness(hue: number, sat: number, against: string, scheme: Scheme): number {
  // Start a fixed distance from the card rather than at a fixed lightness.
  // Anchoring to a constant made every dark palette hand back the same green:
  // contrast climbs fast on a dark ground, so the first passing step was the
  // first step for all of them, and Carbon Frost, Amber Night and Agentic
  // shared one #49F390. Offsetting from the card keeps the separation the
  // palette actually needs and lets a near-black ground go lighter than a
  // charcoal one.
  const card = hexToHsl(against)?.l ?? (scheme === "dark" ? 0.14 : 0.94);
  const start = scheme === "dark"
    ? Math.min(0.82, Math.max(0.44, card + 0.34))
    : Math.max(0.20, Math.min(0.58, card - 0.46));
  const direction = scheme === "dark" ? 0.02 : -0.02;
  let best = start;
  let bestRatio = 0;
  for (let step = 0; step <= 22; step += 1) {
    const l = Math.min(0.94, Math.max(0.16, start + direction * step));
    const r = ratio(hslToHex(hue, sat, l), against);
    if (r >= TARGET_CONTRAST) return l;
    if (r > bestRatio) { bestRatio = r; best = l; }
  }
  return best;
}

/**
 * Three status colours for one palette.
 *
 * Saturation is borrowed from the palette's own accents so the result carries
 * its character: a muted editorial palette gets muted status colours and a
 * neon one gets neon, rather than every design on the canvas sharing one
 * imported traffic-light set. The floor of 0.45 is where a hue stops being
 * identifiable as a hue at small sizes, which is the size these are used at.
 */
export function deriveStatusTokens(
  tokens: PaletteTokens,
  scheme: Scheme
): Record<StatusRole, string> {
  const accent = hexToHsl(tokens["accent-primary"]);
  const secondary = hexToHsl(tokens["accent-secondary"]);
  const character = Math.max(accent?.s ?? 0, secondary?.s ?? 0);
  const sat = Math.min(0.92, Math.max(0.45, character));
  const card = tokens["surface-secondary"];

  const out = {} as Record<StatusRole, string>;
  for (const [role, spec] of Object.entries(STATUS_HUES) as [StatusRole, { hue: number; drift: number }][]) {
    const hue = separateFromAccent(spec.hue, spec.drift, accent?.h ?? null);
    out[role] = hslToHex(hue, sat, legibleLightness(hue, sat, card, scheme));
  }
  return out;
}
