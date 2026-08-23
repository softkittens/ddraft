import { Component, For, Show, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import {
  ChevronDown,
  ChevronRight,
  Frame,
  Square,
  Type,
  Layers,
  Component as ComponentIcon,
  Circle,
  File,
  CornerUpRight,
  Plus,
  X,
  Trash2
} from "lucide-solid";
import type { PenNode } from "../model/types";
import type { Page } from "../model/pages";
import { childrenOf } from "../model/tree";
import {
  pages,
  activePage,
  activeScreens,
  setActivePageId,
  addPage,
  assignScreenToPage,
  renamePageById,
  removePageById,
  selectedIds,
  selectNode,
  layersCollapsed,
  toggleLayerCollapse,
  setLayersVisible,
  deleteNodeById
} from "./store";

/**
 * Move a screen to another page.
 *
 * Positioned fixed off the button's own rect rather than absolutely inside the
 * row, because both the page list and the layer list scroll inside a panel
 * that clips its overflow — an absolutely positioned menu gets cut off by
 * whichever container it opens near the edge of.
 *
 * Through a portal, because the panel is a .chrome-surface and backdrop-filter
 * makes an element the containing block for the fixed descendants inside it.
 * Rendered in place, the menu resolves its coordinates against the panel
 * instead of the viewport and lands off the side of the screen.
 */
const MovePageMenu: Component<{ nodeId: string; at: { x: number; y: number }; onClose: () => void }> = (props) => (
  <Portal>
    <div class="fixed inset-0 z-40" onClick={props.onClose} onContextMenu={props.onClose} />
    <div
      class="chrome-surface fixed z-50 rounded-lg py-1 min-w-40 max-h-64 overflow-y-auto custom-scrollbar text-xs"
      style={{ left: `${props.at.x}px`, top: `${props.at.y}px` }}
    >
      <div class="px-2.5 py-1 text-[10px] uppercase tracking-wide text-neutral-400 font-semibold">Move to page</div>
      <For each={pages()}>
        {(page) => (
          <button
            class="w-full text-left px-2.5 h-7 flex items-center justify-between gap-3 hover:bg-neutral-100 transition"
            onClick={() => {
              assignScreenToPage(props.nodeId, page.implicit ? undefined : page.id);
              props.onClose();
            }}
          >
            <span class="truncate">{page.name}</span>
            <span class="text-[10px] text-neutral-400 tabular-nums shrink-0">{page.screens.length}</span>
          </button>
        )}
      </For>
      <button
        class="w-full text-left px-2.5 h-7 flex items-center hover:bg-neutral-100 transition border-t border-neutral-200/80 mt-1 pt-1 text-neutral-600"
        onClick={() => {
          assignScreenToPage(props.nodeId, addPage());
          props.onClose();
        }}
      >
        New page
      </button>
    </div>
  </Portal>
);

const NodeRow: Component<{ node: PenNode; depth: number }> = (props) => {
  const [moveMenuAt, setMoveMenuAt] = createSignal<{ x: number; y: number } | null>(null);
  const isSelected = () => selectedIds().has(props.node.id);
  const isCollapsed = () => layersCollapsed().has(props.node.id);
  const hasChildren = () => childrenOf(props.node).length > 0;

  const getNodeIcon = () => {
    switch (props.node.type) {
      case "frame":
        return <Frame size={13} class="shrink-0" />;

      case "group":
        return <Layers size={13} class="shrink-0" />;
      case "rectangle":
        return <Square size={13} class="shrink-0" />;
      case "ellipse":
        return <Circle size={13} class="shrink-0" />;
      case "text":
        return <Type size={13} class="shrink-0" />;
      case "ref":
        return <ComponentIcon size={13} class="shrink-0" />;
      default:
        return <Square size={13} class="shrink-0" />;
    }
  };

  const getDisplayName = () => {
    if (props.node.name) return props.node.name;
    if (props.node.type === "text" && props.node.content) {
      const txt = props.node.content;
      return txt.length > 18 ? txt.slice(0, 18) + "..." : txt;
    }
    return props.node.id;
  };

  return (
    <div>
      <div
        onClick={(e) => selectNode(props.node.id, e.metaKey || e.ctrlKey)}
        style={{ "padding-left": `${props.depth * 14 + 10}px` }}
        class={`group flex items-center justify-between h-7 pr-2 text-xs cursor-pointer transition select-none ${
          isSelected()
            ? "bg-[#0d99ff] text-white font-medium"
            : "text-neutral-700 hover:bg-neutral-100"
        }`}
      >
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          {/* Collapse Chevron */}
          <Show
            when={hasChildren()}
            fallback={<span class="w-3.5 shrink-0" />}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleLayerCollapse(props.node.id);
              }}
              class="w-3.5 h-3.5 flex items-center justify-center hover:opacity-80 shrink-0"
            >
              <Show when={isCollapsed()} fallback={<ChevronDown size={12} />}>
                <ChevronRight size={12} />
              </Show>
            </button>
          </Show>

          {getNodeIcon()}
          <span class="truncate">{getDisplayName()}</span>
        </div>

        <div class="flex items-center shrink-0">
          {/* Only a top-level frame carries a page: a page partitions the
              canvas root, so a nested node has no page of its own to change. */}
          <Show when={props.depth === 0}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMoveMenuAt({ x: Math.max(8, r.right - 160), y: r.bottom + 4 });
              }}
              class={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-black/10 transition ${
                isSelected() ? "text-white" : "text-neutral-400 hover:text-neutral-700"
              }`}
              title="Move to page"
            >
              <CornerUpRight size={11} />
            </button>
          </Show>

          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteNodeById(props.node.id);
            }}
            class={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-black/10 transition ${
              isSelected() ? "text-white" : "text-neutral-400 hover:text-rose-600"
            }`}
            title="Delete layer"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      <Show when={moveMenuAt()}>
        {(at) => <MovePageMenu nodeId={props.node.id} at={at()} onClose={() => setMoveMenuAt(null)} />}
      </Show>

      {/* Recursive Children */}
      <Show when={hasChildren() && !isCollapsed()}>
        <For each={childrenOf(props.node)}>
          {(child) => <NodeRow node={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </div>
  );
};

