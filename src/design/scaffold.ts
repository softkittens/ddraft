import type { FrameNode, PenNode } from "../model/types";

/* ------------------------------------------------------------------ *
 * Screen scaffolding.
 *
 * These numbers used to live in the system prompt as prose, asking the
 * model to remember a status bar is 62 tall and a tab bar is inset by
 * 16 on every screen of every run. Asking is how you get a tab bar
 * that lost its icons on run three. Here the numbers are applied by
 * code, so they cannot be forgotten, cannot drift between screens of
 * the same document, and cost no tokens to state.
 *
 * The model still decides everything that is a design decision: how
 * many screens, what they are for, which destinations the tab bar
 * carries, and every element inside the inset or full-bleed content slots.
 * ------------------------------------------------------------------ */

export interface TabSpec {
  label: string;
  /** Lucide icon name. */
  icon: string;
  active?: boolean;
}

export interface ScreenSpec {
  name: string;
  kind: "mobile" | "desktop";
  /** Mobile only. Omit for a screen with no tab bar, such as onboarding. */
  tabs?: TabSpec[];
}

export interface Scaffold {
  node: FrameNode;
  /** Ids the caller fills, by role. */
  slots: Record<string, string>;
}

export const MOBILE_WIDTH = 390;
export const MOBILE_HEIGHT = 844;
export const STATUS_BAR_HEIGHT = 62;
export const TAB_BAR_HEIGHT = 56;

const STATUS_ICONS = ["signal", "wifi", "battery-full"];

function tabItem(tab: TabSpec, id: () => string): PenNode {
  // The active tab is marked twice: the icon takes the accent, the label goes
  // to full foreground and 600 weight. Colour alone is the weakest way to carry
  // a state, and pinning it to an 11px accent label also forced every palette's
  // accent to clear 4.5:1 on the bar — which is what kept the boldest worlds
  // (bright yellows, hot pinks, saturated oranges) out of the catalog entirely.
  // An icon is a graphic, so 3:1 is the bar it actually has to clear.
  //
  // Not $foreground-muted for the inactive label: an 11px label in muted
  // measures 3.25:1 against the secondary surface in the worst palette.
  // Secondary clears 4.5:1 in every palette we ship.
  const iconTone = tab.active ? "$accent-primary" : "$foreground-secondary";
  const labelTone = tab.active ? "$foreground-primary" : "$foreground-secondary";
  return {
    type: "frame",
    id: id(),
    name: `Tab ${tab.label}`,
    metadata: { scaffold: "chrome" },
    layout: "vertical",
    gap: 4,
    justifyContent: "center",
    alignItems: "center",
    width: "fill_container",
    // Fills the bar's inner height. Sized to its content it came to 39px, under
    // the 44px a finger needs, on every tab of every screen.
    height: "fill_container",
    children: [
      { type: "icon", id: id(), icon: tab.icon, width: 22, height: 22, stroke: iconTone },
      {
        type: "text",
        id: id(),
        content: tab.label,
        fontFamily: "$font-caption",
        fontSize: 11,
        fontWeight: tab.active ? 600 : 400,
        fill: labelTone,
        textAlign: "center"
      }
    ]
  } as PenNode;
}

