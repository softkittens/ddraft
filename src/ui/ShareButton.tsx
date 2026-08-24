import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { ChevronDown, Share } from "lucide-solid";
import { resolvedDoc, selectedIds } from "./store";
import {
  EXPORT_SCALES,
  resolveExportTarget,
  exportSelectedFrame,
  type ExportFormat,
  type ExportFailure,
  type ExportScale
} from "../render/exportImage";

/**
 * Share sits in the bottom-right chrome, where undo used to.
 *
 * The menu is portaled. `.chrome-surface` sets `backdrop-filter`, which makes
 * the button a containing block for `position: fixed` descendants — a panel
 * nested inside it would position against the pill rather than the window
 * and open off-screen. Same reason ControlPopover uses a Portal.
 */

const PANEL_WIDTH = 220;
const PANEL_GAP = 6;
const MARGIN = 8;

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function failureMessage(reason: ExportFailure): string {
  switch (reason) {
    case "no_target":
      return "Select a frame to export.";
    case "unavailable":
      return "Couldn't export this frame.";
    default: {
      const _never: never = reason;
      return _never;
    }
  }
}

export const ShareButton: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [scale, setScale] = createSignal<ExportScale>(1);
  const [anchor, setAnchor] = createSignal({ left: 0, top: 0 });
  let triggerRef: HTMLButtonElement | undefined;
  let panelRef: HTMLDivElement | undefined;

  const target = createMemo(() => resolveExportTarget(resolvedDoc(), selectedIds()));

  const reposition = (): void => {
    if (!triggerRef) return;
    const box = triggerRef.getBoundingClientRect();
    const height = panelRef?.offsetHeight ?? 0;
    const left = Math.min(
      window.innerWidth - MARGIN - PANEL_WIDTH,
      Math.max(MARGIN, box.right - PANEL_WIDTH)
    );
    const above = box.top - PANEL_GAP - height;
    const top = height === 0 || above >= MARGIN ? Math.max(MARGIN, above) : box.bottom + PANEL_GAP;
    setAnchor({ left, top });
  };

  createEffect(() => {
    if (!open() || !panelRef) return;
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(panelRef);
    onCleanup(() => observer.disconnect());
  });

  const toggle = (): void => {
    if (busy()) return;
    if (open()) {
      setOpen(false);
      return;
    }
    reposition();
    setOpen(true);
  };

  const onWindowDown = (event: MouseEvent): void => {
    const node = event.target as Node | null;
    if (node && triggerRef?.contains(node)) return;
    if (node instanceof Element && node.closest("[data-share-panel]")) return;
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
    onCleanup(() => {
      window.removeEventListener("mousedown", onWindowDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    });
  }

  const runExport = async (format: ExportFormat): Promise<void> => {
    if (busy() || !target()) return;
    setOpen(false);
    setBusy(true);
    try {
      const result = await exportSelectedFrame(resolvedDoc(), selectedIds(), format, scale());
      if (!result.ok) {
        alert(failureMessage(result.reason));
        return;
      }
      downloadDataUrl(result.dataUrl, result.filename);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title="Export selected frame"
        aria-label="Share"
        aria-haspopup="menu"
        aria-expanded={open()}
        disabled={busy()}
        onClick={toggle}
        class={`chrome-surface h-10 w-10 rounded-full text-neutral-800 hover:bg-white/90 transition flex items-center justify-center ${
          open() ? "bg-white" : ""
        } disabled:opacity-60`}
      >
        <Share size={15} />
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={panelRef}
            data-share-panel
            role="menu"
            class="chrome-surface fixed z-[60] rounded-xl py-1.5 select-none"
            style={{
              left: `${anchor().left}px`,
              top: `${anchor().top}px`,
              width: `${PANEL_WIDTH}px`
            }}
          >
            <div class="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
              Export
            </div>
            <div class="px-2.5 pb-1.5 text-[11px] text-neutral-500 truncate">
              {target()?.name?.trim() || (target() ? "Frame" : "Select a frame")}
            </div>
            <ExportRow
              label="PNG"
              disabled={!target() || busy()}
              scale={scale()}
              scaleDisabled={busy()}
              onScale={setScale}
              onSelect={() => void runExport("png")}
            />
            <ExportRow
              label="JPG"
              disabled={!target() || busy()}
              scale={scale()}
              scaleDisabled={busy()}
              onScale={setScale}
              onSelect={() => void runExport("jpg")}
            />
          </div>
        </Portal>
      </Show>
    </>
  );
};

const ExportRow: Component<{
  label: string;
  disabled: boolean;
  scale: ExportScale;
  scaleDisabled: boolean;
  onScale: (scale: ExportScale) => void;
  onSelect: () => void;
}> = (props) => (
  <div class="flex items-center gap-1 px-1.5">
    <button
      type="button"
      role="menuitem"
      disabled={props.disabled}
      onClick={props.onSelect}
      class="flex-1 text-left h-8 px-1 text-xs text-neutral-800 hover:bg-neutral-100 rounded-md transition disabled:text-neutral-400 disabled:hover:bg-transparent disabled:cursor-default"
    >
      {props.label}
    </button>
    <ScaleSelect value={props.scale} disabled={props.scaleDisabled} onChange={props.onScale} />
  </div>
);

const ScaleSelect: Component<{
  value: ExportScale;
  disabled: boolean;
  onChange: (scale: ExportScale) => void;
}> = (props) => {
  const [open, setOpen] = createSignal(false);

  const onWindowDown = (event: MouseEvent): void => {
    const node = event.target as Node | null;
    if (node instanceof Element && node.closest("[data-scale-select]")) return;
    setOpen(false);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("mousedown", onWindowDown, true);
    onCleanup(() => window.removeEventListener("mousedown", onWindowDown, true));
  }

  return (
    <div class="relative" data-scale-select>
      <button
        type="button"
        disabled={props.disabled}
        aria-label="Export scale"
        aria-haspopup="listbox"
        aria-expanded={open()}
        onClick={(event) => {
          event.stopPropagation();
          if (props.disabled) return;
          setOpen(!open());
        }}
        class="h-6 min-w-[44px] px-1.5 rounded-md border border-black/10 text-[11px] font-medium text-neutral-700 flex items-center justify-between gap-0.5 hover:bg-neutral-50 transition disabled:text-neutral-400 disabled:hover:bg-transparent disabled:cursor-default"
      >
        {props.value}x
        <ChevronDown size={12} />
      </button>
      <Show when={open()}>
        <div
          role="listbox"
          class="absolute right-0 bottom-full mb-1 z-10 min-w-full chrome-surface rounded-lg py-1 shadow-lg"
        >
          <For each={EXPORT_SCALES}>
            {(item) => (
              <button
                type="button"
                role="option"
                aria-selected={item === props.value}
                onClick={() => {
                  props.onChange(item);
                  setOpen(false);
                }}
                class={`w-full text-left px-2.5 h-7 text-[11px] font-medium hover:bg-neutral-100 ${
                  item === props.value ? "text-neutral-900" : "text-neutral-600"
                }`}
              >
                {item}x
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
