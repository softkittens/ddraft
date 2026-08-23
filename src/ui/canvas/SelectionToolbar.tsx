import { Show, createEffect, createMemo, createSignal, on, onCleanup, type Component } from "solid-js";
import { SlidersHorizontal } from "lucide-solid";
import {
  camera,
  layoutTree,
  nodeMap,
  selectedIds,
  toolMode,
  editingTextId,
  chatVisible,
  chatExpanded
} from "../store";
import type { PenNode } from "../../model/types";
import { placeToolbar, unionWorldBox } from "./toolbarAnchor";
import { FillControl } from "./controls/FillControl";
import { FontSizeControl } from "./controls/FontSizeControl";
import { TextAlignControl } from "./controls/TextAlignControl";
import { RadiusControl, hasCorners } from "./controls/RadiusControl";
import { GapControl, PaddingControl, isFrame, flowsChildren } from "./controls/SpacingControls";
import { AlignControl } from "./controls/AlignControl";
import { SizeControl } from "./controls/SizeControl";

/**
 * The editing controls, on the canvas next to what they edit.
 *
 * A selection gets a handle on its top edge, and nothing more until that handle
 * is clicked. A bar that appeared on its own every time anything was selected
 * would be in the way during the work selection is mostly for — moving things,
 * looking at them, selecting something else a second later. The handle costs
 * one click and the rest of the time it is a dot.
 *
 * Both hide during any gesture. A bar that chases a node being dragged is worse
 * than no bar, and while text is being edited the text editor is the control.
 */

const TOOLBAR_HEIGHT = 36;
const GAP = 10;
const MARGIN = 12;
/** The top chrome — logo, Clear/Open, the layers toggle. */
const TOP_INSET = 60;

/* The handle: small, above the top edge, and only while the pointer is near. */
const HANDLE_SIZE = 18;
/** Centre this far above the selection's top edge, leaving a small gap under it. */
const HANDLE_LIFT = 13;
/** How far outside the selection still counts as being at it. */
const REVEAL_PAD = 10;
/** Enough to cover the handle and the gap, so moving onto it does not lose it. */
const REVEAL_ABOVE = 36;

export interface SelectionToolbarProps {
  /** True while a drag, marquee or shape gesture is running. */
  busy: () => boolean;
}

const Divider: Component = () => <span class="w-px h-4 bg-black/10 mx-0.5 shrink-0" />;

