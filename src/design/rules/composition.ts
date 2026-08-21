import type { LayoutNode } from "../../layout/types";
import type { TextNode, PenNode } from "../../model/types";
import { getLucideIconPath } from "../../model/icons";
import {
  type AuditFinding,
  type AuditContext,
  blocker,
  warning,
  walkEnabled,
  childrenOf,
  isScreen,
  isDescendant,
  hasImageFill,
  solidFillOf,
  INTERACTIVE_NAME,
  REGION_ROLES,
  SCREEN_CHROME_NAME
} from "../helpers";
import { MIN_TAP_TARGET } from "./constraints";

export function checkTapTargets(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  function walk(node: LayoutNode) {
    const data = ctx.nodes.get(node.id);
    if (data?.enabled === false) return;
    const named = INTERACTIVE_NAME.test(data?.name ?? "");
    if (named && node.box.width > 0 && node.box.height > 0) {
      const w = Math.round(node.box.width);
      const h = Math.round(node.box.height);
      if (w < MIN_TAP_TARGET || h < MIN_TAP_TARGET) {
        findings.push(
          warning(
            "tap_target",
            node.id,
            `"${data?.name ?? node.id}" measures ${w}x${h}px. A touch target needs ${MIN_TAP_TARGET}x${MIN_TAP_TARGET}px.`,
            `Grow the frame, or add padding so the hit area reaches ${MIN_TAP_TARGET}px while the icon stays its current size.`
          )
        );
      }
    }
    for (const child of node.children) walk(child);
  }
  for (const root of ctx.tree) walk(root);
  return findings;
}

export function checkDuplicateRegions(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  function screensOf(node: PenNode, out: PenNode[]) {
    if (isScreen(node) && node.enabled !== false) out.push(node);
    for (const child of childrenOf(node)) screensOf(child, out);
  }
  const screens: PenNode[] = [];
  ctx.doc.children.forEach((n) => screensOf(n, screens));

  for (const screen of screens) {
    for (const { role, pattern } of REGION_ROLES) {
      const matches: PenNode[] = [];
      function collect(node: PenNode) {
        if (node.enabled === false) return;
        if (node !== screen && pattern.test(node.name ?? "")) matches.push(node);
        for (const child of childrenOf(node)) collect(child);
      }
      collect(screen);

      // Keep only top-level matches of this role, filtering out nested children
      const topLevelMatches = matches.filter(
        (m) => !matches.some((other) => other !== m && isDescendant(m, other))
      );
      if (topLevelMatches.length > 1) {
        findings.push(
          blocker(
            "duplicate_region",
            topLevelMatches[1].id,
            `Screen "${screen.name ?? screen.id}" has ${topLevelMatches.length} ${role}s (${topLevelMatches.map((m) => m.name ?? m.id).join(", ")}). They stack on top of each other.`,
            `Delete the extra ${role} with delete_node. A screen has exactly one.`
          )
        );
      }
    }
  }
  return findings;
}

export function checkNestedScreens(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  function walk(node: PenNode, outerScreen: PenNode | undefined) {
    if (node.enabled === false) return;
    const screenHere = isScreen(node);
    if (screenHere && outerScreen) {
      findings.push(
        blocker(
          "nested_screen",
          node.id,
          `"${node.name ?? node.id}" is a screen built inside the screen "${outerScreen.name ?? outerScreen.id}". The outer frame grows to hold both.`,
          "Each screen is its own top-level frame on the canvas. Delete this node and insert it again with insert_node and no parentId."
        )
      );
    }
    for (const child of childrenOf(node)) walk(child, screenHere ? node : outerScreen);
  }
  ctx.doc.children.forEach((n) => walk(n, undefined));
  return findings;
}

