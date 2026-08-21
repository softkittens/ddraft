/**
 * The handful of style constants that code outside the style system needs.
 *
 * They live apart from styleSystem so a consumer can read them without
 * pulling the palette catalog in behind them. The evaluator runs in the
 * browser and needs one of these; importing it from styleSystem put all
 * fifty-eight palettes into the bundle for the sake of a string.
 */

/** Where the chosen style is recorded on the document. */
export const STYLE_METADATA_KEY = "style";

/** Where the direction contract is recorded on the document. */
export const DIRECTION_METADATA_KEY = "direction";

/**
 * The one elevation that earns a zero-blur shadow. The catalog carries worlds —
 * Neobrutalism, Brutalism, Dithered — whose whole depth idea is the offset
 * block, and before this they could only be dressed in a soft shadow that
 * contradicted them. Naming it also lets the audit treat the block shadow as a
 * costume everywhere else.
 */
export const HARD_SHADOW_ELEVATION = "Hard Block";
