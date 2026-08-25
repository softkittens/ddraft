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

import corePalettes from "./palettes.json";
import importedPalettes from "./palettes.imported.json";
import { STYLE_METADATA_KEY, DIRECTION_METADATA_KEY, HARD_SHADOW_ELEVATION } from "./styleKeys";
import { deriveStatusTokens } from "./statusTokens";
import type { ResolvedContext } from "../agent/context";

export { STYLE_METADATA_KEY, DIRECTION_METADATA_KEY, HARD_SHADOW_ELEVATION };

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

/**
 * The catalog the model chooses from. The hand-written core came first;
 * palettes.imported.json carries the range, derived from OpenDesign
 * (https://github.com/nexu-io/open-design, Apache-2.0) by scripts/import-palettes.ts.
 *
 * Both are data files, not modules. Eight hex strings and a sentence of mood
 * are not code, and holding them as TypeScript put nine hundred lines of
 * literal in the middle of the module that reasons about them. `scheme` widens
 * to string on the way through JSON; the importer only ever writes the two
 * values, and the palette tests read every entry back.
 */
export const PALETTES = [...corePalettes, ...importedPalettes] as Palette[];

export interface CompositionArchetype {
  name: string;
  category: "site" | "tool" | "app";
  signature: string;
  rhythm: string;
  density: string;
  media: string;
  avoid: string;
  bandBudget?: string;
  heroPattern?: string;
  showcasePattern?: string;
}

