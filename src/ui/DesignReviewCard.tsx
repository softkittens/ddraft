import { Component, For, Show } from "solid-js";
import type { DesignReview } from "../agent/review";

export const DesignReviewCard: Component<{
  review: DesignReview;
  onApply?: () => void;
}> = (props) => {
  return (
    <div class="mr-auto max-w-[96%] bg-indigo-50/70 border border-indigo-200/90 text-indigo-950 rounded-xl p-3 text-xs shadow-2xs space-y-2">
      <div class="font-semibold text-[11px] tracking-wide uppercase text-indigo-700">Visual review</div>
      <div class="grid grid-cols-4 gap-1 text-center">
        <Score label="Specific" value={props.review.scores.specificity} />
        <Score label="Hierarchy" value={props.review.scores.hierarchy} />
        <Score label="Usable" value={props.review.scores.usability} />
        <Score label="Craft" value={props.review.scores.craft} />
      </div>
      <Show when={props.review.strengths.length > 0}>
        <ul class="space-y-1 text-indigo-900/80">
          <For each={props.review.strengths}>{(s) => <li>• {s}</li>}</For>
        </ul>
      </Show>
      <Show when={props.review.issues.length > 0}>
        <div class="space-y-2">
          <For each={props.review.issues}>
            {(issue) => (
              <div class="bg-white/70 rounded-lg p-2 border border-indigo-100">
                <div class="font-medium">{issue.title}</div>
                <div class="text-[11px] text-indigo-900/70 mt-0.5">{issue.reason}</div>
                <div class="text-[11px] mt-1">{issue.instruction}</div>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.review.verdict === "refine" && props.onApply}>
        <button
          type="button"
          class="w-full mt-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium py-1.5"
          onClick={() => props.onApply?.()}
        >
          Apply review
        </button>
      </Show>
    </div>
  );
};

const Score: Component<{ label: string; value: number }> = (props) => (
  <div class="bg-white/80 rounded-md py-1 border border-indigo-100">
    <div class="text-[10px] text-indigo-500">{props.label}</div>
    <div class="font-semibold">{props.value}</div>
  </div>
);
