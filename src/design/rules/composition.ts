import type { LayoutNode } from "../../layout/types";
import type { TextNode, PenNode } from "../../model/types";
import { parseSizing } from "../../model/parse";
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
  contrastRatio,
  boxesOverlap,
  INTERACTIVE_NAME,
  REGION_ROLES,
  SCREEN_CHROME_NAME
} from "../helpers";
import { MIN_TAP_TARGET } from "./constraints";
import {
  SEVERE_CROP,
  croppedFraction,
  nearestGeneratedAspect,
  servableHeights,
  isPanoramicBanner
} from "../photography";
import { normalisePadding } from "../../layout/padding";

export function checkTapTargets(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  function walk(node: LayoutNode, interactiveAncestor = false) {
    const data = ctx.nodes.get(node.id);
    if (data?.enabled === false) return;
    const named = INTERACTIVE_NAME.test(data?.name ?? "");
    if (named && !interactiveAncestor && node.box.width > 0 && node.box.height > 0) {
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
    for (const child of node.children) walk(child, interactiveAncestor || named);
  }
  for (const root of ctx.tree) walk(root);
  return findings;
}

export function checkDuplicateRegions(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const screens: PenNode[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    if (isScreen(node)) screens.push(node);
  });

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

/** Below this, a fill and the surface behind it are the same colour to the eye. */
const SERIES_MIN_CONTRAST = 1.5;

/**
 * A data series painted in a colour that cannot be seen against its own card.
 *
 * checkContrast measures text and only text, so a chart — which is frames, not
 * text — was never checked at all. Two of the four bar charts in the logs
 * paint seven of eight bars in '$border-subtle' on a '$surface-secondary'
 * card: 1.3:1, bars with genuinely varied heights that render as one flat
 * slab. Both shipped with a clean audit, and one was scored 5/5 for hierarchy
 * and usability by a critic that called it "a proportional throughput chart".
 *
 * The series is identified by shape rather than by name: four or more painted
 * childless siblings of equal width in a row (or equal height in a column) is
 * a chart, a meter, or a segmented gauge — never a layout. Requiring uniformity
 * on the main axis is what keeps a row of cards or nav pills out of it, and
 * requiring four keeps a pair of buttons out.
 */
export function checkUndrawnSeries(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  function walk(node: PenNode, surface: string | undefined): void {
    if (node.enabled === false) return;
    const here = solidFillOf(node) ?? surface;
    const kids = childrenOf(node).filter((c) => c.enabled !== false);
    const layout = (node as any).layout;

    if (node.type === "frame" && (layout === "horizontal" || layout === "vertical") && kids.length >= 4) {
      const members = kids.filter(
        (k) =>
          (k.type === "frame" || k.type === "rectangle") &&
          childrenOf(k).length === 0 &&
          typeof (k as any).fill === "string"
      );
      const boxes = members.map((k) => ctx.boxes.get(k.id)?.box);
      const main = layout === "horizontal" ? "width" : "height";
      const spans = boxes.map((b) => (b ? Math.round(b[main]) : -1));
      const sized = boxes.every((b) => b && b.width >= 2 && b.height >= 2);
      // Uniform along the axis they are laid out on: the bars of a chart share
      // a width and differ in height. Anything varying on both axes is a
      // layout, not a series, and this rule has no business in it.
      if (members.length === kids.length && sized && new Set(spans).size === 1 && here) {
        const dim = members.filter((k) => {
          const ratio = contrastRatio((k as any).fill as string, here, ctx.doc.variables);
          return ratio !== null && ratio < SERIES_MIN_CONTRAST;
        });
        if (dim.length >= members.length - 1) {
          findings.push(
            warning(
              "undrawn_series",
              node.id,
              `${dim.length} of the ${members.length} elements in "${node.name ?? node.id}" are filled with ${[...new Set(dim.map((d) => String((d as any).fill)))].join(", ")}, under ${SERIES_MIN_CONTRAST}:1 against the ${here} behind them. The series renders, but reads as one flat block.`,
              "Paint the series in something that separates from its card: $accent-primary for the live values, $accent-secondary or $foreground-muted for comparison. A border token is for borders."
            )
          );
        }
      }
    }

    for (const child of kids) walk(child, here);
  }

  for (const root of ctx.doc.children) walk(root, solidFillOf(root));
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
          "Each screen is its own top-level frame on the canvas. Move this screen to the canvas with move_node(id, newParentId: 'canvas'), or delete the inner duplicate status bar."
        )
      );
    }
    for (const child of childrenOf(node)) walk(child, screenHere ? node : outerScreen);
  }
  ctx.doc.children.forEach((n) => walk(n, undefined));
  return findings;
}

/**
 * Anything painted that renders at zero size.
 *
 * The audit had no rule for a leaf: collapsed_container only looks at frames
 * that hold children, on the reasoning that an empty box hides nothing. That
 * is false for exactly the nodes a data-dense screen is made of. A progress
 * fill, a chart bar, an icon and a status dot are all childless, and all of
 * them are the content.
 *
 * Six logged runs shipped 63 of these — eleven progress bars sized in
 * percentages the engine reads as zero, and fifty icons written with `size`
 * instead of width and height — every one of them under a clean audit, most
 * of them beside a label stating the value the bar was supposed to draw. The
 * tools now resolve both of those at the write, so this is the backstop rather
 * than the fix: a blocker, because a design whose data does not render is
 * broken in the way a user sees first.
 */