export const COMPOSITION_ARCHETYPES: readonly CompositionArchetype[] = [
  {
    name: "Cinematic Hero & Narrative",
    category: "site",
    signature: "Full-bleed panoramic hero with an anchored key action/conversion instrument, followed by ground-shifting atmospheric bands.",
    rhythm: "Full-viewport hero -> tangible entity showcase -> specifications/story deep-dive -> focused primary decision/action -> ground-shift footer.",
    density: "Generous panoramic whitespace above the fold; rich detail in supporting specs/cards below.",
    media: "Cohesive wide-angle film photography from one shoot; natural directional light; strictly no 3D clip-art or 2D diagrams.",
    avoid: "3-column equal card feature grids, generic SaaS icon boxes, centered badge floods.",
    bandBudget: "4 atmospheric bands",
    heroPattern: "Full-bleed 16:9 panoramic landscape hero with subtle key action pill overlay",
    showcasePattern: "Panoramic photo essay band + compact technical telemetry/spec sheet grid -> ground-shift dark reservation dock"
  },
  {
    name: "Asymmetric Split Instrument",
    category: "site",
    signature: "Asymmetrical split: bold display proposition and primary interactive control/selector pinned beside high-contrast subject imagery.",
    rhythm: "Interactive split hero -> concrete configuration/item selector -> tangible parameters & inclusions -> primary action dock.",
    density: "Medium-high functional density; core actions reachable within the first viewport without deep hunting.",
    media: "Tactile studio tabletop photography with clean drop shadows, authentic material textures, macro details.",
    avoid: "Abstract marketing manifestos, multi-paragraph corporate copy, buried action buttons.",
    bandBudget: "4 high-density functional bands",
    heroPattern: "Interactive split hero: bold display proposition and primary interactive selector beside studio product imagery",
    showcasePattern: "Tangible parameter matrix & inclusion specs -> direct primary action dock"
  },
  {
    name: "Monumental Editorial",
    category: "site",
    signature: "Oversized serif headline dominating the viewport with asymmetric typography scaling and offset photographic moments.",
    rhythm: "Monolithic headline hook -> narrative pull-quote/statement -> asymmetric collection story bands -> curated item ledger with typography-led metadata -> quiet architectural footer.",
    density: "Ultra-spacious, rhythmic pacing with dramatic typographic contrast and wide margins.",
    media: "High-fashion or architectural editorial photography, stark natural lighting, muted film tonality.",
    avoid: "Box-in-box card grids, colored pills/badges everywhere, standard SaaS pricing tables.",
    bandBudget: "3–4 expansive typography-led bands",
    heroPattern: "Monolithic oversized serif headline (>56px) dominating the viewport with offset photographic moments (no split column cards)",
    showcasePattern: "Asymmetric narrative story diptych + pull-quote -> Curated Divided Text Ledger (tabular rows with $border-subtle dividers, monospaced specs, NO rounded cards) -> quiet architectural footer"
  },
  {
    name: "Modular Bento Grid",
    category: "site",
    signature: "Interlocking modular cells of varied spans showcasing live UI snippets, interactive metrics, or hardware details.",
    rhythm: "Punchy headline & CTA -> primary multi-cell Bento feature cluster -> interactive workflow/code inspection -> capability comparison or decision tier.",
    density: "High information density; structured modular containment with visible data, charts, or live UI snippets inside cells.",
    media: "Crisp product UI captures, dark-mode terminal blocks, or isometric hardware details with unified lighting.",
    avoid: "Unformatted long prose paragraphs, mismatched corner radii, low-contrast text on colored cards.",
    bandBudget: "4 structured modular bands",
    heroPattern: "Punchy centered display hook & primary CTA",
    showcasePattern: "5-cell asymmetric Bento cluster (2 wide, 1 tall, 2 square) containing live UI snippets, code blocks, or charts inside cells -> capability comparison tier"
  },
  {
    name: "Filtered Catalog & Index Ledger",
    category: "site",
    signature: "Clean sticky category/filter header bar presiding over a structured multi-column card grid or ledger with locked horizontal baselines.",
    rhythm: "Emotive hero -> filter & search bar -> featured/curated row -> structured catalog grid with consistent card heights and clear attributes -> clean ledger footer.",
    density: "High scanability; repetitive structured cards with clear badges, tags, and aligned action buttons.",
    media: "Uniform aspect-ratio photography (4:3 or 16:9), clean neutral backgrounds, consistent framing.",
    avoid: "Uneven card heights, staggered button baselines, missing attributes, naked search widgets replacing the hero.",
    bandBudget: "3-4 structured inventory bands",
    heroPattern: "Emotive proposition title & subline with integrated category switcher / inline filter control bar",
    showcasePattern: "Structured multi-column index cards with uniform aspect ratio photography and locked horizontal baselines"
  },
  {
    name: "Operational Workbench",
    category: "tool",
    signature: "Live status bar and metric telemetry rack directly above an interactive subsystem inspection grid.",
    rhythm: "System state overview at top -> live metric series with varied data -> drilldown subsystem inspector -> command action bar.",
    density: "Maximum information density; every pixel encodes live state, logs, coordinates, or controls; zero marketing fluff.",
    media: "Data plots, sparklines, SVG geometry, status dot indicators; zero decorative stock photos.",
    avoid: "Marketing hero banners, customer testimonials, empty spacer blocks.",
    bandBudget: "Single-viewport dense operational console (0 marketing bands)",
    heroPattern: "Live telemetry rack & system state status bar across topBar",
    showcasePattern: "Subsystem inspection grid with live status dots ($status-ok, $status-warn), sparklines, and metric plots -> command action bar"
  },
  {
    name: "Linear Stepwise Journey",
    category: "site",
    signature: "Centered linear vertical column (680-840px width) with numbered milestone nodes, progressive visual cues, and focused interactive inputs.",
    rhythm: "Orientation hook -> sequenced stages with inline interactive components -> summary calculation/preview -> direct confirmation action.",
    density: "Focused, sequential cognitive load; one primary task or concept per section.",
    media: "Annotated workflow diagrams, step-by-step interface snippets, crisp instructional micro-graphics.",
    avoid: "Distracting multi-column sidebars, competing secondary offers, disjointed random cards.",
    bandBudget: "3 focused sequential bands (680–840px centered column)",
    heroPattern: "Orientation hook + time/milestone estimate",
    showcasePattern: "Sequenced numbered milestone stages with inline interactive inputs -> summary calculation -> direct confirmation action"
  },
  {
    name: "Card-Stage & Thumb Dock",
    category: "app",
    signature: "Single-viewport mobile stage: centered focal card in upper viewport, circular thumb action dock in lower thumb zone, pinned bottom tab bar.",
    rhythm: "Header mode switcher -> centered stage card with metadata pills -> thumb action dock -> pinned bottom tabs.",
    density: "Compact single-viewport composition fitting cleanly within 844px mobile height.",
    media: "Full-bleed portrait photography or dynamic media; edge-to-edge within the stage card.",
    avoid: "Vertical scroll overflow on single-card apps, touch targets <44px, top-heavy action buttons.",
    bandBudget: "Single-viewport mobile app (844px max height)",
    heroPattern: "Mode switcher header -> centered portrait stage card with metadata pills",
    showcasePattern: "Thumb action dock with circular action buttons -> pinned bottom tabs"
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
  },
  {
    name: "Hard Block",
    mood: "Zero-blur offset block. Printed, graphic, deliberately crude.",
    sm: `effect: { type: 'shadow', color: '$foreground-primary', x: 2, y: 2, blur: 0, spread: 0, enabled: true }`,
    lg: `effect: { type: 'shadow', color: '$foreground-primary', x: 4, y: 4, blur: 0, spread: 0, enabled: true }`
  }
];