function mobileScreen(spec: ScreenSpec, id: () => string, slots: Record<string, string>): FrameNode {
  const children: PenNode[] = [];

  const statusBar: PenNode = {
    type: "frame",
    id: id(),
    name: "Status Bar",
    metadata: { scaffold: "chrome" },
    width: "fill_container",
    height: STATUS_BAR_HEIGHT,
    layout: "horizontal",
    justifyContent: "space_between",
    alignItems: "center",
    padding: [0, 24],
    children: [
      {
        type: "text",
        id: id(),
        content: "9:41",
        fontFamily: "$font-caption",
        fontSize: 14,
        fontWeight: 600,
        fill: "$foreground-primary"
      },
      {
        type: "frame",
        id: id(),
        name: "Status Icons",
    metadata: { scaffold: "chrome" },
        layout: "horizontal",
        gap: 8,
        alignItems: "center",
        width: "fit_content",
        height: "fit_content",
        children: STATUS_ICONS.map(
          (icon) =>
            ({ type: "icon", id: id(), icon, width: 16, height: 16, stroke: "$foreground-primary" }) as PenNode
        )
      }
    ]
  } as PenNode;
  children.push(statusBar);

  const bleedId = id();
  const contentId = id();
  slots.bleed = bleedId;
  slots.content = contentId;
  children.push({
    type: "frame",
    id: bleedId,
    name: "Bleed Content",
    metadata: { scaffold: "slot" },
    width: "fill_container",
    height: "fill_container",
    layout: "vertical",
    gap: 24,
    children: [
      {
        type: "frame",
        id: contentId,
        name: "Inset Content",
    metadata: { scaffold: "slot" },
        width: "fill_container",
        height: "fit_content",
        layout: "vertical",
        padding: [0, 20],
        gap: 24,
        children: []
      } as PenNode
    ]
  } as PenNode);

  if (spec.tabs && spec.tabs.length > 0) {
    const barId = id();
    slots.tabBar = barId;
    children.push({
      type: "frame",
      id: id(),
      name: "Tab Bar Inset",
    metadata: { scaffold: "chrome" },
      width: "fill_container",
      height: "fit_content",
      layout: "vertical",
      padding: [0, 16, 12, 16],
      children: [
        {
          type: "frame",
          id: barId,
          name: "Tab Bar",
    metadata: { scaffold: "chrome" },
          width: "fill_container",
          height: TAB_BAR_HEIGHT,
          layout: "horizontal",
          justifyContent: "space_around",
          alignItems: "center",
          padding: 4,
          cornerRadius: TAB_BAR_HEIGHT / 2,
          fill: "$surface-secondary",
          children: spec.tabs.map((t) => tabItem(t, id))
        }
      ]
    } as PenNode);
  }

  return {
    type: "frame",
    id: slots.screen,
    name: spec.name,
    width: MOBILE_WIDTH,
    height: MOBILE_HEIGHT,
    layout: "vertical",
    justifyContent: "space_between",
    fill: "$surface-primary",
    clip: true,
    metadata: { screenKind: "mobile" },
    children
  } as FrameNode;
}

function desktopScreen(spec: ScreenSpec, id: () => string, slots: Record<string, string>): FrameNode {
  const topBar: PenNode = {
    type: "frame",
    id: id(),
    name: "Top Bar",
    metadata: { scaffold: "slot" },
    width: "fill_container",
    height: 64,
    layout: "horizontal",
    justifyContent: "space_between",
    alignItems: "center",
    padding: [0, 32],
    children: []
  } as PenNode;
  slots.topBar = topBar.id;

  const rail: PenNode = {
    type: "frame",
    id: id(),
    name: "Left Rail",
    metadata: { scaffold: "slot" },
    width: 260,
    height: "fill_container",
    layout: "vertical",
    padding: 20,
    gap: 8,
    children: []
  } as PenNode;
  slots.rail = rail.id;

  // The dominant region is the reason the screen exists, so it is the one that
  // takes the remaining width rather than a share of it.
  const main: PenNode = {
    type: "frame",
    id: id(),
    name: "Main",
    metadata: { scaffold: "slot" },
    width: "fill_container",
    height: "fill_container",
    layout: "vertical",
    padding: 32,
    gap: 24,
    children: []
  } as PenNode;
  slots.main = main.id;

  const aside: PenNode = {
    type: "frame",
    id: id(),
    name: "Right Rail",
    metadata: { scaffold: "slot" },
    width: 320,
    height: "fill_container",
    layout: "vertical",
    padding: 24,
    gap: 16,
    children: []
  } as PenNode;
  slots.aside = aside.id;

  return {
    type: "frame",
    id: slots.screen,
    name: spec.name,
    width: 1440,
    height: 1024,
    layout: "vertical",
    fill: "$surface-primary",
    clip: true,
    children: [
      topBar,
      {
        type: "frame",
        id: id(),
        name: "Body",
    metadata: { scaffold: "slot" },
        width: "fill_container",
        height: "fill_container",
        layout: "horizontal",
        children: [rail, main, aside]
      } as PenNode
    ]
  } as FrameNode;
}

export function buildScreen(spec: ScreenSpec, nextId: () => string): Scaffold {
  const slots: Record<string, string> = { screen: nextId() };
  const node = spec.kind === "desktop" ? desktopScreen(spec, nextId, slots) : mobileScreen(spec, nextId, slots);
  return { node, slots };
}