export function checkInvisibleNodes(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    if (node.type === "text" || node.type === "group") return;
    if (childrenOf(node).some((c) => c.enabled !== false)) return;
    const paint = (node as any).fill ?? (node as any).stroke ?? (node as any).geometry;
    if (paint === undefined || paint === null) return;
    const box = ctx.boxes.get(node.id)?.box;
    if (!box) return;
    if (box.width >= 1 && box.height >= 1) return;

    const axis = box.width < 1 ? "width" : "height";
    const written = (node as any)[axis];
    // The written value is the useful half of this: "0px wide" is a symptom,
    // `width: "82%"` is the cause, and naming it is the difference between a
    // finding the model can act on and one it has to investigate.
    const cause =
      written === undefined
        ? `no ${axis} is set`
        : `${axis} is ${JSON.stringify(written)}, which the engine resolves to 0`;
    findings.push(
      blocker(
        "invisible_node",
        node.id,
        `"${node.name ?? node.id}" is painted but renders ${Math.round(box.width)}x${Math.round(box.height)}px — ${cause}. Nothing of it is on screen.`,
        `Set ${axis} to a number of pixels, or to 'fill_container' if it should take the space its parent gives it. Percentages are not sizes the engine has.`
      )
    );
  });
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

      // Check if this is an empty image placeholder well inside a card / item container
      const parent = ctx.parents.get(node.id);
      const isInsideCardWithText = parent && parent.type === "frame" && textCount(parent) >= 1;
      const isCardImageWell = isInsideCardWithText && kids.length === 0 && !hasImageFill(node) && w >= 40 && h >= 40 && !decorative;

      if (isCardImageWell) {
        findings.push(
          blocker(
            "missing_product_image",
            node.id,
            `Card "${parent.name ?? parent.id}" contains a blank ${Math.round(w)}x${Math.round(h)}px placeholder box "${node.name ?? node.id}" with no image fill.`,
            "Apply a generated product photograph or visual illustration fill using generate_image."
          )
        );
      } else if (kids.length === 0 && !hasImageFill(node) && w > 60 && h > 60 && !decorative) {
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

/**
 * The bars the engine supplies. Everything inside one is chrome as well — the
 * clock, the signal icons, the tab labels — so the whole subtree is skipped.
 */
const SCAFFOLD_CHROME_NAME = /^(status bar|status icons|tab ?bar( inset)?|bottom ?nav|home indicator|tab .+)$/i;

/**
 * The empty slots create_screen hands back. The frame itself is scaffold, but
 * its children are precisely where content belongs, so this does not carry
 * down — that is the difference between a screen that is still empty and one
 * that has been filled through the slots it was given.
 */
const SCAFFOLD_SLOT_NAME = /^(inset content|bleed content|content|body|top ?bar|(left |right )?rail|aside|main|safe area)$/i;

/**
 * What part of the scaffold a node is, if any.
 *
 * The tag is the answer; the names are a fallback for documents written before
 * create_screen started stamping one, and for a slot the model reparented by
 * hand. Matching on names alone was the weak point: a model free to rename
 * anything could call its own list "Content" — harmless — or rename the tab bar,
 * at which point its icons and labels would count as content and a screen with
 * nothing on it would score a pass. That is the exact failure this rule exists
 * to catch, so it should not turn on what the model chose to call something.
 */
function scaffoldRole(node: PenNode): "chrome" | "slot" | undefined {
  const tagged = node.metadata?.scaffold;
  if (tagged === "chrome" || tagged === "slot") return tagged;
  const name = node.name ?? "";
  if (SCAFFOLD_CHROME_NAME.test(name)) return "chrome";
  if (SCAFFOLD_SLOT_NAME.test(name)) return "slot";
  return undefined;
}

/**
 * Returns true as soon as any user-authored content is found inside the screen.
 * Short-circuits immediately on the first non-scaffold element.
 */
function hasScreenContent(node: PenNode): boolean {
  if (node.enabled === false) return false;
  const role = scaffoldRole(node);
  if (role === "chrome") return false;

  if (role !== "slot") {
    if (node.type === "text") {
      if ((node as TextNode).content?.trim()) return true;
    } else if (node.type !== "frame" && node.type !== "group") {
      return true;
    } else if (hasImageFill(node)) {
      return true;
    }
  }

  for (const child of childrenOf(node)) {
    if (hasScreenContent(child)) return true;
  }
  return false;
}

/**
 * A screen that is still nothing but the frame create_screen handed back.
 *
 * This is the rule that was missing, and the gap it left is the largest one the
 * audit has had. A run built four screens with create_screen, announced that it
 * would "place real content into each", was cut off before it could, and
 * finished with a status bar and a tab bar per screen and nothing between them.
 * The audit scored that canvas 0 blockers, 0 warnings, 0 info — a clean pass —
 * so the completion check had nothing to send back and the run ended.
 *
 * Nothing else covers it. empty_container needs a box over 80x80, and an empty
 * content slot is fit_content, so it measures zero and slips under the floor.
 * collapsed_container needs children to be hiding. The finishing rules all
 * measure content, and there is none. Each rule was looking at something real;
 * the case where a screen holds nothing at all was between all of them.
 */
export function checkScaffoldOnlyScreens(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const screen of ctx.doc.children) {
    if (!isScreen(screen) || screen.enabled === false) continue;

    if (!hasScreenContent(screen)) {
      findings.push(
        blocker(
          "scaffold_only",
          screen.id,
          `Screen "${screen.name ?? screen.id}" holds nothing but the frame create_screen returned — ` +
            "its status bar and tab bar and empty slots. There is no content on it.",
          "Fill the slots create_screen returned. insert_node takes a whole subtree in one call, so build the screen's content and put it in the content or bleed slot."
        )
      );
    }
  }
  return findings;
}

const DESKTOP_FILL_SLOTS = [
  { pattern: /^Main$/i, role: "Main" },
  { pattern: /^Right Rail$/i, role: "Right Rail" }
] as const;

const EMPTY_COLUMN_FRACTION = 0.18;
const EMPTY_COLUMN_MIN_PX = 80;
const EMPTY_COLUMN_MIN_HEIGHT = 240;

function layoutNamed(
  node: LayoutNode,
  pattern: RegExp,
  nodes: Map<string, PenNode>
): LayoutNode | undefined {
  if (pattern.test(nodes.get(node.id)?.name ?? "")) return node;
  for (const child of node.children) {
    const found = layoutNamed(child, pattern, nodes);
    if (found) return found;
  }
  return undefined;
}

function contentBottom(slot: LayoutNode): number {
  function extent(node: LayoutNode): number {
    let bottom = node.box.height;
    for (const child of node.children) {
      bottom = Math.max(bottom, child.box.y + extent(child));
    }
    return bottom;
  }
  let last = 0;
  for (const child of slot.children) {
    last = Math.max(last, child.box.y + extent(child));
  }
  return last;
}

function slotHasSubjectImage(
  slot: LayoutNode,
  ctx: AuditContext,
  screenArea: number
): boolean {
  const minArea = screenArea * 0.15;
  function walk(node: LayoutNode): boolean {
    const data = ctx.nodes.get(node.id);
    if (data && hasImageFill(data)) {
      const area = node.box.width * node.box.height;
      if (area >= minArea) return true;
    }
    return node.children.some(walk);
  }
  return walk(slot);
}

