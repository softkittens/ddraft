/**
 * What a screen is allowed to offer.
 *
 * Rails used to be stamped onto every desktop frame and then talked out of in
 * the prompt. The digest listed the ids, photography wanted an edge, and the
 * prose lost (8ca10dd0). Chrome is an affordance: if a site should not fill
 * rails, the site screen does not have rails.
 *
 * Prompt, create_screen and the write tools all read this. A failure becomes a
 * policy change, not a third synonym in rules.md.
 */

export type ChromeArchetype = "site" | "tool" | "app" | "unspecified";

export type FillableSlot =
  | "screen"
  | "topBar"
  | "rail"
  | "main"
  | "aside"
  | "bleed"
  | "content"
  | "tabBar";

export function desktopHasRails(archetype: ChromeArchetype): boolean {
  return archetype === "tool";
}

/** Slot names create_screen returns for a desktop of this archetype, excluding the screen itself. */
export function desktopSlotNames(archetype: ChromeArchetype): string {
  return desktopHasRails(archetype)
    ? "topBar, rail, main, aside"
    : "topBar, main";
}
