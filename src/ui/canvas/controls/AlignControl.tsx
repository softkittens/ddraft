import { For, Show, createMemo, type Component } from "solid-js";
import { Columns3, Rows3, LayoutFreeform, TriangleAlert } from "lucide-solid";
import { setNodeProperty, asOneEdit } from "../../store";
import type { FrameNode, PenNode } from "../../../model/types";
import {
  POSITIONS,
  DISTRIBUTIONS,
  cellToProperties,
  propertiesToCell,
  effectiveLayout,
  flexStyle,
  misreadNote,
  readAlignment,
  type Align,
  type Justify,
  type Layout
} from "../../../model/alignment";
import { ControlPopover } from "./ControlPopover";
import { isFrame, flowsChildren } from "./SpacingControls";
import { sharedValue } from "./values";

/**
 * Direction and alignment: where a frame's children actually sit.
 *
 * Every preview here is a real flex container rather than a drawing of one.
 * The engine's five justifyContent values were chosen to match flexbox, so a
 * div asked for the same thing lands the bars where the canvas will land the
 * children — the button shows the outcome rather than an artist's idea of it,
 * and cannot drift away from the engine without the drift being visible.
 */

const DIRECTIONS = [
  { value: "horizontal", label: "Row", icon: Columns3 },
  { value: "vertical", label: "Column", icon: Rows3 },
  { value: "none", label: "Free", icon: LayoutFreeform }
] as const;

/** Three bars in a box, arranged by whatever flex settings are handed in. */
const Preview: Component<{
  layout: Layout;
  justifyContent: Justify;
  alignItems: Align;
  size: number;
  wide?: boolean;
}> = (props) => {
  const vertical = () => props.layout === "vertical";
  const bar = () => Math.max(2, Math.round(props.size / 10));
  const long = () => Math.round(props.size * 0.45);
  return (
    <div
      class="flex pointer-events-none"
      style={{
        ...flexStyle(props.layout, props.justifyContent, props.alignItems),
        width: `${props.wide ? props.size * 2 : props.size}px`,
        height: `${props.size}px`,
        gap: `${Math.max(1, Math.round(props.size / 12))}px`
      }}
    >
      <For each={[0, 1, 2]}>
        {() => (
          <span
            class="rounded-[1px] bg-current shrink-0"
            style={{
              width: `${vertical() ? long() : bar()}px`,
              height: `${vertical() ? bar() : long()}px`
            }}
          />
        )}
      </For>
    </div>
  );
};