export function checkCompositionExpectations(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const screen of ctx.doc.children) {
    if (!isScreen(screen) || screen.enabled === false) continue;
    const screenBox = ctx.boxes.get(screen.id)?.box;
    if (!screenBox || screenBox.height <= 0) continue;
    const screenHeight = screenBox.height;
    const screenWidth = screenBox.width;

    // 1. Missed bleed vs Edge-to-edge corner radius discipline
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
        const r = node.cornerRadius;
        const hasRadius = typeof r === "number" ? r > 0 : Array.isArray(r) && r.some((v) => typeof v === "number" && v > 0);
        if (
          hasImageFill(node) &&
          !hasRadius &&
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

    // Edge-to-edge containers must have cornerRadius: 0
    walkEnabled([screen], (node) => {
      if (node === screen) return;
      const box = ctx.boxes.get(node.id)?.box;
      if (!box) return;

      const r = node.cornerRadius;
      const hasRadius = typeof r === "number" ? r > 0 : Array.isArray(r) && r.some((v) => typeof v === "number" && v > 0);
      const isEdgeToEdge = box.x <= 2 && box.width >= screenWidth - 4;

      if (isEdgeToEdge && hasRadius && (hasImageFill(node) || node.type === "frame")) {
        findings.push(
          warning(
            "radius_scale",
            node.id,
            `"${node.name ?? node.id}" spans edge-to-edge (${Math.round(box.width)}px) but has rounded corners (cornerRadius: ${Array.isArray(r) ? r.join(",") : r}). Edge-to-edge elements must have cornerRadius: 0.`,
            "Set cornerRadius: 0 for a flush edge-to-edge bleed container, or place it inside Inset Content with side margins for a rounded card."
          )
        );
      }
    });

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
    const displayFloor = screenWidth <= 500 ? 32 : 44;
    if (largest > 0 && largest < displayFloor) {
      findings.push(
        warning(
          "missing_display",
          screen.id,
          `Screen "${screen.name ?? screen.id}" tops out at ${largest}px; this ${screenWidth <= 500 ? "mobile" : "desktop"} composition needs a ${displayFloor}px hierarchy step.`,
          screenWidth <= 500
            ? "Give the screen's main idea one 32–40px title treatment; reserve 44px+ for an intentionally editorial mobile composition."
            : "Give the screen's main idea one 44–64px display treatment."
        )
      );
    }

    // 3. Empty tail (mobile) / empty column (desktop)
    const layoutRoot = ctx.tree.find((node) => node.id === screen.id);
    if (!layoutRoot) continue;
    const tab = layoutRoot.children.find((node) =>
      /tab ?bar|bottom ?nav/i.test(ctx.nodes.get(node.id)?.name ?? "")
    );
    if (tab) {
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
      if (lastBottom > 0 && tail > Math.max(80, screenHeight * 0.05)) {
        findings.push(
          warning(
            "empty_tail",
            screen.id,
            `Screen "${screen.name ?? screen.id}" leaves ${Math.round(tail)}px (${Math.round((tail / screenHeight) * 100)}%) empty before its tab bar.`,
            "Use that space deliberately: enlarge the dominant content, redistribute the layout, or shorten the screen's information architecture."
          )
        );
      }
    } else {
      const hSizing = parseSizing(screen.height);
      if (hSizing.mode === "fixed" && screenHeight > 1000) {
        let lastBottom = 0;
        function lastContent(node: LayoutNode, offsetY: number) {
          const data = ctx.nodes.get(node.id);
          if (!data || data.enabled === false) return;
          const y = offsetY + node.box.y;
          const structural = /^(Bleed|Inset) Content|Body$/i.test(data.name ?? "");
          const fill = solidFillOf(data);
          const visible =
            node.id !== screen.id &&
            (data.type === "text" ||
              data.type === "icon" ||
              hasImageFill(data) ||
              (!structural && fill !== undefined && fill !== "$surface-primary"));
          if (visible) lastBottom = Math.max(lastBottom, y + node.box.height);
          for (const child of node.children) lastContent(child, y);
        }
        lastContent(layoutRoot, 0);
        const unused = screenHeight - lastBottom;
        if (lastBottom > 0 && unused > 400 && unused > screenHeight * 0.25) {
          findings.push(
            warning(
              "empty_tail",
              screen.id,
              `Screen "${screen.name ?? screen.id}" is ${Math.round(screenHeight)}px tall but content ends at ${Math.round(lastBottom)}px, leaving a ${Math.round(unused)}px empty void.`,
              "Set height: 'fit_content' so the page dynamically hugs its content, or add the remaining sections."
            )
          );
        }
      }
    }

    const isDesktop =
      screen.metadata?.screenKind === "desktop" || screenWidth >= 1200;
    if (isDesktop) {
      for (const { pattern, role } of DESKTOP_FILL_SLOTS) {
        const slot = layoutNamed(layoutRoot, pattern, ctx.nodes);
        if (!slot || slot.box.height < EMPTY_COLUMN_MIN_HEIGHT) continue;
        const lastBottom = contentBottom(slot);
        if (lastBottom <= 0) continue;
        const unused = slot.box.height - lastBottom;
        if (unused < EMPTY_COLUMN_MIN_PX) continue;
        if (unused <= slot.box.height * EMPTY_COLUMN_FRACTION) continue;
        if (slotHasSubjectImage(slot, ctx, screenWidth * screenHeight)) continue;
        findings.push(
          warning(
            "empty_column",
            slot.id,
            `"${role}" leaves ${Math.round(unused)}px (${Math.round((unused / slot.box.height) * 100)}%) empty at the bottom of a ${Math.round(slot.box.height)}px column.`,
            "If this is a dense tool, give the last region height: 'fill_container'. If this is a place or a page, leave the field — do not invent widgets to fill it."
          )
        );
      }
    }

    let largestImageArea = 0;
    let imageCount = 0;
    walkEnabled([screen], (node) => {
      if (!hasImageFill(node)) return;
      const box = ctx.boxes.get(node.id)?.box;
      if (!box || (box.width < 80 && box.height < 80)) return;
      imageCount += 1;
      largestImageArea = Math.max(largestImageArea, box.width * box.height);
    });
    const viewportHeight = Math.min(screenHeight, 900);
    const viewportArea = screenWidth * viewportHeight;
    if (imageCount > 0 && largestImageArea < viewportArea * 0.18) {
      findings.push(
        warning(
          "undersized_subject",
          screen.id,
          `Screen "${screen.name ?? screen.id}" has photography, but the largest image covers ${Math.round((largestImageArea / viewportArea) * 100)}% of the viewport.`,
          "Enlarge the subject photograph enough to reach roughly 18–25% of the first viewport, while keeping its enclosing mobile hero within a 220–380px total height. A thumbnail strip above a card grid is not a hero."
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

/** Nothing smaller than this reads as photography; avatars and chips are not the subject. */
const PHOTO_MIN_SIDE = 40;

/**
 * A photograph in a frame no photograph can fill.
 *
 * generate_image picks from three aspect ratios and the canvas paints the
 * result with cover, so a frame matching none of the three loses the
 * difference off the edges. Under a third that reads as framing. Over it the
 * subject starts leaving the picture: one logged run resized a phone hero to
 * 390x1320 for an overlay composition, regenerated the photograph into it, then
 * undid the overlay — and shipped a courtyard rendered as a vertical sliver.
 *
 * The frame is the thing to fix here, not the prompt. Regenerating into the
 * same box returns the same crop.
 */
export function checkPhotographCrop(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    if (!hasImageFill(node)) return;
    const box = ctx.boxes.get(node.id)?.box;
    if (!box || box.width < PHOTO_MIN_SIDE || box.height < PHOTO_MIN_SIDE) return;

    if (isPanoramicBanner(box.width, box.height)) return;

    const ratio = box.width / box.height;
    // Standard web/mobile card and split hero ratios (0.45 to 2.8) are normal UI patterns
    if (ratio >= 0.45 && ratio <= 2.8) return;

    const chosen = nearestGeneratedAspect(ratio);
    const lost = croppedFraction(ratio, chosen.ratio);
    if (lost <= SEVERE_CROP) return;

    const w = Math.round(box.width);
    const h = Math.round(box.height);
    findings.push(
      warning(
        "cropped_photography",
        node.id,
        `"${node.name ?? node.id}" holds a photograph in a ${w}x${h} frame — ${ratio.toFixed(2)}:1. ` +
          `Photographs come back as 16:9, 1:1 or 3:4 and are painted cover, so ${Math.round(lost * 100)}% ` +
          `of this one is cropped away off the edges.`,
        `Resize the frame to a shape a photograph fits — ${servableHeights(box.width, ratio)} — rather than ` +
          `regenerating, which returns the same crop. If the tall or wide band is the composition, put the ` +
          `photograph in a frame that fits and let the remaining space carry copy.`
      )
    );
  });
  return findings;
}

function getContentSections(screen: PenNode, ctx: AuditContext): PenNode[] {
  const sections: PenNode[] = [];

  function walk(node: PenNode) {
    if (node.enabled === false) return;
    const role = scaffoldRole(node);
    if (role === "chrome") return;

    // If this is a scaffold slot (Inset Content, Bleed Content) or top-level content wrapper
    const isSlotOrWrapper =
      role === "slot" ||
      /^Inset Content|^Bleed Content|^Home Content|^Main Content|^Page Content|^Feed Content|^Storefront Content/i.test(node.name ?? "");

    if (isSlotOrWrapper) {
      for (const child of childrenOf(node)) {
        walk(child);
      }
      return;
    }

    const box = ctx.boxes.get(node.id)?.box;
    const screenBox = ctx.boxes.get(screen.id)?.box;
    const screenWidth = screenBox ? screenBox.width : 390;

    // Check if node is a wrapper around multiple major full-width sub-sections
    const kids = childrenOf(node).filter((c) => c.enabled !== false && scaffoldRole(c) !== "chrome");
    if (
      box &&
      box.width >= screenWidth * 0.7 &&
      kids.length >= 2 &&
      kids.filter((k) => (ctx.boxes.get(k.id)?.box?.height ?? 0) >= 70).length >= 2
    ) {
      for (const child of kids) {
        walk(child);
      }
      return;
    }

    if (box && box.height >= 40) {
      sections.push(node);
    }
  }

  for (const child of childrenOf(screen)) {
    walk(child);
  }
  return sections;
}

export function checkSectionHeightBudget(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const screen of ctx.doc.children) {
    if (!isScreen(screen) || screen.enabled === false) continue;
    const screenBox = ctx.boxes.get(screen.id)?.box;
    if (!screenBox) continue;
    const isMobile = screenBox.width <= 500;
    const viewportFloor = isMobile ? 844 : 900;
    const isScrollable = screenBox.height > viewportFloor + 40;

    const screenKids = getContentSections(screen, ctx);

    // 1. Check for False Floor / Missing Scroll Affordance on multi-section scrollable pages
    if (isScrollable) {
      // A 70px status/search bar is chrome-adjacent. A thin quote or divider
      // (~80px) is not the next section the fold should reveal — 3fbe82f2's
      // black quote peeked while rooms and pricing sat below 900px.
      const SUBSTANTIVE_PEEK = 160;
      const substantiveSections = screenKids.filter((c) => {
        const b = ctx.boxes.get(c.id)?.box;
        return b && b.height >= SUBSTANTIVE_PEEK;
      });

      if (substantiveSections.length >= 2) {
        const firstSec = substantiveSections[0];
        const secondSec = substantiveSections[1];
        const firstBox = ctx.boxes.get(firstSec.id)?.box;
        const secondAbsBox = ctx.absBoxes.get(secondSec.id);
        const screenAbsBox = ctx.absBoxes.get(screen.id);

        if (firstBox && secondAbsBox && screenAbsBox) {
          const secondYRelative = secondAbsBox.y - screenAbsBox.y;
          // If the second section starts after (viewportFloor - 40px), it is completely hidden below the fold
          if (secondYRelative >= viewportFloor - 40) {
            findings.push(
              blocker(
                "false_floor",
                firstSec.id,
                `Section "${firstSec.name ?? firstSec.id}" is ${Math.round(firstBox.height)}px tall and pushes "${secondSec.name ?? secondSec.id}" completely below the ${viewportFloor}px fold (starts at y: ${Math.round(secondYRelative)}px). This creates a false floor (illusion of completeness) concealing the rest of the page.`,
                `Shorten "${firstSec.name ?? firstSec.id}" (${isMobile ? "220px–340px" : "so the first viewport is compact"}) so the top of "${secondSec.name ?? secondSec.id}" peeks above the ${viewportFloor}px fold. Do not delete Main or any create_screen slot.`
              )
            );
          }
        }
      }
    }

    // 2. Check for monolithic single-card height bloat in vertical flow.
    // A scrolling desktop site is a stack of narrative bands; 650px of photo
    // story is rhythm. 9aa7670e treated those bands as cards that had to shrink
    // to 380–520px, then the revision deleted Main. false_floor already catches
    // a hero that hides the next section.
    if (isScrollable && !isMobile) continue;

    const maxHeightBudget = isMobile ? 380 : 600;
    const recommended = isMobile ? "220px–340px" : "380px–520px";

    for (const child of screenKids) {
      const box = ctx.boxes.get(child.id)?.box;
      if (!box || box.height <= maxHeightBudget) continue;

      const isMedia = hasImageFill(child);
      const isCard = child.type === "frame" || child.type === "group";
      if (!isMedia && !isCard) continue;

      // Allow actual collections, not every frame that happens to contain two
      // structural frames. A hero commonly contains a photo well and an action
      // row; treating those as two "cards" hid the oversized hero entirely.
      const subCards = childrenOf(child).filter(
        (c) => (c.type === "frame" || c.type === "rectangle") && c.enabled !== false
      );
      const namedCollection = /(product|catalog|menu|collection|grid|list|cards|items|drops|spaces|amenities)/i.test(
        child.name ?? ""
      );
      const repeatedCardChildren =
        subCards.length >= 2 &&
        subCards.every((c) => /(card|item|product|tile|row|space|amenity)/i.test(c.name ?? ""));
      const isCollectionSection = namedCollection || repeatedCardChildren;
      if (isCollectionSection) continue;

      const isBlocker = isMobile;
      const message = isMobile
        ? `Hero/Feature card "${child.name ?? child.id}" is ${Math.round(box.height)}px tall in a mobile screen (${Math.round((box.height / 844) * 100)}% of the 844px fold), monopolizing the initial viewport.`
        : `"${child.name ?? child.id}" is ${Math.round(box.height)}px tall in a vertical flow screen, consuming ${Math.round((box.height / 900) * 100)}% of the initial viewport and pushing page content off-screen.`;

      const fix = `Make the card compact (${recommended}) by sizing its image well appropriately so the page maintains breathable rhythm.`;

      findings.push(
        isBlocker
          ? blocker("oversized_section_height", child.id, message, fix)
          : warning("oversized_section_height", child.id, message, fix)
      );
    }
  }
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

function textCount(node: PenNode): number {
  let n = 0;
  walkEnabled([node], (child) => {
    if (child.type === "text" && (child as TextNode).content?.trim()) n += 1;
  });
  return n;
}

export function checkCatalogCardRow(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const tallSites = new Set(
    ctx.doc.children
      .filter((n) => isScreen(n) && (ctx.boxes.get(n.id)?.box.height ?? 0) > 1400)
      .map((n) => n.id)
  );

  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "frame" || (node as { layout?: string }).layout !== "horizontal") return;
    if (SCREEN_CHROME_NAME.test(node.name ?? "")) return;
    if (tallSites.has(node.id) || Array.from(tallSites).some((id) => {
      const site = ctx.nodes.get(id);
      return site && isDescendant(node, site);
    })) return;
    const kids = childrenOf(node).filter((c) => c.enabled !== false && c.type === "frame");
    if (kids.length < 3) return;
    const boxes = kids.map((k) => ctx.boxes.get(k.id)?.box).filter((b): b is NonNullable<typeof b> => !!b);
    if (boxes.length !== kids.length) return;
    const widths = boxes.map((b) => b.width);
    const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
    if (mean < 80) return;
    if (widths.some((w) => Math.abs(w - mean) / mean > 0.25)) return;
    if (!kids.every((k) => textCount(k) >= 3)) return;
    findings.push(
      warning(
        "catalog_row",
        node.id,
        `"${node.name ?? node.id}" is ${kids.length} equal cards in a row — title, blurb and a number, repeated. That is a catalog strip, not a page.`,
        "Lead with one featured thing, or turn the set into hairline rows. Three equal cards should not be the layout."
      )
    );
  });
  return findings;
}

