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
    <div class="mr-auto w-full rounded-2xl bg-black/[0.03] text-[12px] overflow-hidden">
      <div class="flex items-center gap-1.5 px-3 py-2">
        <Eye size={12} class="text-neutral-400 shrink-0" />
        <span class="text-[11px] font-medium text-neutral-600">
          Visual review {props.entry.pass}
        </span>
        <span
          class={`ml-auto text-[10px] font-medium rounded-full px-2 py-0.5 ${
            review().verdict === "pass"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {review().verdict}
        </span>
      </div>

      <div class="px-3 pb-2.5 space-y-1.5">
        <Show when={props.entry.thumbnail}>
          {(src) => (
            <img
              src={src()}
              alt="The mockup the critic was shown"
              class="w-full max-h-44 object-contain rounded-xl bg-white"
            />
          )}
        </Show>

        <Show when={props.entry.sectionThumbnails && props.entry.sectionThumbnails.length > 0}>
          <div class="space-y-1 pt-1">
            <div class="text-[10px] font-medium text-neutral-400 uppercase tracking-wider">
              {props.entry.sectionThumbnails!.length} close-up views evaluated:
            </div>
            <div class="grid grid-cols-2 gap-1.5">
              <For each={props.entry.sectionThumbnails}>
                {(sec) => (
                  <div class="rounded-lg bg-white p-1 border border-black/[0.04] overflow-hidden space-y-1 shadow-2xs">
                    <div class="w-full h-20 bg-neutral-100/70 rounded flex items-center justify-center overflow-hidden">
                      <img src={sec.url} alt={sec.name} class="max-w-full max-h-full object-contain" />
                    </div>
                    <div class="text-[9px] text-neutral-600 truncate px-0.5 font-medium">{sec.name}</div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={by()}>
          {(who) => (
            <div class="text-[11px] text-neutral-500 leading-relaxed">
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
              <span class="rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-neutral-600">
                {name} <span class="font-semibold">{value}</span>/5
              </span>
            )}
          </For>
        </div>

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
