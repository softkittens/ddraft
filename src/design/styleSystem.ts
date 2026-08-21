/**
 * The style system the agent chooses from before it designs anything.
 *
 * The point of this module is separation. A design has three independent
 * inputs: a visual system (colour, shape, depth, type), composition rules
 * (how a screen is built), and product content (what the app is). Fusing
 * them into one prompt means the product content is fixed, and the agent
 * transcribes instead of designing. Here the visual system is chosen per
 * run, the composition rules live in the prompt, and the content comes
 * only from the user's brief.
 */

export type Scheme = "light" | "dark";

/** The eight semantic colour roles every palette must define. */
export interface PaletteTokens {
  "surface-primary": string;
  "surface-secondary": string;
  "foreground-primary": string;
  "foreground-secondary": string;
  "foreground-muted": string;
  "border-subtle": string;
  "accent-primary": string;
  "accent-secondary": string;
}

export interface Palette {
  name: string;
  scheme: Scheme;
  /** One line the model reads when it picks. Describes feel, not usage. */
  mood: string;
  tokens: PaletteTokens;
}

export const PALETTES: Palette[] = [
  {
    name: "Warm Linen",
    scheme: "light",
    mood: "Paper-warm neutrals with a dry olive accent. Editorial, unhurried, analogue.",
    tokens: {
      "surface-primary": "#FAF7F2",
      "surface-secondary": "#F1ECE3",
      "foreground-primary": "#1F1B16",
      "foreground-secondary": "#57503F",
      "foreground-muted": "#8A8170",
      "border-subtle": "#E2DBCE",
      "accent-primary": "#4F6B3B",
      "accent-secondary": "#C2703D"
    }
  },
  {
    name: "Minimal Ink",
    scheme: "light",
    mood: "Achromatic and exact. Black on white, one accent of pure ink. Swiss, quiet, confident.",
    tokens: {
      "surface-primary": "#FFFFFF",
      "surface-secondary": "#F4F4F5",
      "foreground-primary": "#09090B",
      "foreground-secondary": "#52525B",
      "foreground-muted": "#7E7E87",
      "border-subtle": "#E4E4E7",
      "accent-primary": "#18181B",
      "accent-secondary": "#C2410C"
    }
  },
  {
    name: "Spring Meadow",
    scheme: "light",
    mood: "Cream ground with a bright grass accent. Friendly, illustrative, optimistic.",
    tokens: {
      "surface-primary": "#FAF9F4",
      "surface-secondary": "#EFF3E6",
      "foreground-primary": "#17210F",
      "foreground-secondary": "#4A5842",
      "foreground-muted": "#7C8A73",
      "border-subtle": "#DEE5D2",
      "accent-primary": "#3B7629",
      "accent-secondary": "#D2761B"
    }
  },
  {
    name: "Rose Charcoal",
    scheme: "light",
    mood: "Soft off-white and deep charcoal with a dusty rose. Refined, calm, a little romantic.",
    tokens: {
      "surface-primary": "#FCFAFA",
      "surface-secondary": "#F4EFEF",
      "foreground-primary": "#1C1719",
      "foreground-secondary": "#584D51",
      "foreground-muted": "#8B7D82",
      "border-subtle": "#E7DEE0",
      "accent-primary": "#A33A55",
      "accent-secondary": "#6B7280"
    }
  },
  {
    name: "Cobalt Clean",
    scheme: "light",
    mood: "Clinical white with a saturated cobalt. Utility software, dense data, trustworthy.",
    tokens: {
      "surface-primary": "#FFFFFF",
      "surface-secondary": "#F1F5F9",
      "foreground-primary": "#0F172A",
      "foreground-secondary": "#475569",
      "foreground-muted": "#71809A",
      "border-subtle": "#E2E8F0",
      "accent-primary": "#1D4ED8",
      "accent-secondary": "#0E7490"
    }
  },
  {
    name: "Parchment Gold",
    scheme: "light",
    mood: "Aged parchment, walnut text, antique gold. Heritage, craft, printed matter.",
    tokens: {
      "surface-primary": "#F7F2E7",
      "surface-secondary": "#EDE4D1",
      "foreground-primary": "#241C10",
      "foreground-secondary": "#5B4A32",
      "foreground-muted": "#8C7857",
      "border-subtle": "#DFD2B8",
      "accent-primary": "#8A5A16",
      "accent-secondary": "#3F6152"
    }
  },
  {
    name: "Carbon Frost",
    scheme: "dark",
    mood: "Near-black carbon with cool grey and an ice-blue accent. Precise, technical, nocturnal.",
    tokens: {
      "surface-primary": "#0B0D10",
      "surface-secondary": "#16191F",
      "foreground-primary": "#F2F5F8",
      "foreground-secondary": "#A8B2BF",
      "foreground-muted": "#78828F",
      "border-subtle": "#262B33",
      "accent-primary": "#5AC8F5",
      "accent-secondary": "#8B93A1"
    }
  },
  {
    name: "Deep Space Neon",
    scheme: "dark",
    mood: "Ink-navy ground with electric violet. High energy, late night, consumer.",
    tokens: {
      "surface-primary": "#0A0A14",
      "surface-secondary": "#15152A",
      "foreground-primary": "#F4F3FF",
      "foreground-secondary": "#AAA6C8",
      "foreground-muted": "#7C77A0",
      "border-subtle": "#262445",
      "accent-primary": "#A78BFA",
      "accent-secondary": "#F472B6"
    }
  },
  {
    name: "Terminal Green",
    scheme: "dark",
    mood: "True black with phosphor green. Monospaced, operational, no decoration.",
    tokens: {
      "surface-primary": "#050706",
      "surface-secondary": "#0E1411",
      "foreground-primary": "#DFF5E5",
      "foreground-secondary": "#8FB79C",
      "foreground-muted": "#61856E",
      "border-subtle": "#1B2A21",
      "accent-primary": "#4ADE80",
      "accent-secondary": "#FBBF24"
    }
  },
  {
    name: "Onyx Peach",
    scheme: "dark",
    mood: "Warm black with a peach accent. Soft-edged dark mode, editorial, human.",
    tokens: {
      "surface-primary": "#100D0C",
      "surface-secondary": "#1D1817",
      "foreground-primary": "#F7F1EE",
      "foreground-secondary": "#B7A9A3",
      "foreground-muted": "#8A7C76",
      "border-subtle": "#2C2523",
      "accent-primary": "#FFAB7B",
      "accent-secondary": "#7DD3C0"
    }
  },
  {
    name: "Twilight Garden",
    scheme: "dark",
    mood: "Deep plum with a sage accent. Contemplative, botanical, slow.",
    tokens: {
      "surface-primary": "#120E17",
      "surface-secondary": "#1E1826",
      "foreground-primary": "#F3EFF6",
      "foreground-secondary": "#B3A7BE",
      "foreground-muted": "#877B93",
      "border-subtle": "#2C2437",
      "accent-primary": "#9BD4A6",
      "accent-secondary": "#E0A9C8"
    }
  },
  {
    name: "Amber Night",
    scheme: "dark",
    mood: "Roasted brown-black with amber. Industrial, safety-critical, warm under pressure.",
    tokens: {
      "surface-primary": "#0E0B08",
      "surface-secondary": "#1A1510",
      "foreground-primary": "#F6F1E8",
      "foreground-secondary": "#B6A995",
      "foreground-muted": "#897D6B",
      "border-subtle": "#2A2219",
      "accent-primary": "#F5A524",
      "accent-secondary": "#79B4A0"
    }
  }
];