function isChipLikeChild(node: PenNode): boolean {
  if (node.type === "icon" || node.type === "text" || node.type === "ellipse") return true;
  if (node.type !== "frame" && node.type !== "rectangle") return false;
  if (childrenOf(node).some((c) => c.enabled !== false)) return false;
  return true;
}

export function checkUncenteredIconButtons(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "frame") return;
    const kids = childrenOf(node).filter((c) => c.enabled !== false);
    if (kids.length < 1 || kids.length > 3) return;
    if (!kids.every(isChipLikeChild)) return;

    const frameLayout = ctx.boxes.get(node.id);
    const frameBox = frameLayout?.box;
    if (!frameLayout || !frameBox || frameBox.width <= 0 || frameBox.height <= 0) return;
    // A fill-width nav row is supposed to start-align. Chips and icon wells
    // are compact; past this they are rows.
    if (frameBox.width > 220) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of frameLayout.children) {
      minX = Math.min(minX, child.box.x);
      minY = Math.min(minY, child.box.y);
      maxX = Math.max(maxX, child.box.x + child.box.width);
      maxY = Math.max(maxY, child.box.y + child.box.height);
    }
    if (!Number.isFinite(minX)) return;

    const pad = normalisePadding(node.padding);
    const leftSpace = minX - pad.left;
    const rightSpace = frameBox.width - pad.right - maxX;
    const topSpace = minY - pad.top;
    const bottomSpace = frameBox.height - pad.bottom - maxY;
    const horizontalOffset = Math.abs(leftSpace - rightSpace);
    const verticalOffset = Math.abs(topSpace - bottomSpace);
    if (horizontalOffset < 4 && verticalOffset < 4) return;

    const radius = node.cornerRadius;
    const isPillOrCircle =
      (typeof radius === "number" && radius >= 8) ||
      (Array.isArray(radius) && radius.some((r) => typeof r === "number" && r >= 8));
    const isSquare =
      Math.abs(frameBox.width - frameBox.height) <= 12 && frameBox.width <= 80;
    if (!isSquare && !isPillOrCircle && !INTERACTIVE_NAME.test(node.name ?? "")) return;

    findings.push(
      warning(
        "icon_alignment",
        node.id,
        `Chip "${node.name ?? node.id}" (${Math.round(frameBox.width)}x${Math.round(frameBox.height)}px) holds its contents in a corner instead of centered.`,
        "Set layout: 'horizontal', justifyContent: 'center', alignItems: 'center', and size the chip with fit_content plus padding rather than a large fixed box."
      )
    );
  });

  return findings;
}