/**
 * Curated typography catalog with proven weight and style pairings.
 * Loaded on-demand via the Google Fonts CSS2 engine.
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

/**
 * Typefaces by the job they can do, with the job written down. A hand that is
 * all sans has no display voice, so the deal draws from each group rather than
 * from the flat list — but a face's group also has to reach the model, because
 * a bare list of five names invites the model to fill "captions" with whatever
 * sits in the third position.
 */
interface TypefaceGroup {
  readonly label: string;
  readonly faces: readonly FontFamily[];
  /** How many of this group a hand holds. */
  readonly deal: number;
  /** Printed beside the dealt faces: where this group belongs, and where it does not. */
  readonly job: string;
}

const TYPEFACE_GROUPS: readonly TypefaceGroup[] = [
  {
    label: "Text",
    faces: ["Inter", "Geist", "DM Sans", "Space Grotesk"],
    deal: 2,
    job: "any role"
  },
  {
    label: "Serif",
    faces: ["Newsreader", "Playfair Display", "Instrument Serif"],
    deal: 1,
    job: "headings; body when editorial"
  },
  {
    label: "Display",
    faces: ["Funnel Display", "Anton"],
    deal: 1,
    job: "headings above 28px only"
  },
  {
    label: "Mono",
    faces: ["Geist Mono", "IBM Plex Mono"],
    deal: 1,
    job: "numbers and code only — never labels, chips or tab bars"
  }
];

/**
 * Mono is a specialist. Dealt into every hand it stopped being a choice: a hand
 * always held one, the caption role is described as "labels, tab labels,
 * metadata, badges", and the model took the offer — a third of the visible text
 * on a cat adoption app came out monospaced, which is the wireframe tell the
 * craft rules already forbid in prose. Roughly one hand in four now holds it, so
 * reaching for it is a decision about the product rather than about the list.
 */
const MONO_GROUP = "Mono";
const MONO_SHARE = 0.25;

/** The dealt hand, grouped, so the catalog can print each face beside its job. */
export function dealTypefaceGroups(
  seed: number,
  avoidedFaces: readonly string[] = []
): { label: string; job: string; faces: FontFamily[] }[] {
  // Its own stream, so the typefaces a brief is offered do not move with the
  // number of palettes dealt before them.
  const next = dealer((seed ^ 0x27d4eb2d) | 0);
  // Drawn before the loop so the other three groups deal identically whether or
  // not this hand includes mono.
  const monoDraw = next();
  const avoided = new Set(avoidedFaces.map((face) => face.toLowerCase()));
  return TYPEFACE_GROUPS.flatMap((group) => {
    if (group.label === MONO_GROUP && monoDraw >= MONO_SHARE) return [];
    const fresh = group.faces.filter((face) => !avoided.has(face.toLowerCase()));
    const pool = fresh.length > 0 ? fresh : group.faces;
    return [{
      label: group.label,
      job: group.job,
      faces: deal([...pool], Math.min(group.deal, pool.length), next)
    }];
  });
}