export interface RoundnessScale {
  name: string;
  mood: string;
  /** md, lg, xl. `full` is always 9999 and `none` is always 0. */
  tokens: { md: number; lg: number; xl: number };
}

export const ROUNDNESS: RoundnessScale[] = [
  { name: "Sharp", mood: "Right angles and hairlines. Technical, dense, serious.", tokens: { md: 0, lg: 2, xl: 4 } },
  { name: "Basic", mood: "Gentle softening. The default that disappears.", tokens: { md: 6, lg: 8, xl: 12 } },
  { name: "Rounded", mood: "Clearly rounded cards and controls. Consumer, approachable.", tokens: { md: 10, lg: 14, xl: 20 } },
  { name: "Pillowy", mood: "Very soft. Playful, tactile, toy-like.", tokens: { md: 14, lg: 20, xl: 28 } }
];

export interface ElevationPreset {
  name: string;
  mood: string;
  /** Literal effect values. Effects are inlined on nodes, not stored as variables. */
  sm: string;
  lg: string;
}

export const ELEVATION: ElevationPreset[] = [
  {
    name: "Flat",
    mood: "No shadow at all. Separation comes from borders and whitespace.",
    sm: "no shadow — use stroke: '$border-subtle', strokeWidth: 1",
    lg: "no shadow — use fill: '$surface-secondary' to separate"
  },
  {
    name: "Soft Lift",
    mood: "Barely there. A card feels placed rather than floating.",
    sm: `effect: { type: 'shadow', color: '#0000000F', x: 0, y: 1, blur: 2, spread: 0, enabled: true }`,
    lg: `effect: [{ type: 'shadow', color: '#00000008', x: 0, y: 1, blur: 3, spread: 0, enabled: true }, { type: 'shadow', color: '#0000000A', x: 0, y: 8, blur: 24, spread: 0, enabled: true }]`
  },
  {
    name: "Sharp Depth",
    mood: "Tight, dark, close shadow. Crisp and deliberate.",
    sm: `effect: { type: 'shadow', color: '#00000029', x: 0, y: 1, blur: 2, spread: 0, enabled: true }`,
    lg: `effect: { type: 'shadow', color: '#00000033', x: 0, y: 4, blur: 8, spread: 0, enabled: true }`
  },
  {
    name: "Soft Cloud",
    mood: "Wide, diffuse, weightless. Things hover.",
    sm: `effect: { type: 'shadow', color: '#00000014', x: 0, y: 2, blur: 8, spread: 0, enabled: true }`,
    lg: `effect: { type: 'shadow', color: '#0000001F', x: 0, y: 16, blur: 40, spread: 0, enabled: true }`
  }
];

