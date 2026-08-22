import type { Component } from "solid-js";

/** Vector-pen diamond on an X — bezier handles, not a cancel-edit glyph. */
export const PenXLogo: Component = () => {
  return (
    <span class="inline-flex items-center gap-1.5 text-neutral-800 drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]" aria-label="PenX">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        class="shrink-0"
      >
        <path
          d="M6.4 5.2 L17.6 18.8"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
        />
        <path
          d="M17.6 5.2 L6.4 18.8"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
        />
        <path
          d="M12 6.8 L15.35 11.15 L12 17.4 L8.65 11.15 Z"
          fill="currentColor"
        />
      </svg>
      <span class="text-[15px] font-semibold tracking-tight">PenX</span>
    </span>
  );
};
