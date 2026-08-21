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
 * carries, and every element inside the content slot.
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
  // Not $foreground-muted. An 11px label in muted measures 3.25:1 against the
  // secondary surface in the worst palette, below the 4.5:1 small text needs.
  // Secondary clears it in all twelve, worst case 6.73:1.
  const tone = tab.active ? "$accent-primary" : "$foreground-secondary";
  return {
    type: "frame",
    id: id(),
    name: `Tab ${tab.label}`,
    layout: "vertical",
    gap: 4,
    justifyContent: "center",
    alignItems: "center",
    width: "fill_container",
    // Fills the bar's inner height. Sized to its content it came to 39px, under
    // the 44px a finger needs, on every tab of every screen.
    height: "fill_container",
    children: [
      { type: "icon", id: id(), icon: tab.icon, width: 22, height: 22, stroke: tone },
      {
        type: "text",
        id: id(),
        content: tab.label,
        fontFamily: "$font-caption",
        fontSize: 11,
        fill: tone,
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

  // One wrapper owns the horizontal padding. Nothing below it adds more, which
  // is what keeps every element on the screen sharing one left edge.
  const contentId = id();
  slots.content = contentId;
  children.push({
    type: "frame",
    id: contentId,
    name: "Content",
    width: "fill_container",
    height: "fit_content",
    layout: "vertical",
    padding: [0, 20],
    gap: 24,
    children: []
  } as PenNode);

  if (spec.tabs && spec.tabs.length > 0) {
    const barId = id();
    slots.tabBar = barId;
    children.push({
      type: "frame",
      id: id(),
      name: "Tab Bar Inset",
      width: "fill_container",
      height: "fit_content",
      layout: "vertical",
      padding: [0, 16, 12, 16],
      children: [
        {
          type: "frame",
          id: barId,
          name: "Tab Bar",
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