/**
 * Families the renderer can actually display. index.html loads exactly these.
 * Offering a family the canvas cannot resolve produces a silent fallback and
 * a design that measures differently than it looks, so the list is closed.
 */
export const FONT_FAMILIES = [
  "Inter",
  "Geist",
  "DM Sans",
  "Space Grotesk",
  "Funnel Display",
  "Newsreader",
  "Playfair Display",
  "Instrument Serif",
  "Anton",
  "Geist Mono",
  "IBM Plex Mono"
] as const;

export type FontFamily = (typeof FONT_FAMILIES)[number];

export interface StyleChoice {
  palette: string;
  roundness: string;
  elevation: string;
  headings: string;
  body: string;
  captions: string;
}

export interface ResolvedStyle {
  choice: StyleChoice;
  palette: Palette;
  roundness: RoundnessScale;
  elevation: ElevationPreset;
  /** Ready to merge into Document.variables. */
  variables: Record<string, { type: string; value: string }>;
}

function findByName<T extends { name: string }>(list: T[], name: unknown): T | undefined {
  if (typeof name !== "string") return undefined;
  const wanted = name.trim().toLowerCase();
  return list.find((item) => item.name.toLowerCase() === wanted);
}

function findFont(name: unknown): FontFamily | undefined {
  if (typeof name !== "string") return undefined;
  const wanted = name.trim().toLowerCase();
  return FONT_FAMILIES.find((f) => f.toLowerCase() === wanted);
}

export class StyleChoiceError extends Error {}

/**
 * Turn a choice into document variables. Every field must name a real entry;
 * an unknown name is an error rather than a silent substitution, because a
 * substituted palette is a design decision made by a typo.
 */
export function resolveStyle(input: Partial<StyleChoice>): ResolvedStyle {
  const palette = findByName(PALETTES, input.palette);
  const roundness = findByName(ROUNDNESS, input.roundness);
  const elevation = findByName(ELEVATION, input.elevation);
  const headings = findFont(input.headings);
  const body = findFont(input.body);
  const captions = findFont(input.captions);

  const problems: string[] = [];
  if (!palette) problems.push(`palette must be one of: ${PALETTES.map((p) => p.name).join(", ")}`);
  if (!roundness) problems.push(`roundness must be one of: ${ROUNDNESS.map((r) => r.name).join(", ")}`);
  if (!elevation) problems.push(`elevation must be one of: ${ELEVATION.map((e) => e.name).join(", ")}`);
  if (!headings) problems.push(`headings must be one of: ${FONT_FAMILIES.join(", ")}`);
  if (!body) problems.push(`body must be one of: ${FONT_FAMILIES.join(", ")}`);
  if (!captions) problems.push(`captions must be one of: ${FONT_FAMILIES.join(", ")}`);
  if (problems.length > 0) throw new StyleChoiceError(problems.join("\n"));

  const variables: Record<string, { type: string; value: string }> = {};
  for (const [key, value] of Object.entries(palette!.tokens)) {
    variables[key] = { type: "color", value };
  }
  variables["font-heading"] = { type: "string", value: headings! };
  variables["font-body"] = { type: "string", value: body! };
  variables["font-caption"] = { type: "string", value: captions! };

  return {
    choice: {
      palette: palette!.name,
      roundness: roundness!.name,
      elevation: elevation!.name,
      headings: headings!,
      body: body!,
      captions: captions!
    },
    palette: palette!,
    roundness: roundness!,
    elevation: elevation!,
    variables
  };
}

