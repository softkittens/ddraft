/* ------------------------------------------------------------------ *
 * The brief set.
 *
 * Short, varied, and none of them describe a layout. A brief that
 * dictates structure would test whether the model can follow
 * instructions; these test whether it can design. Keep them stable —
 * changing a brief invalidates every stored baseline.
 * ------------------------------------------------------------------ */

export interface Brief {
  id: string;
  surface: "mobile" | "desktop";
  /** What the run is meant to expose. Not sent to the model. */
  probes: string;
  text: string;
}

export const BRIEFS: Brief[] = [
  {
    id: "horses",
    surface: "mobile",
    probes: "card stack, one dominant element, photo handling",
    text: "make me a mobile app, tinder for horses"
  },
  {
    id: "transit",
    surface: "mobile",
    probes: "dense repeated rows, time and status, component reuse",
    text: "a mobile app that shows when my bus arrives"
  },
  {
    id: "recipes",
    surface: "mobile",
    probes: "long prose, ordered steps, text wrapping",
    text: "a mobile recipe app for one dish at a time"
  },
  {
    id: "split",
    surface: "mobile",
    probes: "numbers, people, an unambiguous primary action",
    text: "a mobile app to split a restaurant bill with friends"
  },
  {
    id: "warehouse",
    surface: "desktop",
    probes: "three-region body, density, a dominant region",
    text: "a desktop dashboard for a warehouse manager"
  },
  {
    id: "inbox",
    surface: "desktop",
    probes: "list plus detail, rails, selection state",
    text: "a desktop app for triaging customer support tickets"
  },
  {
    id: "meditation",
    surface: "mobile",
    probes: "restraint, quiet palette, generous space",
    text: "a calm mobile app for a daily breathing exercise"
  },
  {
    id: "invoices",
    surface: "desktop",
    probes: "tabular data, alignment, muted secondary text",
    text: "a desktop screen where a freelancer tracks unpaid invoices"
  }
];

export function briefById(id: string): Brief | undefined {
  return BRIEFS.find((b) => b.id === id);
}
