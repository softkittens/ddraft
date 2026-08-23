import { For, Show, createMemo, createSignal, type Component } from "solid-js";
import { doc, swatches, setNodeProperty, beginEdit, endEdit } from "../../store";
import { resolveVariable } from "../../../model/variables";
import type { PenNode } from "../../../model/types";
import { ControlPopover } from "./ControlPopover";
import { fillKey, fillOf, sharedValue, type FillKind } from "./values";

/**
 * The colour a selection is painted with.
 *
 * Tokens are offered first and a token is what gets written — picking
 * "$accent-primary" keeps the node tied to the palette, so retheming the
 * document still moves it. The hex field below is the deliberate second
 * choice, not the default one.
 */

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const FillControl: Component<{ nodes: () => readonly PenNode[] }> = (props) => {
  const [draft, setDraft] = createSignal<string | null>(null);

  const current = createMemo(() => sharedValue<FillKind>(props.nodes(), fillOf, fillKey));
  const swatch = createMemo(() => {
    const fill = current().value;
    if (!fill || fill.kind !== "solid") return null;
    return { token: fill.value, color: resolveVariable(fill.value, doc().variables) || fill.value };
  });

  const write = (value: string): void => {
    setNodeProperty("fill", value);
  };

  const commitHex = (raw: string): void => {
    const text = raw.trim();
    const value = text.startsWith("#") ? text : `#${text}`;
    if (HEX_PATTERN.test(value)) write(value);
    setDraft(null);
  };

  return (
    <ControlPopover
      label="Fill"
      trigger={() => (
        <>
          <Chip fill={current().value} mixed={current().mixed} color={swatch()?.color} />
          <span class="text-[11px] font-medium text-neutral-700 tabular-nums pr-0.5">
            {current().mixed
              ? "Mixed"
              : swatch()
                ? swatch()!.token.replace(/^\$/, "").replace(/^#/, "").toUpperCase()
                : current().value?.kind === "other"
                  ? "Image"
                  : "None"}
          </span>
        </>
      )}
    >
      <Show
        when={swatches().length > 0}
        fallback={<div class="text-[11px] text-neutral-400 px-0.5 pb-2">This document has no colours yet.</div>}
      >
        <div class="grid grid-cols-6 gap-1.5 mb-2.5">
          <For each={swatches()}>
            {(item) => {
              const active = () => {
                const fill = current().value;
                return fill?.kind === "solid" && fill.value.toLowerCase() === item.token.toLowerCase();
              };
              return (
                <button
                  type="button"
                  title={`${item.label}  ${item.value}`}
                  onClick={() => write(item.token)}
                  class={`h-6 w-full rounded-md border transition cursor-pointer ${
                    active()
                      ? "border-neutral-900 ring-1 ring-neutral-900/20"
                      : "border-black/10 hover:border-black/25"
                  }`}
                  style={{ background: item.value }}
                />
              );
            }}
          </For>
        </div>
      </Show>

      <input
        type="text"
        spellcheck={false}
        value={draft() ?? (swatch()?.color ?? "")}
        placeholder={current().mixed ? "Mixed" : "#000000"}
        onInput={(e) => setDraft(e.currentTarget.value)}
        // One undo step for the whole field, however many characters it took.
        onFocus={beginEdit}
        onBlur={(e) => {
          commitHex(e.currentTarget.value);
          endEdit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        class="w-full h-7 rounded-md border border-neutral-200 bg-white px-2 text-[11px] font-mono text-neutral-800 outline-none focus:border-neutral-400 transition"
      />
    </ControlPopover>
  );
};

const Chip: Component<{ fill: FillKind | undefined; mixed: boolean; color?: string }> = (props) => (
  <span
    class="h-4 w-4 rounded-[5px] border border-black/15 shrink-0"
    style={
      props.mixed || props.fill?.kind === "other" || !props.color
        ? {
            // A diagonal rule reads as "not one colour" without inventing one.
            background:
              "repeating-linear-gradient(45deg, #fff 0 3px, #cbd5e1 3px 6px)"
          }
        : { background: props.color }
    }
  />
);