/** The menu the model reads before it chooses. Feel only — no usage rules. */
export function styleCatalog(): string {
  const lines: string[] = [];
  lines.push("PALETTES (name — feel)");
  for (const p of PALETTES) lines.push(`  ${p.name} (${p.scheme}) — ${p.mood}`);
  lines.push("");
  lines.push("ROUNDNESS");
  for (const r of ROUNDNESS) lines.push(`  ${r.name} — ${r.mood}`);
  lines.push("");
  lines.push("ELEVATION");
  for (const e of ELEVATION) lines.push(`  ${e.name} — ${e.mood}`);
  lines.push("");
  lines.push(`TYPEFACES (choose one each for headings, body, captions)`);
  lines.push(`  ${FONT_FAMILIES.join(", ")}`);
  return lines.join("\n");
}

/**
 * The usage contract for a chosen style. This says where each token is
 * allowed to appear — the part that makes a palette read as a system rather
 * than as eight loose colours.
 */
export function styleGuidelines(style: ResolvedStyle): string {
  const { palette, roundness, elevation, choice } = style;
  const r = roundness.tokens;

  return [
    `STYLE: ${choice.palette} · ${choice.roundness} · ${choice.elevation}`,
    `Feel: ${palette.mood}`,
    "",
    "COLOUR — where each token may appear",
    `  $surface-primary   ${palette.tokens["surface-primary"]}   the ground. Every screen and every full-bleed region.`,
    `  $surface-secondary ${palette.tokens["surface-secondary"]}   raised panels, cards, inputs, inactive chips.`,
    `  $foreground-primary   ${palette.tokens["foreground-primary"]}   headings and primary values only.`,
    `  $foreground-secondary ${palette.tokens["foreground-secondary"]}   body copy and supporting lines.`,
    `  $foreground-muted     ${palette.tokens["foreground-muted"]}   18px and larger only, and never on text that matters.`,
    `                        Below 18px it does not reach 4.5:1 on these surfaces.`,
    `                        Small labels, timestamps and inactive states take $foreground-secondary.`,
    `  $border-subtle     ${palette.tokens["border-subtle"]}   hairlines and 1px separators. Never a fill.`,
    `  $accent-primary    ${palette.tokens["accent-primary"]}   the primary action, the active tab, links, focus.`,
    `  $accent-secondary  ${palette.tokens["accent-secondary"]}   at most 3-4 instances per screen. Status and signal only.`,
    "",
    "  Accent is for interaction and state. Never use an accent as a decorative",
    "  background for a whole region. One primary action per screen carries",
    "  $accent-primary as a solid fill; everything else that is accent-coloured is",
    "  text, icon, or a 1px indicator.",
    "",
    `SHAPE — ${choice.roundness}`,
    `  cornerRadius 0 structural regions, status bar, full-bleed rows`,
    `  cornerRadius ${r.md} inputs, list rows, small chips`,
    `  cornerRadius ${r.lg} nested elements inside a card`,
    `  cornerRadius ${r.xl} cards and panels`,
    `  cornerRadius 9999 pills, avatars, circular buttons, the tab bar`,
    "  Use these five values and no others. A radius that is not on this list",
    "  reads as an accident.",
    "",
    `DEPTH — ${choice.elevation}`,
    `  small lift: ${elevation.sm}`,
    `  large lift: ${elevation.lg}`,
    "  Elevation marks one thing per screen as the subject. If everything lifts,",
    "  nothing does.",
    "",
    "TYPE",
    `  $font-heading  ${choice.headings}   titles and section headings`,
    `  $font-body     ${choice.body}   paragraphs, list titles, values`,
    `  $font-caption  ${choice.captions}   labels, tab labels, metadata, badges`,
    "  Set fontFamily on every text node using these three tokens. Never write a",
    "  family name directly.",
    "  Scale: 28-34 screen title · 20-22 section heading · 15-17 list title ·",
    "  13-14 body · 11-12 caption. Never below 11.",
    "  Hierarchy comes from weight and scale together: a heading is both larger",
    "  and heavier, never one alone."
  ].join("\n");
}

/** Where the chosen style is recorded on the document. */
export const STYLE_METADATA_KEY = "style";

/**
 * Read back the style a document was built with, so the prompt can restate
 * the same rules on every later turn. Returns undefined when no style has
 * been set, which is the signal to make the agent choose one first.
 */
export function currentStyle(doc: { metadata?: Record<string, any> }): ResolvedStyle | undefined {
  const stored = doc.metadata?.[STYLE_METADATA_KEY];
  if (!stored || typeof stored !== "object") return undefined;
  try {
    return resolveStyle(stored as Partial<StyleChoice>);
  } catch {
    return undefined;
  }
}