export const AlignControl: Component<{ nodes: () => readonly PenNode[] }> = (props) => {
  const frames = createMemo(() => props.nodes().filter(isFrame));
  /** Alignment is meaningless on a frame that positions its children itself. */
  const alignable = createMemo(() => props.nodes().filter(flowsChildren));

  const layout = createMemo(() =>
    sharedValue<Layout>(frames(), (node) => effectiveLayout((node as FrameNode).layout).value, String)
  );
  const justify = createMemo(() =>
    sharedValue<Justify>(alignable(), (node) => readAlignment(node).justifyContent.value, String)
  );
  const align = createMemo(() =>
    sharedValue<Align>(alignable(), (node) => readAlignment(node).alignItems.value, String)
  );

  /** What the trigger and the grid draw when the selection does not agree. */
  const shownLayout = (): Layout => layout().value ?? "horizontal";
  const shownJustify = (): Justify => justify().value ?? "start";
  const shownAlign = (): Align => align().value ?? "start";

  const activeCell = createMemo(() =>
    layout().mixed || justify().mixed || align().mixed
      ? null
      : propertiesToCell(shownLayout(), shownJustify(), shownAlign())
  );

  /*
   * One click, one undo step, and each frame asked in its own terms.
   *
   * The grid is spatial, so a selection holding a row and a column has to be
   * written two different ways to put both of their children in the same
   * corner. Grouping by value keeps that to one write per distinct answer
   * rather than one per node.
   */
  const setCell = (col: number, row: number): void => {
    const byJustify = new Map<Align, string[]>();
    const byAlign = new Map<Align, string[]>();
    for (const node of alignable()) {
      const direction = effectiveLayout((node as FrameNode).layout).value;
      const { justifyContent, alignItems } = cellToProperties(direction, col, row);
      byJustify.set(justifyContent, [...(byJustify.get(justifyContent) ?? []), node.id]);
      byAlign.set(alignItems, [...(byAlign.get(alignItems) ?? []), node.id]);
    }
    asOneEdit(() => {
      for (const [value, ids] of byJustify) setNodeProperty("justifyContent", value, ids);
      for (const [value, ids] of byAlign) setNodeProperty("alignItems", value, ids);
    });
  };

  /*
   * Changing direction keeps the children where they are.
   *
   * Turning a row into a column is a request about flow, not about position,
   * but justifyContent swaps axes underneath it — so left-packed and
   * top-aligned would become top-packed and left-aligned, and everything in the
   * frame would visibly jump. Rewriting the pair for the new direction holds
   * the same cell lit and the same corner occupied. A distributed frame has no
   * cell to hold, and space_between still means the same thing on either axis,
   * so that one is left alone.
   */
  const setDirection = (next: Layout): void => {
    const ids = frames().map((node) => node.id);
    const moves = new Map<string, { justifyContent: Align; alignItems: Align }>();
    if (next !== "none") {
      for (const node of alignable()) {
        const current = readAlignment(node);
        const cell = propertiesToCell(
          current.layout.value,
          current.justifyContent.value,
          current.alignItems.value
        );
        if (cell) moves.set(node.id, cellToProperties(next, cell.col, cell.row));
      }
    }
    asOneEdit(() => {
      setNodeProperty("layout", next, ids);
      for (const [id, pair] of moves) {
        setNodeProperty("justifyContent", pair.justifyContent, [id]);
        setNodeProperty("alignItems", pair.alignItems, [id]);
      }
    });
  };

  const setJustify = (value: Justify): void => {
    setNodeProperty("justifyContent", value, alignable().map((node) => node.id));
  };

  /*
   * What the file says, when the engine disagrees with it.
   *
   * This is the reason the control reads effective values rather than stored
   * ones. A frame written `space-between` renders packed to the start, and
   * without this line the grid would look simply wrong to whoever wrote it.
   * One click on any cell replaces the dead value with a live one.
   */
  const misreads = createMemo(() => {
    const seen = new Set<string>();
    for (const node of frames()) {
      const state = readAlignment(node);
      for (const [property, effective] of [
        ["layout", state.layout],
        ["justifyContent", state.justifyContent],
        ["alignItems", state.alignItems]
      ] as const) {
        const note = misreadNote(property, effective);
        if (note) seen.add(note);
      }
    }
    return [...seen].slice(0, 3);
  });

  const cellTitle = (col: number, row: number): string => {
    const pair = cellToProperties(shownLayout(), col, row);
    return `${POSITIONS[row]} ${POSITIONS[col]} — justifyContent ${pair.justifyContent}, alignItems ${pair.alignItems}`;
  };

  return (
    <ControlPopover
      label="Layout"
      width={196}
      trigger={() => (
        <span class="h-4 w-4 flex items-center justify-center rounded border border-black/15 text-neutral-700 p-[2px]">
          <Show when={shownLayout() !== "none"} fallback={<LayoutFreeform size={10} />}>
            <Preview
              layout={shownLayout()}
              justifyContent={shownJustify()}
              alignItems={shownAlign()}
              size={12}
            />
          </Show>
        </span>
      )}
    >
      <div class="grid grid-cols-3 gap-1 mb-2.5">
        <For each={DIRECTIONS}>
          {(direction) => (
            <button
              type="button"
              title={direction.label}
              aria-pressed={!layout().mixed && layout().value === direction.value}
              onClick={() => setDirection(direction.value)}
              class={`h-7 flex items-center justify-center gap-1 rounded-lg text-[10px] font-medium transition cursor-pointer ${
                !layout().mixed && layout().value === direction.value
                  ? "bg-neutral-900 text-white"
                  : "text-neutral-600 hover:bg-black/5"
              }`}
            >
              <direction.icon size={11} />
              {direction.label}
            </button>
          )}
        </For>
      </div>

      <Show
        when={shownLayout() !== "none"}
        fallback={
          <p class="text-[10px] leading-snug text-neutral-500 px-0.5">
            Children keep their own x and y. Alignment applies to frames in flow.
          </p>
        }
      >
        <div class="flex justify-center mb-2.5">
          <div class="grid grid-cols-3 gap-1">
            <For each={[0, 1, 2]}>
              {(row) => (
                <For each={[0, 1, 2]}>
                  {(col) => (
                    <button
                      type="button"
                      title={cellTitle(col, row)}
                      aria-pressed={activeCell()?.col === col && activeCell()?.row === row}
                      onClick={() => setCell(col, row)}
                      class={`h-[30px] w-[30px] flex items-center justify-center rounded-md border transition cursor-pointer ${
                        activeCell()?.col === col && activeCell()?.row === row
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600"
                      }`}
                    >
                      <Preview
                        layout={shownLayout()}
                        {...cellToProperties(shownLayout(), col, row)}
                        size={22}
                      />
                    </button>
                  )}
                </For>
              )}
            </For>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-1">
          <For each={DISTRIBUTIONS}>
            {(value) => (
              <button
                type="button"
                title={`justifyContent ${value}`}
                aria-pressed={!justify().mixed && justify().value === value}
                onClick={() => setJustify(value)}
                class={`h-7 flex items-center justify-center rounded-lg border transition cursor-pointer ${
                  !justify().mixed && justify().value === value
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600"
                }`}
              >
                <Preview
                  layout={shownLayout()}
                  justifyContent={value}
                  alignItems={shownAlign()}
                  size={18}
                  wide={shownLayout() === "horizontal"}
                />
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={misreads().length > 0}>
        <div class="mt-2.5 pt-2 border-t border-black/10 flex gap-1.5 text-amber-700">
          <TriangleAlert size={11} class="shrink-0 mt-[1px]" />
          <div class="text-[9.5px] leading-snug">
            <For each={misreads()}>{(note) => <div>{note}</div>}</For>
          </div>
        </div>
      </Show>
    </ControlPopover>
  );
};