/**
 * A metric, not a heading: "24 / 28", "91.6%", "184", "00:14:32", "412 kW".
 *
 * A small label above a big number is a stat tile, which is the correct way to
 * build a KPI and the shape rule 11 explicitly allows in dashboards. A small
 * label above a sentence is a marketing eyebrow, which is what the rule is for.
 * The check could not tell them apart and so fired on every KPI it saw: 31 of
 * its findings across the logs, four of them on one factory dashboard whose
 * tiles read ACTIVE UNITS / THROUGHPUT / CELL EFFICIENCY / OPEN EXCEPTIONS.
 *
 * That mattered beyond the noise. The critic reading those four warnings
 * proposed `fontSize: 0` on all four labels — the only way to satisfy a rule
 * that should never have fired was to delete the content.
 */
function readsAsMetric(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > 16) return false;
  if (!/\d/.test(trimmed)) return false;
  // Digits and the punctuation that decorates them, plus a short unit like
  // %, kW, ms, °C. Anything with real words in it is a heading.
  return /^[\d\s.,:/+\-–—x×%]*(\d)[\d\s.,:/+\-–—x×%]*([a-zA-Z°µ]{0,3})$/.test(trimmed);
}

export function checkEyebrowKicker(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "frame") return;
    const kids = childrenOf(node).filter((c) => c.enabled !== false);
    for (let i = 0; i < kids.length - 1; i++) {
      const a = kids[i];
      const b = kids[i + 1];
      if (a.type === "text" && b.type === "text") {
        const aText = a as TextNode;
        const bText = b as TextNode;
        const aSize = aText.fontSize ?? 14;
        const bSize = bText.fontSize ?? 14;
        if (readsAsMetric(bText.content ?? "")) continue;
        if (aSize <= 12 && bSize >= 20) {
          findings.push(
            warning(
              "eyebrow_kicker",
              a.id,
              `"${(aText.content ?? a.id).slice(0, 24)}" (${aSize}px) is an eyebrow/kicker placed above heading "${(bText.content ?? b.id).slice(0, 24)}" (${bSize}px).`,
              "Drop the eyebrow kicker (Rule 11). Lead directly with the strong heading, and put contextual details below the heading if needed."
            )
          );
        }
      }
    }
  });
  return findings;
}