/**
 * The same convergence the palette deal fixed, one axis over. Printing all
 * offered families in a fixed order put Inter first on every run — and Inter,
 * Geist and DM Sans are precisely the families a model reaches for when it is not
 * choosing. Dealing makes the model pick from what it was given.
 */
export function dealTypefaces(seed: number): FontFamily[] {
  return dealTypefaceGroups(seed).flatMap((group) => group.faces);
}

export interface StyleChoice {
  composition?: string;
  palette: string;
  roundness: string;
  elevation: string;
  headings: string;
  body: string;
  captions: string;
}

export interface DesignDirection {
  thesis: string;
  ownWorld: string;
  firstViewport: string;
}

export interface ResolvedStyle {
  choice: StyleChoice;
  composition?: CompositionArchetype;
  palette: Palette;
  roundness: RoundnessScale;
  elevation: ElevationPreset;
  /** Ready to merge into Document.variables. */
  variables: Record<string, { type: string; value: string }>;
}

function findByName<T extends { name: string }>(list: readonly T[] | T[], name: unknown): T | undefined {
  if (typeof name !== "string") return undefined;
  const wanted = name.trim().toLowerCase();
  return list.find((item) => item.name.toLowerCase() === wanted);
}

/** The hand used to print `Publication (light)`. Models copied the whole token. */
function findPalette(name: unknown): Palette | undefined {
  if (typeof name !== "string") return undefined;
  const stripped = name.trim().replace(/\s*\((light|dark)\)\s*$/i, "").trim();
  return findByName(PALETTES, stripped);
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
export function resolveStyle(
  input: Partial<StyleChoice>,
  opts: { allowMissingComposition?: boolean } = {}
): ResolvedStyle {
  const composition = input.composition ? findByName(COMPOSITION_ARCHETYPES, input.composition) : undefined;
  const palette = findPalette(input.palette);
  const roundness = findByName(ROUNDNESS, input.roundness);
  const elevation = findByName(ELEVATION, input.elevation);
  const headings = findFont(input.headings);
  const body = findFont(input.body);
  const captions = findFont(input.captions);

  const problems: string[] = [];
  if (!input.composition && !opts.allowMissingComposition) {
    problems.push(`composition must be one of: ${COMPOSITION_ARCHETYPES.map((a) => a.name).join(", ")}`);
  } else if (input.composition && !composition) {
    problems.push(`composition "${input.composition}" is not in the catalog. Must be one of: ${COMPOSITION_ARCHETYPES.map((a) => a.name).join(", ")}`);
  }
  if (!palette) problems.push(`palette "${input.palette}" is not in the catalog. Use one of the palettes listed in your instructions.`);
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
  /*
   * Status is derived from the palette rather than stored in it. A palette is
   * a set of decisions about character; which green means "running" on that
   * character is arithmetic, and arithmetic that has to clear 4.5:1 against
   * this particular card is better done than remembered 58 times.
   */
  for (const [key, value] of Object.entries(deriveStatusTokens(palette!.tokens, palette!.scheme))) {
    variables[key] = { type: "color", value };
  }
  variables["font-heading"] = { type: "string", value: headings! };
  variables["font-body"] = { type: "string", value: body! };
  variables["font-caption"] = { type: "string", value: captions! };

  return {
    choice: {
      ...(composition ? { composition: composition.name } : {}),
      palette: palette!.name,
      roundness: roundness!.name,
      elevation: elevation!.name,
      headings: headings!,
      body: body!,
      captions: captions!
    },
    composition,
    palette: palette!,
    roundness: roundness!,
    elevation: elevation!,
    variables
  };
}

/** The menu the model reads before it chooses. Feel only — no usage rules. */
/** Deterministic dealer, so one brief always sees one hand. */
function dealer(seed: number): () => number {
  // The seed is a hash of the brief, so neighbouring briefs arrive as
  // neighbouring integers, and a raw LCG started on those stays correlated for
  // its first several draws — which is exactly where a hand is dealt from.
  // Measured over 400 seeds it put one dark palette in 41% of hands against a
  // catalog share of 18%. A murmur3 finalizer plus a short warm-up scatters the
  // starting states before the first card is turned over.
  let state = (seed | 0) || 0x9e3779b9;
  state ^= state >>> 16;
  state = Math.imul(state, 0x85ebca6b);
  state ^= state >>> 13;
  state = Math.imul(state, 0xc2b2ae35);
  state = (state ^ (state >>> 16)) | 0;

  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return ((state >>> 8) & 0xffffff) / 0x1000000;
  };
  for (let i = 0; i < 8; i++) next();
  return next;
}

