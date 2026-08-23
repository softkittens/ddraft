import { For, createMemo, type Component } from "solid-js";
import { AlignLeft, AlignCenter, AlignRight, AlignJustify } from "lucide-solid";
import { setNodeProperty } from "../../store";
import type { PenNode, TextNode } from "../../../model/types";
import { sharedValue } from "./values";

/**
 * Text alignment, inline rather than behind a popover.
 *
 * Four mutually exclusive options that each fit in an icon is the one shape
 * that costs less as a segmented control than as a menu — nothing is hidden
 * and the current one is visible without a click.
 */

const OPTIONS = [
  { value: "left", label: "Align left", icon: AlignLeft },
  { value: "center", label: "Align centre", icon: AlignCenter },
  { value: "right", label: "Align right", icon: AlignRight },
  { value: "justify", label: "Justify", icon: AlignJustify }
] as const;

export const TextAlignControl: Component<{ nodes: () => readonly PenNode[] }> = (props) => {
  const textNodes = createMemo(() => props.nodes().filter((node) => node.type === "text"));
  // Unset reads as left, which is what the engine draws.
  const current = createMemo(() =>
    sharedValue<string>(textNodes(), (node) => (node as TextNode).textAlign ?? "left", String)
  );

  return (
    <div class="flex items-center gap-0.5">
      <For each={OPTIONS}>
        {(option) => (
          <button
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={current().value === option.value}
            onClick={() =>
              setNodeProperty("textAlign", option.value, textNodes().map((node) => node.id))
            }
            class={`h-7 w-7 flex items-center justify-center rounded-lg transition cursor-pointer ${
              current().value === option.value
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-black/5"
            }`}
          >
            <option.icon size={13} />
          </button>
        )}
      </For>
    </div>
  );
};
