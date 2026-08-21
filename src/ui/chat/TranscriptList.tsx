import { Component, For, Show, Switch, Match, createSignal, createEffect } from "solid-js";
import type { PublicProvider } from "../../agent/credentials";
import { ReviewCard } from "./ReviewCard";
import {
  NoticeBubble,
  UserBubble,
  AssistantBubble,
  ToolAccordion,
  PendingStepBubble,
  LiveStreamBubble,
  DisconnectedNotice,
  EmptyState
} from "./TranscriptRows";
import {
  type Entry,
  type PendingStep,
  isUserMessage,
  isAssistantMessage,
  isToolMessage
} from "./types";
import { doc } from "../store";

export const TranscriptList: Component<{
  entries: Entry[];
  streamText: string;
  pending: PendingStep | null;
  configured: boolean;
  providers: PublicProvider[];
  onSelectPrompt: (text: string) => void;
}> = (props) => {
  const [expandedTools, setExpandedTools] = createSignal<Set<number>>(new Set());
  let containerRef: HTMLDivElement | undefined;

  const toggleTool = (idx: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  createEffect(() => {
    props.entries.length;
    props.streamText;
    props.pending;
    if (containerRef) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  });

  return (
    <div
      ref={containerRef}
      class="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 min-h-0 bg-neutral-50/30"
    >
      <Show when={!props.configured}>
        <DisconnectedNotice />
      </Show>

      <Show when={props.configured && props.entries.length === 0 && doc().children.length === 0}>
        <EmptyState onSelectPrompt={props.onSelectPrompt} />
      </Show>

      <For each={props.entries}>
        {(entry, i) => (
          <div class="flex flex-col">
            <Switch>
              <Match when={entry.kind === "note" ? entry : null}>
                {(item) => <NoticeBubble item={item()} />}
              </Match>
              <Match when={entry.kind === "review" ? entry : null}>
                {(item) => <ReviewCard entry={item()} providers={props.providers} />}
              </Match>
              <Match when={isUserMessage(entry) ? entry : null}>
                {(item) => <UserBubble message={item().message} />}
              </Match>
              <Match when={isAssistantMessage(entry) ? entry : null}>
                {(item) => <AssistantBubble message={item().message} />}
              </Match>
              <Match when={isToolMessage(entry) ? entry : null}>
                {(item) => (
                  <ToolAccordion
                    item={item()}
                    expanded={expandedTools().has(i())}
                    onToggle={() => toggleTool(i())}
                  />
                )}
              </Match>
            </Switch>
          </div>
        )}
      </For>

      <Show when={props.pending}>
        {(step) => <PendingStepBubble step={step()} />}
      </Show>

      <Show when={props.streamText}>
        {(text) => <LiveStreamBubble text={text()} />}
      </Show>
    </div>
  );
};