function deal<T>(items: T[], count: number, next: () => number): T[] {
  const pool = items.slice();
  const out: T[] = [];
  while (pool.length > 0 && out.length < count) {
    out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
  }
  return out;
}

export const PALETTE_HAND_SIZE = 8;

/**
 * A hand, not the catalog. Printing every palette is both expensive and
 * useless: the model ranks them and takes the one whose adjective matches the
 * brief's category, which is how every warm product came out cream. Dealing a
 * few forces a real choice, and the seed keeps one brief reproducible.
 *
 * Light and dark are dealt separately. Whether a product is dark is a question
 * about where it is used, and a hand drawn from the whole list would be light
 * almost every time.
 *
 * When a brief is present, two seats are reserved for palettes whose name or
 * mood overlap it, and costume worlds (brutal, terminal, dithered) stay out
 * of a quiet editorial deal. The rest of the hand stays seeded-random, so
 * the product can still look like itself without Luna skipping Refined
 * because cream was "guessable".
 */
export interface StyleAvoidance {
  compositions?: readonly string[];
  palettes?: readonly string[];
  headings?: readonly string[];
  roundness?: readonly string[];
  elevation?: readonly string[];
}

/**
 * Optional brief and resolved context so the hand can hold palettes and
 * compositions that match the product's archetype and atmosphere.
 */
export interface StyleDeal {
  brief?: string;
  context?: Partial<ResolvedContext>;
}

const ATMOSPHERE_SEATS = 2;

/** Worlds that are a costume unless the brief asks for them. */
const COSTUME_WORLD =
  /brutal|dither|skeuomorph|neumorph|cosmic|trading terminal|\bterminal\b|\bhud\b|mission control/i;

const QUIET_EDITORIAL =
  /\b(warm|minimal|quiet|paper|linen|editorial|booking|house|coworking|cafe|magazine|hospitality|studio)\b/i;

const ASKS_COSTUME =
  /\b(brutal|neobrutal|dither|terminal|dashboard|telemetry|ops|trading|console|hud|brutalist)\b/i;

const AFFINITY_STOP = new Set([
  "with", "from", "that", "this", "have", "your", "their", "about",
  "site", "page", "for", "style", "space"
]);

function isCostumePalette(palette: Palette): boolean {
  return COSTUME_WORLD.test(`${palette.name} ${palette.mood}`);
}

const COLD_TECH_PALETTES =
  /\b(simple|corporate|enterprise|cobalt clean|application|trading terminal)\b/i;

function isColdTechPalette(palette: Palette): boolean {
  return COLD_TECH_PALETTES.test(palette.name);
}

function isQuietEditorialBrief(brief: string): boolean {
  return QUIET_EDITORIAL.test(brief) && !ASKS_COSTUME.test(brief);
}

function isBlockWorld(palette: Palette): boolean {
  return /brutal|dither/i.test(palette.name);
}

