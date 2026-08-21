import { Component, For, Show } from "solid-js";
import { Eye } from "lucide-solid";
import type { PublicProvider } from "../../agent/credentials";
import { type ReviewEntry, modelLabel } from "./types";

export const ReviewCard: Component<{
  entry: ReviewEntry;
  providers: PublicProvider[];
}> = (props) => {
  const review = () => props.entry.review;
  const by = () => review().reviewedBy;
  const scores = () => Object.entries(review().scores) as [string, number][];

  return (
    <div class="mr-auto w-full max-w-[96%] rounded-xl border border-indigo-200/70 bg-indigo-50/40 text-xs shadow-2xs overflow-hidden">
      <div class="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-indigo-200/60 bg-indigo-50/70">
        <Eye size={11} class="text-indigo-500 shrink-0" />
        <span class="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
          Visual review {props.entry.pass}
        </span>
        <span
          class={`ml-auto text-[9px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
            review().verdict === "pass"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {review().verdict}
        </span>
      </div>

      <div class="px-2.5 py-2 space-y-1.5">
        <Show when={props.entry.thumbnail}>
          {(src) => (
            <img
              src={src()}
              alt="The mockup the critic was shown"
              class="w-full max-h-44 object-contain rounded-md border border-indigo-200/60 bg-white"
            />
          )}
        </Show>

        <Show when={by()}>
          {(who) => (
            <div class="text-[10px] text-indigo-900/70 leading-relaxed">
              Read by <span class="font-medium">{modelLabel(props.providers, who().providerId, who().model)}</span>
              <Show when={who().handoff}>
                {(why) => <span class="opacity-70"> — {why()}</span>}
              </Show>
            </div>
          )}
        </Show>

        <div class="flex flex-wrap gap-1">
          <For each={scores()}>
            {([name, value]) => (
              <span class="rounded bg-white/80 border border-indigo-200/60 px-1.5 py-0.5 text-[10px] text-indigo-900">
                {name} <span class="font-semibold">{value}</span>/5
              </span>
            )}
          </For>
        </div>

        <Show when={props.entry.applied > 0}>
          <div class="text-[10px] text-indigo-900/70">
            {props.entry.applied} propert{props.entry.applied === 1 ? "y" : "ies"} corrected directly.
          </div>
        </Show>

        <Show when={review().issues.length > 0}>
          <ul class="space-y-1 pt-0.5">
            <For each={review().issues}>
              {(issue) => (
                <li class="text-[11px] text-neutral-700 leading-relaxed">
                  <span class="font-medium text-neutral-900">{issue.title}</span>
                  <span class="opacity-70"> — {issue.instruction}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
};