const HEADING_MIN_SIZE = 20;
/** Below this, a heading and the grid it introduces read as one glued block. */
const MIN_HEADING_CONTENT_GAP = 24;
/** Compact CTA / chip rows sit under a hero title; card and photo grids do not. */
const COLLECTION_CHILD_MIN_HEIGHT = 80;
const SECTION_BAND_MIN_WIDTH = 500;

function largestTextSize(node: PenNode): number {
  if (node.type === "text") return (node as TextNode).fontSize ?? 14;
  let max = 0;
  for (const child of childrenOf(node)) {
    if (child.enabled === false) continue;
    max = Math.max(max, largestTextSize(child));
  }
  return max;
}

function isHeadingStack(node: PenNode): boolean {
  if (hasImageFill(node)) return false;
  if (childrenOf(node).some((c) => c.enabled !== false && hasImageFill(c))) return false;
  return largestTextSize(node) >= HEADING_MIN_SIZE;
}

function isCollectionRow(node: PenNode, ctx: AuditContext): boolean {
  if (node.type !== "frame") return false;
  const layout = (node as { layout?: string }).layout;
  const kids = childrenOf(node).filter((c) => c.enabled !== false && c.type === "frame");
  if (layout === "horizontal") {
    const tall = kids.filter((k) => (ctx.boxes.get(k.id)?.box.height ?? 0) >= COLLECTION_CHILD_MIN_HEIGHT);
    if (tall.length >= 2) return true;
    if (kids.filter((k) => hasImageFill(k)).length >= 2) return true;
    return false;
  }
  if (layout === "vertical") {
    return kids.some((row) => isCollectionRow(row, ctx));
  }
  return false;
}

/**
 * A section heading sitting on top of the card or photo grid it introduces.
 *
 * DeepSeek's Pátio page set gap: 10 inside the heading cluster (overline →
 * title) and gap: none on the band, then inserted the grid as a sibling.
 * The critic was told not to impose a fixed gap when nothing collides, so
 * the red marks — heading glued to the rooms, amenities, mosaic — never
 * became a finding. Measure the band; 24–40px is grouping, not decoration.
 */
export function checkHeadingContentGap(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "frame") return;
    if ((node as { layout?: string }).layout !== "vertical") return;
    const bandBox = ctx.absBoxes.get(node.id);
    if (!bandBox || bandBox.width < SECTION_BAND_MIN_WIDTH) return;

    const kids = childrenOf(node).filter((c) => c.enabled !== false);
    for (let i = 0; i < kids.length - 1; i++) {
      const heading = kids[i];
      const collection = kids[i + 1];
      if (!isHeadingStack(heading) || !isCollectionRow(collection, ctx)) continue;
      const a = ctx.absBoxes.get(heading.id);
      const b = ctx.absBoxes.get(collection.id);
      if (!a || !b) continue;
      const gap = Math.round(b.y - (a.y + a.height));
      if (gap >= MIN_HEADING_CONTENT_GAP) continue;
      findings.push(
        warning(
          "heading_content_gap",
          node.id,
          `"${node.name ?? node.id}" sits the heading ${gap}px above the card or photo grid. Section grouping needs ${MIN_HEADING_CONTENT_GAP}–40px between the title block and what it introduces.`,
          `Set gap: 32 on this vertical band so the heading and the grid below it separate. Do not add spacer frames.`
        )
      );
    }
  });
  return findings;
}

export function checkTextBoundaryCollisions(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const textNodes: PenNode[] = [];
  const imageNodes: PenNode[] = [];

  walkEnabled(ctx.doc.children, (node) => {
    if (node.type === "text") textNodes.push(node);
    if (hasImageFill(node) || (node as any).type === "image") imageNodes.push(node);
  });

  for (const text of textNodes) {
    const textBox = ctx.absBoxes.get(text.id);
    if (!textBox || textBox.width <= 0 || textBox.height <= 0) continue;

    for (const img of imageNodes) {
      if (text.id === img.id) continue;
      if (isDescendant(text, img)) continue;

      const imgBox = ctx.absBoxes.get(img.id);
      if (!imgBox || imgBox.width <= 0 || imgBox.height <= 0) continue;

      if (boxesOverlap(textBox, imgBox)) {
        const textContent = (text as TextNode).content ?? text.id;
        findings.push(
          blocker(
            "collision",
            text.id,
            `Text "${textContent.slice(0, 32)}" partially overlaps and cuts across the boundary of image "${img.name ?? img.id}".`,
            "Place the text entirely inside the image with an overlay, or position it fully outside the image with clear padding."
          )
        );
      } else if (
        textBox.y >= imgBox.y + imgBox.height &&
        textBox.y <= imgBox.y + imgBox.height + 4 &&
        textBox.x < imgBox.x + imgBox.width &&
        textBox.x + textBox.width > imgBox.x
      ) {
        const textContent = (text as TextNode).content ?? text.id;
        findings.push(
          warning(
            "spacing_scale",
            text.id,
            `Text "${textContent.slice(0, 32)}" is glued directly to the bottom edge of image "${img.name ?? img.id}" with ${Math.round(textBox.y - (imgBox.y + imgBox.height))}px gap.`,
            "Add at least 12px padding or gap between the image and subsequent text."
          )
        );
      }
    }
  }

  return findings;
}

function isSingleViewportDeck(screen: PenNode): boolean {
  const name = (screen.name ?? "").toLowerCase();
  if (/(tinder|swipe|dating|deck|camera|call|player|shutter)/i.test(name)) return true;

  let hasSwipeActionDock = false;
  let hasMultiItemFeed = false;

  walkEnabled(childrenOf(screen), (n) => {
    const nodeName = (n.name ?? "").toLowerCase();
    if (/(swipe|pass|like|heart|thumb action|action dock)/i.test(nodeName)) {
      hasSwipeActionDock = true;
    }
    if (/(product|catalog|menu|drop|collection|feed|article|grid|cards|offers)/i.test(nodeName) && n.type === "frame") {
      hasMultiItemFeed = true;
    }
  });

  return hasSwipeActionDock && !hasMultiItemFeed;
}