export function checkEmptyContainers(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    if (node.type === "frame") {
      const kids = childrenOf(node);
      const visible = kids.filter((k) => k.enabled !== false);
      const resolved = ctx.boxes.get(node.id)?.box;
      if (visible.length > 0 && resolved) {
        if (resolved.width < 1 || resolved.height < 1) {
          findings.push(
            blocker(
              "collapsed_container",
              node.id,
              `Frame "${node.name ?? node.id}" resolves to ` +
                `${Math.round(resolved.width)}x${Math.round(resolved.height)}px while holding ` +
                `${visible.length} child${visible.length === 1 ? "" : "ren"}. Nothing inside it is visible.`,
              "Give it a width and height that can hold its children — a fixed size, fill_container or fit_content — or move the children to a parent that has one."
            )
          );
        }
      }
      const w = resolved?.width ?? (typeof node.width === "number" ? node.width : 0);
      const h = resolved?.height ?? (typeof node.height === "number" ? node.height : 0);
      const decorative = /(spacer|divider|indicator|rule|line|dot|track|bar)/i.test(node.name ?? "");
      if (kids.length === 0 && !hasImageFill(node) && w > 80 && h > 80 && !decorative) {
        findings.push(
          warning(
            "empty_container",
            node.id,
            `Frame "${node.name ?? node.id}" renders ${Math.round(w)}x${Math.round(h)}px with no children and no image fill.`,
            "Give it content, apply an image fill, or delete it. An empty box reads as an unfinished wireframe."
          )
        );
      }
    }
  });
  return findings;
}

export function checkCompositionExpectations(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const screen of ctx.doc.children) {
    if (!isScreen(screen) || screen.enabled === false) continue;
    const screenBox = ctx.boxes.get(screen.id)?.box;
    if (!screenBox || screenBox.height <= 0) continue;
    const screenHeight = screenBox.height;

    // 1. Missed bleed
    function findNamed(node: PenNode, name: RegExp): PenNode | undefined {
      if (name.test(node.name ?? "")) return node;
      for (const child of childrenOf(node)) {
        const found = findNamed(child, name);
        if (found) return found;
      }
      return undefined;
    }

    const inset = findNamed(screen, /^Inset Content$/i);
    if (inset) {
      const insetRoot = inset;
      walkEnabled([inset], (node) => {
        const box = ctx.boxes.get(node.id)?.box;
        if (
          hasImageFill(node) &&
          box &&
          box.height >= screenHeight * 0.4 &&
          (node === insetRoot || isDescendant(node, insetRoot))
        ) {
          findings.push(
            warning(
              "missed_bleed",
              node.id,
              `Image "${node.name ?? node.id}" is ${Math.round(box.height)}px tall (${Math.round((box.height / screenHeight) * 100)}% of the screen) but sits inside the inset content.`,
              "Move it to the Bleed Content slot as a sibling of Inset Content so the dominant image can reach the screen edges."
            )
          );
        }
      });
    }

    // 2. Missing display heading
    const contentType: number[] = [];
    function collectType(node: PenNode, chrome: boolean) {
      const nowChrome =
        chrome ||
        SCREEN_CHROME_NAME.test(node.name ?? "") ||
        /tab ?bar|bottom ?nav/i.test(node.name ?? "");
      if (!nowChrome && node.type === "text" && typeof (node as TextNode).fontSize === "number") {
        contentType.push((node as TextNode).fontSize!);
      }
      for (const child of childrenOf(node)) collectType(child, nowChrome);
    }
    collectType(screen, false);
    const largest = Math.max(0, ...contentType);
    if (largest > 0 && largest < 44) {
      findings.push(
        warning(
          "missing_display",
          screen.id,
          `Screen "${screen.name ?? screen.id}" tops out at ${largest}px; the display step starts at 44px.`,
          "Give the screen's main idea one 44-64px display treatment."
        )
      );
    }

    // 3. Empty tail
    const layoutRoot = ctx.tree.find((node) => node.id === screen.id);
    if (!layoutRoot) continue;
    const tab = layoutRoot.children.find((node) =>
      /tab ?bar|bottom ?nav/i.test(ctx.nodes.get(node.id)?.name ?? "")
    );
    if (!tab) continue;

    let lastBottom = 0;
    function lastVisible(node: LayoutNode, offsetY: number, excluded: boolean) {
      const data = ctx.nodes.get(node.id);
      if (!data || data.enabled === false) return;
      const nowExcluded =
        excluded ||
        SCREEN_CHROME_NAME.test(data.name ?? "") ||
        /tab ?bar|bottom ?nav/i.test(data.name ?? "");
      const y = offsetY + node.box.y;
      const structural = /^(Bleed|Inset) Content$/i.test(data.name ?? "");
      const fill = solidFillOf(data);
      const visible =
        node.id !== screen.id &&
        (data.type === "text" ||
          data.type === "icon" ||
          hasImageFill(data) ||
          (!structural && fill !== undefined && fill !== "$surface-primary"));
      if (!nowExcluded && visible) lastBottom = Math.max(lastBottom, y + node.box.height);
      for (const child of node.children) lastVisible(child, y, nowExcluded);
    }
    lastVisible(layoutRoot, 0, false);
    const tail = tab.box.y - lastBottom;
    if (lastBottom > 0 && tail > screenHeight * 0.15) {
      findings.push(
        warning(
          "empty_tail",
          screen.id,
          `Screen "${screen.name ?? screen.id}" leaves ${Math.round(tail)}px (${Math.round((tail / screenHeight) * 100)}%) empty before its tab bar.`,
          "Use that space deliberately: enlarge the dominant content, redistribute the layout, or shorten the screen's information architecture."
        )
      );
    }
  }

  return findings;
}

