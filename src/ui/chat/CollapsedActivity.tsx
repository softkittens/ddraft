import { Component, Show } from "solid-js";
import { Loader, Square } from "lucide-solid";
import type { Entry, PendingStep } from "./types";
import { collapsedActivity } from "./types";

export const CollapsedActivity: Component<{
  entries: Entry[];
  pending: PendingStep | null;
  streamReasoning: string;
  streamText: string;
  running: boolean;
  elapsedSeconds?: number;
  onExpand: () => void;
  onStop: () => void;
}> = (props) => {
  const formattedElapsed = () => {
    const totalSecs = props.elapsedSeconds ?? 0;
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const activity = () =>
    collapsedActivity({
      entries: props.entries,
      pending: props.pending,
      streamReasoning: props.streamReasoning,
      streamText: props.streamText,
      running: props.running
    });

  return (
    <div class="flex items-center gap-2 px-3 pb-3 pt-0.5 min-h-0">
      <button
        type="button"
        onClick={props.onExpand}
        class="min-w-0 flex-1 flex items-center gap-2 rounded-xl bg-black/[0.03] px-2.5 py-2 text-left cursor-pointer hover:bg-black/[0.05] transition"
        title="Expand chat"
      >
        <Show when={activity().live}>
          <Loader size={12} class="shrink-0 animate-spin text-neutral-400" />
        </Show>
        <span class="min-w-0 flex-1 truncate text-[12px] text-neutral-700">
          <span class="font-medium">{activity().title}</span>
          <Show when={activity().detail}>
            {(detail) => <span class="text-neutral-400"> · {detail()}</span>}
          </Show>
        </span>
      </button>
      <Show when={props.running}>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[11px] tabular-nums font-mono text-neutral-400 select-none">
            {formattedElapsed()}
          </span>
          <button
            type="button"
            onClick={props.onStop}
            class="w-8 h-8 rounded-full bg-rose-200 hover:bg-rose-300 text-rose-800 flex items-center justify-center transition shrink-0"
            title="Stop generation"
          >
            <Square size={11} />
          </button>
        </div>
      </Show>
    </div>
  );
};
