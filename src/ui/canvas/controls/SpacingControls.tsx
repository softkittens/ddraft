import { For, createMemo, type Component } from "solid-js";
import { spacingScale, setNodeProperty, beginEdit, endEdit } from "../../store";
import { normalisePadding, compactPadding } from "../../../layout/padding";
import type { FrameNode, PenNode } from "../../../model/types";
import { StepPicker } from "./StepPicker";
import { sharedValue } from "./values";

/**
 * Gap and padding, the two numbers that decide how a frame breathes.
 *
 * Both are offered as the spacing steps already in the document, for the same
 * reason font size is: `typography.ts` fails a screen for odd spacing values
 * and for having more than six of them.
 */

export function isFrame(node: PenNode): node is FrameNode {
  return node.type === "frame";
}

/** A frame in flow. `layout: "none"` places children itself and ignores gap. */
export function flowsChildren(node: PenNode): boolean {
  return isFrame(node) && node.layout !== "none";
}

export const GapControl: Component<{ nodes: () => readonly PenNode[] }> = (props) => {
  const frames = createMemo(() => props.nodes().filter(flowsChildren));
  const current = createMemo(() =>
    sharedValue<number>(frames(), (node) => (node as FrameNode).gap ?? 0, String)
  );

  return (
    <StepPicker
      label="Gap"
      display={() => (current().mixed ? "Mixed" : `${current().value ?? 0}`)}
      steps={() => [
        { label: "0", value: 0 },
        ...spacingScale().map((step: number) => ({ label: String(step), value: step }))
      ]}
      active={() => current().value}
      onPick={(value) => setNodeProperty("gap", value, frames().map((node) => node.id))}
    />
  );
};

const SIDES = [
  { key: "top", label: "T" },
  { key: "right", label: "R" },
  { key: "bottom", label: "B" },
  { key: "left", label: "L" }
] as const;

export const PaddingControl: Component<{ nodes: () => readonly PenNode[] }> = (props) => {
  const frames = createMemo(() => props.nodes().filter(isFrame));

  const sides = createMemo(() =>
    sharedValue(
      frames(),
      (node) => normalisePadding((node as FrameNode).padding),
      (p) => `${p.top}/${p.right}/${p.bottom}/${p.left}`
    )
  );

  /** The one number, when every edge of every frame agrees. */
  const uniform = createMemo(() => {
    const value = sides().value;
    if (!value) return undefined;
    const { top, right, bottom, left } = value;
    return top === right && right === bottom && bottom === left ? top : undefined;
  });

  const label = () => {
    if (sides().mixed) return "Mixed";
    const value = sides().value;
    if (!value) return "0";
    const single = uniform();
    if (single !== undefined) return String(single);
    // Shown rather than flattened: a control that displayed one number for
    // [24, 16] would be inviting a click that silently discards the other.
    return value.top === value.bottom && value.right === value.left
      ? `${value.top}·${value.right}`
      : `${value.top}·${value.right}·${value.bottom}·${value.left}`;
  };

  const setAll = (value: number): void => {
    setNodeProperty("padding", value, frames().map((node) => node.id));
  };

  const setSide = (side: (typeof SIDES)[number]["key"], raw: string): void => {
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed) || parsed < 0) return;
    for (const node of frames()) {
      const next = { ...normalisePadding((node as FrameNode).padding), [side]: parsed };
      setNodeProperty("padding", compactPadding(next), [node.id]);
    }
  };

  return (
    <StepPicker
      label="Padding"
      width={208}
      display={label}
      steps={() => [
        { label: "0", value: 0 },
        ...spacingScale().map((step: number) => ({ label: String(step), value: step }))
      ]}
      active={uniform}
      onPick={setAll}
    >
      <div class="grid grid-cols-4 gap-1.5 mb-2.5">
        <For each={SIDES}>
          {(side) => (
            <label class="flex flex-col items-center gap-0.5">
              <span class="text-[9px] font-semibold text-neutral-400">{side.label}</span>
              <input
                type="number"
                min="0"
                value={sides().value?.[side.key] ?? ""}
                placeholder={sides().mixed ? "—" : "0"}
                onInput={(e) => setSide(side.key, e.currentTarget.value)}
                onFocus={beginEdit}
                onBlur={endEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                }}
                class="w-full h-6 rounded border border-neutral-200 bg-white px-1 text-[10px] font-mono text-center text-neutral-800 outline-none focus:border-neutral-400 transition"
              />
            </label>
          )}
        </For>
      </div>
    </StepPicker>
  );
};
