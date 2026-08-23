import { For, Show, type Component } from "solid-js";
import { resolvedDoc, layoutTree, setNodeProperty, asOneEdit, beginEdit, endEdit } from "../../store";
import { findParent } from "../../../model/tree";
import { findNodeWorldBox } from "../../../interaction/hittest";
import {
  MODE_LABELS,
  readSizeMode,
  sizeFallback,
  sizeModes,
  sizeWrites,
  type SizeAxis,
  type SizeMode
} from "../../../model/sizing";
import type { PenNode } from "../../../model/types";
import { ControlPopover } from "./ControlPopover";
import { sharedValue } from "./values";

/**
 * Width and height, as a mode rather than a number.
 *
 * This is the other half of the resize handles. Dragging an edge writes a
 * number, which turns a `fill_container` card into a fixed one and a hugging
 * label into a wrapped one — correct as a gesture, but until now a one-way
 * door, because nothing in the editor could write a sizing keyword back. The
 * only route to Hug or Fill was to ask the agent for it.
 *
 * Modes a node cannot use are not shown. Both of the ones that can be wrong
 * collapse it to zero silently, so hiding them is the difference between a
 * control and a trap.
 */

const AXES: readonly { axis: SizeAxis; label: string }[] = [
  { axis: "width", label: "W" },
  { axis: "height", label: "H" }
];

export const SizeControl: Component<{ nodes: () => readonly PenNode[] }> = (props) => {
  /** A node's parent decides whether it can fill, so it is read per node. */
  const parentOf = (node: PenNode): PenNode | null =>
    findParent(resolvedDoc().children, node.id);

  /** What the node is drawn at now — what Fixed should freeze. */
  const measured = (node: PenNode, axis: SizeAxis): number => {
    const box = findNodeWorldBox(layoutTree(), node.id);
    if (!box) return 0;
    return axis === "width" ? box.width : box.height;
  };

  /** Modes offered on an axis: the ones every selected node can actually use. */
  const offered = (axis: SizeAxis): SizeMode[] => {
    const lists = props.nodes().map((node) => sizeModes(node, parentOf(node), axis));
    if (lists.length === 0) return [];
    // Intersection, not union: a mode that would zero one of the selected nodes
    // is not something to offer for all of them.
    return lists[0].filter((mode) => lists.every((list) => list.includes(mode)));
  };

  const current = (axis: SizeAxis) =>
    sharedValue<SizeMode>(props.nodes(), (node) => readSizeMode(node, axis), String);

  const currentSize = (axis: SizeAxis) =>
    sharedValue<number>(props.nodes(), (node) => Math.round(measured(node, axis)), String);

  /*
   * One click, one undo step, and text gets both of its properties.
   *
   * Grouped by value like the alignment grid, because a mixed selection resolves
   * to different writes per node — a text node needs `textGrowth` alongside the
   * size, and a frame does not.
   */
  const apply = (axis: SizeAxis, mode: SizeMode, override?: number): void => {
    const grouped = new Map<string, { property: string; value: unknown; ids: string[] }>();
    for (const node of props.nodes()) {
      if (!sizeModes(node, parentOf(node), axis).includes(mode)) continue;
      const size = override ?? measured(node, axis);
      for (const write of sizeWrites(node, axis, mode, size)) {
        const key = `${write.property}:${JSON.stringify(write.value)}`;
        const entry = grouped.get(key) ?? { ...write, ids: [] };
        entry.ids.push(node.id);
        grouped.set(key, entry);
      }
    }
    if (grouped.size === 0) return;
    asOneEdit(() => {
      for (const { property, value, ids } of grouped.values()) setNodeProperty(property, value, ids);
    });
  };

  const typeSize = (axis: SizeAxis, raw: string): void => {
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed) || parsed < 1) return;
    // Typing a number means Fixed, so the mode comes along with it — otherwise
    // a number typed onto a hugging node would be stored and ignored.
    apply(axis, "fixed", parsed);
  };

  const summary = () => {
    const label = (axis: SizeAxis): string => {
      const mode = current(axis);
      if (mode.mixed) return "—";
      if (mode.value !== "fixed") return MODE_LABELS[mode.value ?? "hug"];
      const size = currentSize(axis);
      return size.mixed ? "—" : String(size.value ?? 0);
    };
    return `${label("width")}×${label("height")}`;
  };

  return (
    <ControlPopover
      label="Size"
      width={212}
      trigger={() => (
        <span class="text-[11px] font-medium text-neutral-700 tabular-nums">{summary()}</span>
      )}
    >
      <For each={AXES}>
        {(row) => {
          const modes = () => offered(row.axis);
          const mode = () => current(row.axis);
          const size = () => currentSize(row.axis);
          const fallback = () =>
            sharedValue<number>(props.nodes(), (node) => sizeFallback(node, row.axis), String);

          return (
            <div class="mb-2 last:mb-0">
              <div class="flex items-center gap-1.5">
                <span class="w-3 text-[10px] font-semibold text-neutral-400">{row.label}</span>

                {/*
                  Three separate questions, because "one mode" is not one case.
                  Text height has no number worth writing; a leaf outside flow
                  has no mode worth choosing but still takes a number. Keying
                  the whole row off the count conflated them, and left an
                  absolutely positioned rectangle showing neither.
                */}
                <div class="flex-1 flex items-center gap-0.5">
                  <Show when={modes().length > 1}>
                    <For each={modes()}>
                      {(option) => (
                        <button
                          type="button"
                          title={MODE_LABELS[option]}
                          aria-pressed={!mode().mixed && mode().value === option}
                          onClick={() => apply(row.axis, option)}
                          class={`h-6 flex-1 rounded-md text-[10px] font-medium transition cursor-pointer ${
                            !mode().mixed && mode().value === option
                              ? "bg-neutral-900 text-white"
                              : "text-neutral-600 hover:bg-black/5"
                          }`}
                        >
                          {MODE_LABELS[option]}
                        </button>
                      )}
                    </For>
                  </Show>

                  <Show when={modes().includes("fixed")}>
                    <input
                      type="number"
                      min="1"
                      aria-label={`${row.label} in pixels`}
                      value={size().mixed ? "" : Math.round(size().value ?? 0)}
                      placeholder={size().mixed ? "—" : ""}
                      disabled={modes().length > 1 && mode().value !== "fixed" && !mode().mixed}
                      onInput={(e) => typeSize(row.axis, e.currentTarget.value)}
                      onFocus={beginEdit}
                      onBlur={endEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                      }}
                      classList={{
                        "h-6 rounded border border-neutral-200 bg-white px-1 text-[10px] font-mono text-center text-neutral-800 outline-none focus:border-neutral-400 transition disabled:bg-neutral-50 disabled:text-neutral-400": true,
                        "w-11": modes().length > 1,
                        "flex-1": modes().length <= 1
                      }}
                    />
                  </Show>

                  {/* measureTextNode never reads node.height, so there is no
                      number to offer here â only what the engine already does. */}
                  <Show when={modes().length === 1 && modes()[0] === "hug"}>
                    <span class="text-[10px] text-neutral-500 px-1">
                      Auto — follows the wrapped text
                    </span>
                  </Show>
                </div>
              </div>

              <Show when={!fallback().mixed && fallback().value !== undefined}>
                <p class="text-[9.5px] text-neutral-500 mt-1 ml-[18px]">
                  minimum {fallback().value}px
                </p>
              </Show>
            </div>
          );
        }}
      </For>
    </ControlPopover>
  );
};