export function checkChromeCollisions(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const BOTTOM_NAV_NAME = /(tab|bottom|nav) ?bar|navigation/i;

  for (const screen of ctx.doc.children) {
    if (!isScreen(screen)) continue;

    const chromeFrames: PenNode[] = [];
    walkEnabled(childrenOf(screen), (n) => {
      if (n.type === "frame") {
        const isChrome = (n as any).metadata?.scaffold === "chrome" || BOTTOM_NAV_NAME.test(n.name ?? "");
        if (isChrome) chromeFrames.push(n);
      }
    });

    const screenBox = ctx.absBoxes.get(screen.id);
    const isMobile = (screen as any).metadata?.screenKind === "mobile" || (screenBox && screenBox.width <= 430);
    const isDeck = isSingleViewportDeck(screen);

    for (const chrome of chromeFrames) {
      const chromeBox = ctx.absBoxes.get(chrome.id);
      if (!chromeBox || chromeBox.width <= 0 || chromeBox.height <= 0) continue;

      const isBottomNav = BOTTOM_NAV_NAME.test(chrome.name ?? "") || (chrome as any).metadata?.scaffold === "chrome";
      if (isMobile && isBottomNav && isDeck && (chromeBox.y + chromeBox.height > 890 || (screenBox && screenBox.height > 890))) {
        findings.push(
          blocker(
            "oversized_section_height",
            screen.id,
            `Single-viewport mobile app "${screen.name ?? screen.id}" has expanded to ${Math.round(screenBox?.height ?? chromeBox.y + chromeBox.height)}px, pushing the action controls/tabs off-screen. A single-viewport swipe/card deck must fit within the 844px device viewport.`,
            "Keep all content contained within the 844px mobile viewport."
          )
        );
      }

      walkEnabled(childrenOf(screen), (contentNode) => {
        if (contentNode.id === chrome.id || isDescendant(contentNode, chrome)) return;
        if (contentNode.type !== "text" && contentNode.type !== "icon" && !hasImageFill(contentNode) && (contentNode as any).type !== "image") return;

        const contentBox = ctx.absBoxes.get(contentNode.id);
        if (!contentBox || contentBox.width <= 0 || contentBox.height <= 0) return;

        if (boxesOverlap(contentBox, chromeBox)) {
          const overlapY = Math.round(contentBox.y + contentBox.height - chromeBox.y);
          const name = contentNode.type === "text" ? `"${(contentNode as TextNode).content?.slice(0, 24)}"` : `"${contentNode.name ?? contentNode.id}"`;
          findings.push(
            blocker(
              "collision",
              contentNode.id,
              `Content node ${name} overlaps the bottom navigation bar by ${overlapY}px.`,
              "Shorten content, reduce card heights or spacing, or set layout container height so content fits cleanly above the navigation bar."
            )
          );
        }
      });
    }
  }

  return findings;
}

export function checkTextOnTextCollisions(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const textNodes: PenNode[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    if (node.type === "text") textNodes.push(node);
  });

  for (let i = 0; i < textNodes.length; i++) {
    const a = textNodes[i];
    const boxA = ctx.absBoxes.get(a.id);
    if (!boxA || boxA.width <= 0 || boxA.height <= 0) continue;

    for (let j = i + 1; j < textNodes.length; j++) {
      const b = textNodes[j];
      const boxB = ctx.absBoxes.get(b.id);
      if (!boxB || boxB.width <= 0 || boxB.height <= 0) continue;

      if (boxesOverlap(boxA, boxB)) {
        const contentA = (a as TextNode).content ?? a.id;
        const contentB = (b as TextNode).content ?? b.id;
        findings.push(
          blocker(
            "collision",
            a.id,
            `Text "${contentA.slice(0, 20)}" overlaps directly with text "${contentB.slice(0, 20)}".`,
            "Wrap the text nodes in a vertical auto-layout container with gap >= 8px to ensure clean vertical separation."
          )
        );
      }
    }
  }
  return findings;
}

export function checkCardRowButtonBaselines(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "frame" || (node as any).layout !== "horizontal") return;
    const cards = childrenOf(node).filter((c) => c.type === "frame" && c.enabled !== false);
    if (cards.length < 2) return;

    const cardButtons: { cardId: string; btnId: string; btnY: number; cardHeight: number }[] = [];
    for (const card of cards) {
      const cardBox = ctx.absBoxes.get(card.id);
      if (!cardBox || cardBox.width < 120 || cardBox.height < 100) continue;

      let deepestBtn: { id: string; y: number } | undefined;
      walkEnabled([card], (sub) => {
        if (sub === card) return;
        const isBtn =
          INTERACTIVE_NAME.test(sub.name ?? "") ||
          /button|cta|reserve|book|apply|inquire|join|(?:^|[ _-])(add|cart|buy|order)(?:[ _-]|$)/i.test(sub.name ?? "");
        if (isBtn && (sub.type === "frame" || sub.type === "text")) {
          const btnBox = ctx.absBoxes.get(sub.id);
          if (btnBox && (!deepestBtn || btnBox.y > deepestBtn.y)) {
            deepestBtn = { id: sub.id, y: btnBox.y };
          }
        }
      });

      if (deepestBtn) {
        cardButtons.push({
          cardId: card.id,
          btnId: (deepestBtn as { id: string; y: number }).id,
          btnY: (deepestBtn as { id: string; y: number }).y,
          cardHeight: cardBox.height
        });
      }
    }

    if (cardButtons.length >= 2) {
      const minY = Math.min(...cardButtons.map((cb) => cb.btnY));
      const maxY = Math.max(...cardButtons.map((cb) => cb.btnY));
      const delta = maxY - minY;

      if (delta >= 4) {
        const worst = cardButtons.find((cb) => cb.btnY === maxY)!;
        findings.push(
          warning(
            "misaligned_buttons",
            worst.cardId,
            `Action buttons across sibling cards in "${node.name ?? node.id}" are staggered vertically by ${Math.round(delta)}px.`,
            "Set height: 'fill_container' and justifyContent: 'space_between' on all sibling cards in the row so buttons lock to a uniform horizontal baseline."
          )
        );
      }
    }
  });

  return findings;
}