function textSignature(node: PenNode): string {
  const parts: string[] = [];
  walkEnabled([node], (n) => {
    if (n.type === "text") {
      const content = (n as TextNode).content;
      if (typeof content === "string" && content.trim()) parts.push(content.trim());
    }
  });
  return parts.join("\u0000");
}

const CLONE_MIN_TEXT = 2;

export function checkClonedContent(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    const kids = childrenOf(node).filter((c) => c.enabled !== false);
    if (kids.length > 1) {
      const groups = new Map<string, PenNode[]>();
      for (const kid of kids) {
        const sig = textSignature(kid);
        if (!sig || sig.split("\u0000").length < CLONE_MIN_TEXT) continue;
        const bucket = groups.get(sig);
        if (bucket) bucket.push(kid);
        else groups.set(sig, [kid]);
      }
      for (const [sig, clones] of groups) {
        if (clones.length < 2) continue;
        const excerpt = sig.split("\u0000").slice(0, 3).join(" / ");
        findings.push(
          warning(
            "cloned_content",
            clones[1].id,
            `${clones.length} siblings in "${node.name ?? node.id}" carry identical copy ("${excerpt}"). The list repeats one entry instead of showing ${clones.length}.`,
            "Give each one the content a real instance would hold. With place_instances, pass a descendants override per item; otherwise set the differing text with batch_set_properties."
          )
        );
      }
    }
  });
  return findings;
}

export function checkIconGeometry(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    const icon = node as PenNode & { icon?: string; geometry?: string };
    if (node.type === "icon" && typeof icon.icon === "string" && icon.icon.trim()) {
      if (!icon.geometry && !getLucideIconPath(icon.icon)) {
        findings.push(
          blocker(
            "icon_unresolved",
            node.id,
            `Icon "${icon.icon}" on ${node.id} carries no geometry and is not a core icon. It paints the generic fallback glyph, not the icon you asked for.`,
            `Re-set it with insert_icon, or set the icon property again so the geometry is resolved. If "${icon.icon}" is not a real Lucide name, use search_icons to find one that is.`
          )
        );
      }
    }
  });
  return findings;
}

function isStatTile(node: PenNode): boolean {
  const kids = childrenOf(node).filter((c) => c.enabled !== false);
  const texts = kids.filter((c) => c.type === "text") as TextNode[];
  if (kids.length !== texts.length || texts.length !== 2) return false;
  const sizes = texts.map((t) => t.fontSize ?? 0).sort((a, b) => b - a);
  return sizes[0] >= 24 && sizes[1] > 0 && sizes[1] <= 14;
}

export function checkStatTileRow(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  function substantive(node: PenNode): boolean {
    return node.type !== "text" && !SCREEN_CHROME_NAME.test(node.name ?? "");
  }

  function openingRows(screen: PenNode): PenNode[] {
    const top = childrenOf(screen).filter(substantive);
    const first = top[0];
    if (!first) return [];
    return [first, ...childrenOf(first).filter(substantive).slice(0, 1)];
  }

  for (const screen of ctx.doc.children) {
    if (!isScreen(screen)) continue;
    for (const row of openingRows(screen)) {
      const tiles = childrenOf(row).filter((c) => c.enabled !== false);
      if (tiles.length < 3 || !tiles.every(isStatTile)) continue;
      findings.push(
        warning(
          "stat_tile_row",
          row.id,
          `"${screen.name ?? screen.id}" opens with ${tiles.length} identical metric tiles — a big number over a small label, repeated. That is the stock dashboard hero.`,
          "Lead with the thing the reader came for: the one number that changes a decision at display size, or the queue of items needing attention. Metric tiles can follow it."
        )
      );
      break;
    }
  }

  return findings;
}
