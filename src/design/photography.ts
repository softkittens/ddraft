/**
 * What shape a generated photograph can actually be.
 *
 * Every image provider behind generate_image takes an aspect ratio from a
 * three-item menu, not a pixel size: 16:9, 3:4 or 1:1. The picture that comes
 * back is then painted with drawImageCover, so whatever the frame does not
 * match is cropped away from the centre and never seen.
 *
 * That makes the frame's aspect a design decision with a measurable cost, and
 * one worth measuring: in the logged corpus a fifth of all generated images
 * lose more than a fifth of the picture to a frame that could not hold them.
 */

export type GeneratedAspect = "landscape" | "portrait" | "square";

/** The three shapes the providers can return, and what to call them in prose. */
export const GENERATED_ASPECTS: ReadonlyArray<{
  name: GeneratedAspect;
  ratio: number;
  label: string;
}> = [
  { name: "landscape", ratio: 16 / 9, label: "16:9" },
  { name: "square", ratio: 1, label: "1:1" },
  { name: "portrait", ratio: 3 / 4, label: "3:4" }
];

/**
 * The generatable shape closest to a frame, measured on a log scale.
 *
 * Log distance, not linear: 1.2 sits nearer 1:1 than 16:9 the way an eye reads
 * it, while plain subtraction says the opposite. The tool used to split
 * landscape from square at 1.15, which sent every nearly-square card to 16:9
 * and threw a third of the picture away; the boundary belongs at sqrt(16/9).
 */
export function nearestGeneratedAspect(ratio: number): {
  name: GeneratedAspect;
  ratio: number;
  label: string;
} {
  let best = GENERATED_ASPECTS[0];
  let bestDistance = Infinity;
  for (const candidate of GENERATED_ASPECTS) {
    const distance = Math.abs(Math.log(ratio / candidate.ratio));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * The share of a generated picture a frame throws away under cover fit.
 *
 * Cover scales until both axes are filled and crops the overflow, so the
 * visible share of the source is exactly the ratio of the two aspects — 0 when
 * they match, 0.61 for a 3:4 photograph in a 390x1320 phone band.
 */
export function croppedFraction(boxRatio: number, imageRatio: number): number {
  if (!(boxRatio > 0) || !(imageRatio > 0)) return 0;
  return 1 - Math.min(boxRatio, imageRatio) / Math.max(boxRatio, imageRatio);
}

/**
 * The share of a picture that has to be cropped before it stops being the
 * photograph that was asked for.
 *
 * Set at a third from the corpus: with the aspect chosen correctly, only 7 of
 * 133 logged images cross it, and every one of those sits in a frame no
 * available shape can fill — a 4.2:1 strip, a 1:3.4 phone band. Below it the
 * crop reads as framing; above it the subject starts leaving the frame.
 */
export const SEVERE_CROP = 0.5;

/**
 * The heights that hold a full picture at this width, for a fix message.
 *
 * Nearest shape first, because the list is read as a recommendation: told a
 * 1440x480 band crops 41% away, "1440x810" is the move and "1440x1920" is
 * noise, and the order is the only thing saying which is which.
 */
export function isPanoramicBanner(width: number, height: number): boolean {
  if (width < 900 || height <= 0) return false;
  const ratio = width / height;
  return height >= 140 && height <= 520 && ratio >= 16 / 9 && ratio <= 6.5;
}

export function servableHeights(width: number, ratio: number): string {
  return [...GENERATED_ASPECTS]
    .sort((a, b) => Math.abs(Math.log(ratio / a.ratio)) - Math.abs(Math.log(ratio / b.ratio)))
    .map((aspect) => `${Math.round(width)}x${Math.round(width / aspect.ratio)} (${aspect.label})`)
    .join(", ");
}