function briefTokens(brief: string): string[] {
  return (brief.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((t) => !AFFINITY_STOP.has(t));
}

function tokenHits(hay: string, token: string): boolean {
  if (hay.includes(token) || (hay.length >= 5 && token.includes(hay))) return true;
  const stem = token.replace(/(?:ism|ist|istic|al|ed|ing)$/i, "");
  return stem.length >= 5 && hay.includes(stem);
}

function paletteAffinity(palette: Palette, tokens: string[]): number {
  const name = palette.name.toLowerCase();
  const mood = palette.mood.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (tokenHits(name, token)) score += 4;
    if (tokenHits(mood, token)) score += 1;
  }
  return score;
}

function reservedPalettes(pool: Palette[], brief: string, seats: number): Palette[] {
  const tokens = briefTokens(brief);
  if (tokens.length === 0 || seats <= 0) return [];
  return pool
    .map((palette) => ({ palette, score: paletteAffinity(palette, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.palette.name.localeCompare(b.palette.name))
    .slice(0, seats)
    .map((entry) => entry.palette);
}

export function dealCompositionArchetypes(
  seed: number,
  context?: Partial<ResolvedContext>
): CompositionArchetype[] {
  const archetype = context?.archetype;
  const surface = context?.surface;
  const traits = context?.traits ?? [];
  const next = dealer(seed);

  if (archetype === "tool") {
    // Tool surfaces: only Operational Workbench and Modular Bento Grid are eligible
    const eligible = COMPOSITION_ARCHETYPES.filter(
      (a) => a.name === "Operational Workbench" || a.name === "Modular Bento Grid"
    );
    return deal(eligible, eligible.length, next);
  }

  if (traits.includes("swipe_discovery") || (archetype === "app" && surface === "mobile")) {
    // Mobile card swipe / discovery / compact app
    const eligible = COMPOSITION_ARCHETYPES.filter(
      (a) =>
        a.name === "Card-Stage & Thumb Dock" ||
        a.name === "Asymmetric Split Instrument" ||
        a.name === "Linear Stepwise Journey"
    );
    return deal(eligible, eligible.length, next);
  }

  // Site surfaces and general: strictly exclude Operational Workbench and Card-Stage & Thumb Dock
  const eligible = COMPOSITION_ARCHETYPES.filter(
    (a) => a.name !== "Operational Workbench" && a.name !== "Card-Stage & Thumb Dock"
  );
  return deal(eligible, 4, next);
}

export function styleCatalog(
  seed: number,
  handSize = PALETTE_HAND_SIZE,
  avoidance: StyleAvoidance = {},
  dealOpts: StyleDeal = {}
): string {
  const next = dealer(seed);
  const brief = dealOpts.brief?.trim() ?? "";
  let eligiblePalettes = PALETTES;
  if (brief && isQuietEditorialBrief(brief)) {
    const withoutCostumeOrCold = PALETTES.filter((p) => !isCostumePalette(p) && !isColdTechPalette(p));
    if (withoutCostumeOrCold.length >= handSize) eligiblePalettes = withoutCostumeOrCold;
  }

  // 1. Reserve seats for palettes with high brief affinity from the full eligible pool
  const reserved = brief ? reservedPalettes(eligiblePalettes, brief, ATMOSPHERE_SEATS) : [];

  // 2. Apply historical avoidance only to filling the remaining exploratory seats
  const avoidedPalettes = new Set((avoidance.palettes ?? []).map((name) => name.toLowerCase()));
  const reservedNames = new Set(reserved.map((p) => p.name.toLowerCase()));
  const unreserved = eligiblePalettes.filter((p) => !reservedNames.has(p.name.toLowerCase()));
  const freshLeftover = unreserved.filter((p) => !avoidedPalettes.has(p.name.toLowerCase()));
  const leftover = freshLeftover.length >= (handSize - reserved.length) ? freshLeftover : unreserved;
  const remainingSlots = Math.max(0, handSize - reserved.length);
  const dark = leftover.filter((p) => p.scheme === "dark");
  const light = leftover.filter((p) => p.scheme === "light");
  // Proportional to the catalog, with a floor of two so neither scheme can be
  // absent — unless reserved seats already brought a dark in. An even split
  // would deal dark far above its share and trade one monoculture for another.
  const share = Math.round((remainingSlots * dark.length) / Math.max(PALETTES.length, 1));
  const minDark = reserved.some((p) => p.scheme === "dark") ? 0 : Math.min(2, remainingSlots);
  const darkCount = Math.min(remainingSlots, Math.max(minDark, share));
  const rest = remainingSlots === 0
    ? []
    : deal(
        [...deal(dark, darkCount, next), ...deal(light, remainingSlots - darkCount, next)],
        remainingSlots,
        next
      );
  const hand = deal([...reserved, ...rest], handSize, next);

  const lines: string[] = [];
  lines.push("COMPOSITION (choose one for composition)");
  lines.push("  Pass the archetype name to set_style to commit to its structural gesture.");
  for (const c of dealCompositionArchetypes(seed, dealOpts.context)) {
    lines.push(`  ${c.name} — ${c.signature}`);
  }
  lines.push("");
  lines.push("PALETTES (name — world). These are the palettes offered this run.");
  lines.push("  Pass the name to set_style, not the light/dark label.");
  lines.push("  Take light or dark from where the product is used, not from its category.");
  for (const p of hand) {
    const acc = p.tokens["accent-primary"];
    const surf = p.tokens["surface-primary"];
    lines.push(`  ${p.name} — ${p.scheme}. [${acc} accent on ${surf} ground] ${p.mood}`);
  }
  lines.push("");
  lines.push("ROUNDNESS");
  const avoidedRoundness = new Set((avoidance.roundness ?? []).map((name) => name.toLowerCase()));
  const freshRoundness = ROUNDNESS.filter((r) => !avoidedRoundness.has(r.name.toLowerCase()));
  for (const r of freshRoundness.length >= 2 ? freshRoundness : ROUNDNESS) {
    lines.push(`  ${r.name} — ${r.mood}`);
  }
  lines.push("");
  lines.push("ELEVATION");
  const avoidedElevation = new Set((avoidance.elevation ?? []).map((name) => name.toLowerCase()));
  const freshElevation = ELEVATION.filter((e) => !avoidedElevation.has(e.name.toLowerCase()));
  const elevations = (freshElevation.length >= 2 ? freshElevation : ELEVATION).filter((e) => {
    if (e.name !== HARD_SHADOW_ELEVATION) return true;
    return hand.some(isBlockWorld);
  });
  for (const e of elevations) {
    lines.push(`  ${e.name} — ${e.mood}`);
  }
  lines.push("");
  lines.push(`TYPEFACES (choose one each for headings, body, captions)`);
  for (const group of dealTypefaceGroups(seed, avoidance.headings)) {
    lines.push(`  ${group.label.padEnd(8)}${group.faces.join(", ").padEnd(25)}${group.job}`);
  }
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
  const status = deriveStatusTokens(palette.tokens, palette.scheme);

  return [
    `STYLE: ${choice.palette} · ${choice.roundness} · ${choice.elevation}`,
    `Feel: ${palette.mood}`,
    ...(style.composition ? [
      "",
      `COMPOSITION: ${style.composition.name}`,
      ...(style.composition.bandBudget ? [`  Band Budget: ${style.composition.bandBudget}`] : []),
      `  Signature:   ${style.composition.signature}`,
      ...(style.composition.heroPattern ? [`  Hero:        ${style.composition.heroPattern}`] : []),
      `  Rhythm:      ${style.composition.rhythm}`,
      ...(style.composition.showcasePattern ? [`  Showcase:    ${style.composition.showcasePattern}`] : []),
      `  Density:     ${style.composition.density}`,
      `  Media:       ${style.composition.media}`,
      `  Avoid:       ${style.composition.avoid}`
    ] : []),
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
    `  $accent-primary    ${palette.tokens["accent-primary"]}   solid fills, icons, indicators, focus rings.`,
    `                       Not small text. Some accents in this catalog are bright`,
    `                       enough that 11px of them is unreadable, so a selected`,
    `                       state takes $foreground-primary at 600 weight and lets`,
    `                       the accent carry the icon or the indicator beside it.`,
    `  $accent-secondary  ${palette.tokens["accent-secondary"]}   at most 3-4 instances per screen. Signal and emphasis.`,
    `  $status-ok         ${status["status-ok"]}   running, online, nominal, pass, within threshold.`,
    `  $status-warn       ${status["status-warn"]}   standby, pending, degraded, awaiting action.`,
    `  $status-fault      ${status["status-fault"]}   fault, offline, breach, failed, overdue.`,
    `                       Derived for this palette and legible on ${palette.tokens["surface-secondary"]}.`,
    `                       Use them for state — dots, tags, values that crossed a`,
    `                       line — and nothing else. They are not decoration and they`,
    `                       do not count against the accent budget, because state is`,
    `                       not emphasis. Never invent a status colour as raw hex;`,
    `                       twelve unit dots hand-coloured are twelve chances to drift.`,
    "",
    "  Accent is for interaction; status tokens are for state. A site may paint a",
    "  full-width band $surface-secondary or invert it ($foreground-primary fill,",
    "  $surface-primary type). Do not scatter accent as a tint on every card.",
    "  Use accent in at most two visible roles per screen; one primary action may",
    "  carry $accent-primary as a solid fill. Repeating that CTA is one role.",
    "  State is never carried by colour alone — pair it with weight, size or",
    "  position so it survives being read at a glance.",
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
    "  Scale: 44-64 display · 32-40 compact mobile title · 28-34 screen title · 20-22 section heading ·",
    "  15-17 list title · 13-14 body · 11-12 caption. Never below 11.",
    "  Desktop tools and editorial surfaces use one 44-64 display treatment.",
    "  Compact mobile apps may use 32-40 instead. A site may use display once more on a ground-shift band.",
    "  Hierarchy comes from weight and scale together: a heading is both larger and heavier (jump two grades, e.g. 400 body with 600/700 heading; never 400 with 500).",
    "  Leading: Display (>32px) takes tight 1.05-1.15 line-height; body takes 1.45-1.60 reading leading.",
    "  Tracking: Display (>=32px) takes negative tracking (-2% to -4% of font size, e.g. -0.8 to -1.2); small uppercase tags take open tracking (+6% to +10%, e.g. +0.8 to +1.2)."
  ].join("\n");
}

export function designDirection(input: unknown): DesignDirection | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  if (typeof value.thesis !== "string" || !value.thesis.trim()) return undefined;
  if (typeof value.ownWorld !== "string" || !value.ownWorld.trim()) return undefined;
  if (typeof value.firstViewport !== "string" || !value.firstViewport.trim()) return undefined;
  return {
    thesis: value.thesis.trim(),
    ownWorld: value.ownWorld.trim(),
    firstViewport: value.firstViewport.trim()
  };
}

export function currentDirection(doc: { metadata?: Record<string, any> }): DesignDirection | undefined {
  return designDirection(doc.metadata?.[DIRECTION_METADATA_KEY]);
}

/**
 * Read back the style a document was built with, so the prompt can restate
 * the same rules on every later turn. Returns undefined when no style has
 * been set, which is the signal to make the agent choose one first.
 */
export function currentStyle(doc: { metadata?: Record<string, any> }): ResolvedStyle | undefined {
  const stored = doc.metadata?.[STYLE_METADATA_KEY];
  if (!stored || typeof stored !== "object") return undefined;
  try {
    return resolveStyle(stored as Partial<StyleChoice>, { allowMissingComposition: true });
  } catch {
    return undefined;
  }
}
