import { Component, For, Show } from "solid-js";
import {
  ChevronDown,
  ChevronRight,
  Frame,
  Square,
  Type,
  Layers,
  Component as ComponentIcon,
  Circle,
  X
} from "lucide-solid";
import type { PenNode } from "../model/types";
import { childrenOf } from "../model/tree";
import {
  resolvedDoc,
  selectedIds,
  selectNode,
  layersCollapsed,
  toggleLayerCollapse,
  setLayersVisible

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
        class={`flex items-center gap-1.5 h-7 pr-2 text-xs cursor-pointer transition select-none ${
          isSelected()
            ? "bg-[#0d99ff] text-white font-medium"
            : "text-neutral-700 hover:bg-neutral-100"
        }`}
      >
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

      {/* Recursive Children */}
      <Show when={hasChildren() && !isCollapsed()}>
        <For each={childrenOf(props.node)}>
          {(child) => <NodeRow node={child} depth={props.depth + 1} />}
        </For>
      </Show>
    </div>
  );
};

export const LayersPanel: Component = () => {
  return (
    <div class="w-60 bg-white border-r border-neutral-200 flex flex-col h-full z-20 select-none shadow-xs">
      <div class="h-9 px-3 border-b border-neutral-200 flex items-center justify-between font-semibold text-xs text-neutral-800 tracking-wide uppercase">
        <span>Layers</span>
        <button
          onClick={() => setLayersVisible(false)}
          class="text-neutral-400 hover:text-neutral-700 p-1 rounded transition"
          title="Close layers panel"
        >
          <X size={14} />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto custom-scrollbar py-1">
        <For each={resolvedDoc().children}>
          {(node) => <NodeRow node={node} depth={0} />}
        </For>
      </div>

    </div>
  );
};