export const SelectionToolbar: Component<SelectionToolbarProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [size, setSize] = createSignal({ width: 0, height: TOOLBAR_HEIGHT });

  // Measured rather than guessed: the bar's width changes with the node type
  // selected, and the clamp needs the real one to keep it inside the window.
  const measure = (el: HTMLDivElement): void => {
    const observer = new ResizeObserver(() =>
      setSize({ width: el.offsetWidth, height: el.offsetHeight })
    );
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };

  const nodes = createMemo<readonly PenNode[]>(() => {
    const map = nodeMap();
    const found: PenNode[] = [];
    for (const id of selectedIds()) {
      const node = map.get(id);
      if (node) found.push(node);
    }
    return found;
  });

  // A new selection is a new question, so the bar closes with the old one.
  // Editing a property does not touch the selection, so it stays open through
  // as many changes as the person wants to make.
  createEffect(on(selectedIds, () => setExpanded(false), { defer: true }));

  const visible = () =>
    !props.busy() && toolMode() === "select" && !editingTextId() && nodes().length > 0;

  const viewport = () => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1440,
    height: typeof window !== "undefined" ? window.innerHeight : 900
  });

  /** The selection, in screen pixels. Null whenever nothing should be shown. */
  const screenBox = createMemo(() => {
    if (!visible()) return null;
    const world = unionWorldBox(layoutTree(), selectedIds());
    if (!world) return null;
    const cam = camera();
    return {
      x: world.x * cam.zoom + cam.x,
      y: world.y * cam.zoom + cam.y,
      width: world.width * cam.zoom,
      height: world.height * cam.zoom
    };
  });

  // The same inset zoom-to-fit uses, so neither the handle nor the bar can
  // settle behind the chat panel where it could not be clicked.
  const leftInset = () =>
    chatVisible() && chatExpanded() ? Math.min(410, viewport().width * 0.35) : 0;

  /** Above the middle of the selection's top edge, but never off the window. */
  const handleAt = createMemo(() => {
    const box = screenBox();
    if (!box) return null;
    const view = viewport();
    const half = HANDLE_SIZE / 2;
    return {
      left: Math.min(
        view.width - MARGIN - half,
        Math.max(leftInset() + MARGIN + half, box.x + box.width / 2)
      ),
      top: Math.min(view.height - MARGIN - half, Math.max(TOP_INSET + half, box.y - HANDLE_LIFT))
    };
  });

  /*
   * The handle appears only while the pointer is at the selection.
   *
   * Derived from the last pointer position rather than decided inside the move
   * handler, so it also answers when the *selection* changes under a stationary
   * pointer. Clicking a node to select it is exactly that case: the mouse
   * arrived while something else was selected, and a handler-only version left
   * the handle hidden until the person jiggled the mouse.
   *
   * The memo returns a boolean, so recomputing on every move is arithmetic that
   * notifies nothing until the answer actually flips.
   */
  const [pointer, setPointer] = createSignal<{ x: number; y: number } | null>(null);

  if (typeof window !== "undefined") {
    const onMove = (event: MouseEvent): void => {
      setPointer({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("mousemove", onMove);
    onCleanup(() => window.removeEventListener("mousemove", onMove));
  }

  /*
   * The live region is the selection plus a strip above it, and the handle's
   * own box. Without the strip, reaching for the handle would leave the
   * selection and take the handle away mid-reach; without the handle's box, the
   * same happens once the handle has been clamped away from a selection that is
   * mostly off screen.
   */
  const nearSelection = createMemo(() => {
    const at = pointer();
    const box = screenBox();
    const handle = handleAt();
    if (!at || !box || !handle) return false;

    const inBox =
      at.x >= box.x - REVEAL_PAD &&
      at.x <= box.x + box.width + REVEAL_PAD &&
      at.y >= box.y - REVEAL_ABOVE &&
      at.y <= box.y + box.height + REVEAL_PAD;
    const half = HANDLE_SIZE / 2 + REVEAL_PAD;
    const onHandle = Math.abs(at.x - handle.left) <= half && Math.abs(at.y - handle.top) <= half;
    return inBox || onHandle;
  });

  const barAt = createMemo(() => {
    const box = screenBox();
    if (!box) return null;
    return placeToolbar({
      box,
      toolbarWidth: size().width,
      toolbarHeight: size().height,
      viewport: viewport(),
      topInset: TOP_INSET,
      leftInset: leftInset(),
      margin: MARGIN,
      gap: GAP
    });
  });

  // Escape closes the bar, but an open control panel takes the first one for
  // itself. Asked rather than inferred from listener order: relying on the
  // popover's capture-phase stopPropagation to shadow this made the behaviour
  // depend on where focus happened to be.
  if (typeof window !== "undefined") {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !expanded()) return;
      if (document.querySelector("[data-control-panel]")) return;
      event.stopPropagation();
      setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  }

  /*
   * Which controls appear is decided per group, not per node: a control shows
   * when at least one selected node can use it, and writes only to those. That
   * is what makes a mixed selection useful rather than a lowest common
   * denominator — two labels and a card offer size, padding and fill, and each
   * lands where it means something.
   */
  const hasText = () => nodes().some((node) => node.type === "text");
  const hasFrame = () => nodes().some(isFrame);
  const hasFlow = () => nodes().some(flowsChildren);
  const hasBox = () => nodes().some(hasCorners);

  return (
    <>
      <Show when={!expanded() && nearSelection() && handleAt()}>
        {(at) => (
          <button
            type="button"
            title="Edit style"
            aria-label="Edit style"
            onMouseDown={(e) => {
              // The canvas clears the selection on mousedown, which would take
              // the handle away from under the click that is opening it.
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={() => setExpanded(true)}
            class="selection-handle fixed z-50 flex items-center justify-center rounded-full cursor-pointer"
            style={{
              left: `${at().left}px`,
              top: `${at().top}px`,
              width: `${HANDLE_SIZE}px`,
              height: `${HANDLE_SIZE}px`,
              transform: "translate(-50%, -50%)"
            }}
          >
            <SlidersHorizontal size={10} />
          </button>
        )}
      </Show>

      <Show when={expanded() && barAt()}>
        {(at) => (
          <div
            ref={measure}
            class="chrome-surface fixed z-50 h-9 rounded-xl px-1 flex items-center gap-0.5 select-none"
            style={{
              left: `${at().left}px`,
              top: `${at().top}px`,
              transform: "translateX(-50%)"
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <FillControl nodes={nodes} />
            <SizeControl nodes={nodes} />

            <Show when={hasText()}>
              <Divider />
              <FontSizeControl nodes={nodes} />
              <TextAlignControl nodes={nodes} />
            </Show>

            <Show when={hasFrame()}>
              <Divider />
              <AlignControl nodes={nodes} />
              <PaddingControl nodes={nodes} />
              <Show when={hasFlow()}>
                <GapControl nodes={nodes} />
              </Show>
            </Show>

            <Show when={hasBox()}>
              <Divider />
              <RadiusControl nodes={nodes} />
            </Show>
          </div>
        )}
      </Show>
    </>
  );
};
