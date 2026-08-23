import { For, createSignal, type Component, type JSX } from "solid-js";
import { beginEdit, endEdit } from "../../store";
import { ControlPopover } from "./ControlPopover";

/**
 * A number chosen from the steps this document already uses, or typed.
 *
 * Font size, gap, padding and corner radius are all the same control: a short
 * row of the values in play, and a field underneath for a deliberate new one.
 * The order matters — `typography.ts` fails a screen for using more than six
 * font sizes or more than six spacing values, and a bare numeric field is how
 * a seventh gets made. The steps are the easy path and the field is the
 * considered one.
 */

export interface Step {
  label: string;
  value: number;
}

export interface StepPickerProps {
  label: string;
  /** What the toolbar button shows. */
  display: () => string;
  steps: () => Step[];
  /** The current value, for marking a step. Undefined when mixed or unset. */
  active: () => number | undefined;
  onPick: (value: number) => void;
  columns?: number;
  width?: number;
  min?: number;
  /** Extra fields below the grid, e.g. the four padding sides. */
  children?: JSX.Element;
}

export const StepPicker: Component<StepPickerProps> = (props) => {
  const [draft, setDraft] = createSignal<string | null>(null);

  const commit = (raw: string): void => {
    const parsed = Number(raw.trim());
    if (!Number.isFinite(parsed) || parsed < (props.min ?? 0)) return;
    props.onPick(parsed);
  };

  return (
    <ControlPopover
      label={props.label}
      width={props.width ?? 196}
      trigger={() => (
        <span class="text-[11px] font-medium text-neutral-700 tabular-nums px-1 whitespace-nowrap">
          {props.display()}
        </span>
      )}
    >
      <div
        class="grid gap-1.5 mb-2.5"
        style={{ "grid-template-columns": `repeat(${props.columns ?? 3}, minmax(0, 1fr))` }}
      >
        <For each={props.steps()}>
          {(step) => (
            <button
              type="button"
              onClick={() => props.onPick(step.value)}
              class={`h-7 rounded-md border text-[11px] font-medium tabular-nums transition cursor-pointer ${
                props.active() === step.value
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-700 hover:border-neutral-400"
              }`}
            >
              {step.label}
            </button>
          )}
        </For>
      </div>

      {props.children}

      <input
        type="number"
        min={props.min ?? 0}
        value={draft() ?? (props.active() ?? "")}
        placeholder={props.active() === undefined ? "Mixed" : props.label}
        onInput={(e) => {
          setDraft(e.currentTarget.value);
          commit(e.currentTarget.value);
        }}
        // Held open across the field: typing "24" writes 2 and then 24, and
        // only the 24 belongs on the undo stack.
        onFocus={beginEdit}
        onBlur={() => {
          setDraft(null);
          endEdit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
        }}
        class="w-full h-7 rounded-md border border-neutral-200 bg-white px-2 text-[11px] font-mono text-neutral-800 outline-none focus:border-neutral-400 transition"
      />
    </ControlPopover>
  );
};
