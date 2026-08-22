import { Component, For, Show, createSignal, onCleanup } from "solid-js";
import {
  ChevronDown,
  ChevronRight,
  Frame,
  Square,
  Type,
  Layers,
  Component as ComponentIcon,
  Circle,
  X,
  Trash2
} from "lucide-solid";
import type { PenNode } from "../model/types";
import { childrenOf } from "../model/tree";
import {
  doc,
  selectedIds,
  selectNode,
  layersCollapsed,
  toggleLayerCollapse,
  setLayersVisible,
  deleteNodeById
} from "./store";

const NodeRow: Component<{ node: PenNode; depth: number }> = (props) => {
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

        <button
          onClick={(e) => {
            e.stopPropagation();
            deleteNodeById(props.node.id);
          }}
          class={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-black/10 transition shrink-0 ${
            isSelected() ? "text-white" : "text-neutral-400 hover:text-rose-600"
          }`}
          title="Delete layer"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Recursive Children */}
      <Show when={hasChildren() && !isCollapsed()}>
        <For each={childrenOf(props.node)}>
          {(child) => <NodeRow node={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </div>
  );
};

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

      <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar py-1">
        <For each={doc().children}>
          {(node) => <NodeRow node={node} depth={0} />}
        </For>
      </div>
    </div>
  );
};