export function checkSiblingCardActionConsistency(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "frame" || (node as any).layout !== "horizontal") return;
    const cards = childrenOf(node).filter((c) => c.type === "frame" && c.enabled !== false);
    if (cards.length < 2) return;

    interface CardAction {
      cardId: string;
      cardName: string;
      actionNode?: PenNode;
      isButtonFrame: boolean;
      isRawTextGlyph: boolean;
    }

    const cardActions: CardAction[] = [];
    for (const card of cards) {
      const cardBox = ctx.boxes.get(card.id)?.box;
      if (!cardBox || cardBox.width < 100 || cardBox.height < 80) continue;

      let foundAction: PenNode | undefined;
      let isButtonFrame = false;
      let isRawTextGlyph = false;

      walkEnabled([card], (sub) => {
        if (sub === card) return;
        // Check for raw text plus/add glyph
        if (sub.type === "text") {
          const content = ((sub as TextNode).content ?? "").trim();
          if (content === "+" || content === "＋" || content === "add" || content === "→" || content === "↗") {
            foundAction = sub;
            isRawTextGlyph = true;
          }
        }
        // Check for button/icon well frame
        const isActionName = /btn|button|cta|add|cart|plus|action|icon_well/i.test(sub.name ?? "");
        if (sub.type === "frame" && (isActionName || (sub.cornerRadius && ((sub.width === sub.height && typeof sub.width === "number" && sub.width <= 48) || sub.fill !== undefined)))) {
          foundAction = sub;
          isButtonFrame = true;
          isRawTextGlyph = false;
        }
      });

      cardActions.push({
        cardId: card.id,
        cardName: card.name ?? card.id,
        actionNode: foundAction,
        isButtonFrame,
        isRawTextGlyph
      });
    }

    if (cardActions.length >= 2) {
      const hasButtonFrame = cardActions.some((ca) => ca.isButtonFrame);
      const hasRawGlyphOrMissing = cardActions.some((ca) => ca.isRawTextGlyph || !ca.actionNode);

      const isCommerceRow = /product|catalog|menu|collection|grid|cards|items|slice/i.test(
        node.name ?? ""
      );
      if (isCommerceRow && cardActions.every((ca) => !ca.actionNode)) {
        findings.push(
          blocker(
            "inconsistent_card_actions",
            node.id,
            `Commerce row "${node.name ?? node.id}" has no visible add, buy, cart, or order action on any product card.`,
            "Give every sibling product card a consistent, visible action control with a clear tap target and contrasting icon or label."
          )
        );
        return;
      }

      if (hasButtonFrame && hasRawGlyphOrMissing) {
        const defective = cardActions.find((ca) => ca.isRawTextGlyph || !ca.actionNode)!;
        findings.push(
          blocker(
            "inconsistent_card_actions",
            defective.cardId,
            `Card "${defective.cardName}" has an inconsistent action style compared to sibling cards (sibling has a styled button container, while this card has a raw glyph or missing button).`,
            "Give all sibling cards in the row identical action button structures and styling."
          )
        );
      }
    }
  });

  return findings;
}

export function checkCardRowHeights(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "frame" || (node as any).layout !== "horizontal") return;
    const cards = childrenOf(node).filter((c) => c.type === "frame" && c.enabled !== false);
    if (cards.length < 2) return;

    const heights: { id: string; height: number }[] = [];
    for (const card of cards) {
      const box = ctx.absBoxes.get(card.id);
      if (box && box.width >= 120 && box.height >= 80) {
        heights.push({ id: card.id, height: box.height });
      }
    }

    if (heights.length >= 2) {
      const minH = Math.min(...heights.map((h) => h.height));
      const maxH = Math.max(...heights.map((h) => h.height));
      if (maxH - minH >= 12) {
        const worst = heights.find((h) => h.height === minH) || heights[0];
        findings.push(
          warning(
            "uneven_card_heights",
            worst.id,
            `Sibling cards in "${node.name ?? node.id}" have uneven heights (${Math.round(minH)}px vs ${Math.round(maxH)}px).`,
            "Set height: 'fill_container' on all cards in the row so they form a balanced, uniform height."
          )
        );
      }
    }
  });

  return findings;
}

export function checkFormInputAlignment(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "frame" || (node as any).layout !== "vertical") return;
    const kids = childrenOf(node).filter((c) => c.type === "frame" && c.enabled !== false);
    const inputRows = kids.filter((k) => {
      const name = k.name ?? "";
      const isInput = /input|field|date|picker|guest|person|time|select|search|email|phone|address|quantity/i.test(name);
      return isInput && (k as any).layout === "horizontal";
    });

    if (inputRows.length >= 2) {
      const aligns = new Set(inputRows.map((r) => (r as any).justifyContent || "start"));
      if (aligns.size > 1) {
        const misaligned = inputRows.find((r) => (r as any).justifyContent === "center") || inputRows[0];
        findings.push(
          warning(
            "misaligned_inputs",
            misaligned.id,
            `Form input fields inside "${node.name ?? node.id}" have inconsistent alignment (some centered, some left-aligned).`,
            "Set justifyContent: 'start' and padding: [0, 16] on all input fields in the stack for consistent left alignment."
          )
        );
      }
    }
  });

  return findings;
}

export function checkStrayOrphanCharacters(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "text") return;
    const content = (node as TextNode).content;
    if (typeof content !== "string") return;
    const trimmed = content.trim();
    if (/^[-—•.,;/:\\|]$/.test(trimmed)) {
      findings.push(
        warning(
          "stray_character",
          node.id,
          `Text node "${node.name ?? node.id}" contains only a stray placeholder character ("${trimmed}").`,
          "Delete this placeholder text node or replace it with real copy."
        )
      );
    }
  });
  return findings;
}

export function checkTextOverlappingFrames(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const textNodes: PenNode[] = [];
  const frameNodes: PenNode[] = [];

  walkEnabled(ctx.doc.children, (node) => {
    if (node.type === "text") textNodes.push(node);
    else if (node.type === "frame" && (node as any).fill && (node as any).fill !== "$surface-primary") {
      frameNodes.push(node);
    }
  });

  for (const text of textNodes) {
    const boxT = ctx.absBoxes.get(text.id);
    if (!boxT || boxT.width <= 0 || boxT.height <= 0) continue;

    for (const frame of frameNodes) {
      if (text.id === frame.id || isDescendant(text, frame)) continue;
      const boxF = ctx.absBoxes.get(frame.id);
      if (!boxF || boxF.width <= 0 || boxF.height <= 0) continue;

      if (boxesOverlap(boxT, boxF)) {
        const content = (text as TextNode).content ?? text.id;
        findings.push(
          blocker(
            "collision",
            text.id,
            `Text "${content.slice(0, 24)}" overlaps the boundary of card "${frame.name ?? frame.id}".`,
            "Place headings and cards in a vertical auto-layout container with gap >= 24px so headings never collide with card borders."
          )
        );
      }
    }
  }

  return findings;
}

export function checkSegmentedPillDistribution(ctx: AuditContext): AuditFinding[] {
  const findings: AuditFinding[] = [];

  walkEnabled(ctx.doc.children, (node) => {
    if (node.type !== "frame" || (node as any).layout !== "horizontal") return;
    const isPillRow = /pill|segment|tab|switcher|selector/i.test(node.name ?? "");
    if (!isPillRow) return;

    const parentBox = ctx.boxes.get(node.id)?.box;
    if (!parentBox || parentBox.width <= 0) return;

    const kids = childrenOf(node).filter((c) => c.enabled !== false);
    if (kids.length < 2) return;

    let totalKidsWidth = 0;
    for (const kid of kids) {
      const kBox = ctx.boxes.get(kid.id)?.box;
      if (kBox) totalKidsWidth += kBox.width;
    }

    if (totalKidsWidth > parentBox.width + 4) {
      findings.push(
        warning(
          "overflow",
          node.id,
          `Segmented pills inside "${node.name ?? node.id}" total ${Math.round(totalKidsWidth)}px, overflowing the ${Math.round(parentBox.width)}px container.`,
          "Set width: 'fill_container' on each pill child and reduce horizontal padding so all options distribute evenly."
        )
      );
    }
  });

  return findings;
}