/**
 * One page in the switcher.
 *
 * The implicit page — the one holding screens that carry no label — cannot be
 * renamed or deleted here. It is not a page anybody made; it is what is left
 * over, and it disappears on its own once every screen has a label.
 */
const PageRow: Component<{ page: Page }> = (props) => {
  const [draft, setDraft] = createSignal<string | null>(null);
  const isActive = () => activePage()?.id === props.page.id;

  const commit = () => {
    const value = draft();
    setDraft(null);
    if (value !== null && value.trim()) renamePageById(props.page.id, value);
  };

  return (
    <div
      onClick={() => setActivePageId(props.page.id)}
      onDblClick={() => {
        if (!props.page.implicit) setDraft(props.page.name);
      }}
      class={`group flex items-center justify-between h-7 pl-2.5 pr-2 text-xs cursor-pointer transition select-none ${
        isActive() ? "bg-[#0d99ff] text-white font-medium" : "text-neutral-700 hover:bg-neutral-100"
      }`}
      title={props.page.implicit ? "Screens not assigned to a page" : "Double-click to rename"}
    >
      <div class="flex items-center gap-1.5 min-w-0 flex-1">
        <File size={13} class="shrink-0" />
        <Show when={draft() === null} fallback={
          <input
            class="min-w-0 flex-1 bg-white text-neutral-900 rounded px-1 py-0.5 outline-none ring-1 ring-[#0d99ff]"
            value={draft() ?? ""}
            onClick={(e) => e.stopPropagation()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setDraft(null);
            }}
            ref={(el) => queueMicrotask(() => el.select())}
          />
        }>
          <span class="truncate">{props.page.name}</span>
        </Show>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <span class={`tabular-nums text-[10px] ${isActive() ? "text-white/70" : "text-neutral-400"}`}>
          {props.page.screens.length}
        </span>
        <Show when={!props.page.implicit}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              removePageById(props.page.id);
            }}
            class={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-black/10 transition ${
              isActive() ? "text-white" : "text-neutral-400 hover:text-rose-600"
            }`}
            title="Delete page (screens stay on the canvas)"
          >
            <Trash2 size={11} />
          </button>
        </Show>
      </div>
    </div>
  );
};

const PagesSection: Component = () => (
  <div class="shrink-0 border-b border-neutral-200/80 flex flex-col max-h-[40%]">
    <div class="h-7 px-3 flex items-center justify-between font-semibold text-[10px] text-neutral-500 tracking-wide uppercase shrink-0">
      <span>Pages</span>
      <button
        onClick={() => addPage()}
        class="text-neutral-400 hover:text-neutral-700 p-0.5 rounded transition"
        title="Add page"
      >
        <Plus size={13} />
      </button>
    </div>
    <div class="overflow-y-auto custom-scrollbar pb-1">
      <Show
        when={pages().length > 0}
        fallback={<div class="px-3 pb-2 text-[11px] text-neutral-400">Nothing on the canvas yet.</div>}
      >
        <For each={pages()}>{(page) => <PageRow page={page} />}</For>
      </Show>
    </div>
  </div>
);

const LAYERS_MIN_W = 260;
const LAYERS_MIN_H = 240;
const LAYERS_MAX_W = 520;

const [layersPanelWidth, setLayersPanelWidth] = createSignal(320);
const [layersPanelHeight, setLayersPanelHeight] = createSignal(640);

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export const LayersPanel: Component = () => {
  const [resizing, setResizing] = createSignal(false);

  const startResize = (axisX: boolean, axisY: boolean) => (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = layersPanelWidth();
    const startH = layersPanelHeight();
    handle.setPointerCapture(e.pointerId);
    setResizing(true);

    const onMove = (ev: PointerEvent) => {
      if (axisX) {
        setLayersPanelWidth(
          clamp(startW + (startX - ev.clientX), LAYERS_MIN_W, Math.min(LAYERS_MAX_W, window.innerWidth - 96))
        );
      }
      if (axisY) {
        setLayersPanelHeight(
          clamp(startH + (ev.clientY - startY), LAYERS_MIN_H, window.innerHeight - 80)
        );
      }
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setResizing(false);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  onCleanup(() => setResizing(false));

  return (
    <div
      class={`chrome-surface absolute top-14 right-16 z-30 rounded-2xl flex flex-col select-none overflow-hidden ${
        resizing() ? "cursor-grabbing" : ""
      }`}
      style={{
        width: `${layersPanelWidth()}px`,
        height: `min(${layersPanelHeight()}px, calc(100vh - 5rem))`
      }}
    >
      <div
        class="absolute left-0 top-0 bottom-0 w-1.5 z-10 cursor-ew-resize"
        onPointerDown={startResize(true, false)}
        title="Resize width"
      />
      <div
        class="absolute left-0 right-0 bottom-0 h-1.5 z-10 cursor-ns-resize"
        onPointerDown={startResize(false, true)}
        title="Resize height"
      />
      <div
        class="absolute left-0 bottom-0 w-3 h-3 z-20 cursor-nesw-resize"
        onPointerDown={startResize(true, true)}
        title="Resize"
      />

      <div class="h-9 px-3 border-b border-neutral-200/80 flex items-center justify-between font-semibold text-xs text-neutral-800 tracking-wide uppercase shrink-0">
        <span>Layers</span>
        <button
          onClick={() => setLayersVisible(false)}
          class="text-neutral-400 hover:text-neutral-700 p-1 rounded transition"
          title="Close layers panel"
        >
          <X size={14} />
        </button>
      </div>

      <PagesSection />

      <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar py-1">
        <For each={activeScreens()}>
          {(node) => <NodeRow node={node} depth={0} />}
        </For>
      </div>
    </div>
  );
};
