import { Show, createEffect, createSignal, onCleanup, type Component, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

/**
 * A panel hung off a control in the selection toolbar.
 *
 * Rendered through a Portal, and that is not a detail. `.chrome-surface` sets
 * `backdrop-filter: blur(18px)`, which makes the element a containing block for
 * `position: fixed` descendants — so a panel nested inside the toolbar
 * positions against the toolbar rather than the window and lands somewhere off
 * screen. Neither the type checker nor a test catches it; it is only visible in
 * a browser. Keep the Portal.
 */

export interface ControlPopoverProps {
  /** Accessible name, and the panel's heading. */
  label: string;
  /** The button face. Receives whether the panel is open. */
  trigger: (open: () => boolean) => JSX.Element;
  children: JSX.Element;
  /** Panel width in pixels. */
  width?: number;
}

const PANEL_GAP = 6;
const MARGIN = 8;

export const ControlPopover: Component<ControlPopoverProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [anchor, setAnchor] = createSignal({ left: 0, top: 0 });
  let triggerRef: HTMLButtonElement | undefined;
  let panelRef: HTMLDivElement | undefined;

  const width = () => props.width ?? 208;

  /**
   * Below the trigger, or above it when there is no room below.
   *
   * The height is only knowable once the panel is in the DOM, so the first
   * placement is the optimistic one and an effect corrects it. That runs before
   * the browser paints, so the flip is not visible.
   */
  const reposition = (): void => {
    if (!triggerRef) return;
    const box = triggerRef.getBoundingClientRect();
    const half = width() / 2;
    const centre = box.left + box.width / 2;
    const left = Math.min(
      window.innerWidth - MARGIN - half,
      Math.max(MARGIN + half, centre)
    );

    const height = panelRef?.offsetHeight ?? 0;
    const below = box.bottom + PANEL_GAP;
    const fitsBelow = height === 0 || below + height <= window.innerHeight - MARGIN;
    const top = fitsBelow
      ? below
      : Math.max(MARGIN, box.top - PANEL_GAP - height);

    setAnchor({ left, top });
  };

  // Re-run once the panel has a height, and whenever its contents resize it.
  createEffect(() => {
    if (!open() || !panelRef) return;
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(panelRef);
    onCleanup(() => observer.disconnect());
  });

  const toggle = (): void => {
    if (open()) {
      setOpen(false);
      return;
    }
    reposition();
    setOpen(true);
  };

  const onWindowDown = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    // The trigger has its own handler; letting this one run too would close and
    // reopen in the same click.
    if (target && triggerRef?.contains(target)) return;
    if (target instanceof Element && target.closest("[data-control-panel]")) return;
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && open()) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("mousedown", onWindowDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    // The toolbar unmounts whenever the selection empties, so this matters.
    onCleanup(() => {
      window.removeEventListener("mousedown", onWindowDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={props.label}
        aria-label={props.label}
        aria-expanded={open()}
        onClick={toggle}
        class={`h-7 rounded-lg px-1.5 flex items-center gap-1.5 transition cursor-pointer ${
          open() ? "bg-black/[0.07]" : "hover:bg-black/5"
        }`}
      >
        {props.trigger(open)}
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={panelRef}
            data-control-panel
            class="chrome-surface fixed z-[60] rounded-xl p-2.5 select-none"
            style={{
              left: `${anchor().left}px`,
              top: `${anchor().top}px`,
              width: `${width()}px`,
              transform: "translateX(-50%)"
            }}
          >
            <div class="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-2 px-0.5">
              {props.label}
            </div>
            {props.children}
          </div>
        </Portal>
      </Show>
    </>
  );
};
