import { Component, For, Show, Switch, Match, createMemo, createSignal, createEffect } from "solid-js";
import type { PublicProvider } from "../../agent/credentials";
import { ReviewCard } from "./ReviewCard";
import {
  NoticeBubble,
  UserBubble,
  AssistantBubble,
  ToolAccordion,
  PendingStepBubble,
  ThinkingBubble,
  LiveStreamBubble,
  DisconnectedNotice,
  EmptyState
} from "./TranscriptRows";
import {
  type Entry,
  type MessageEntry,
  type PendingStep,
  isUserMessage,
  isAssistantMessage,
  isToolMessage
} from "./types";
import { doc } from "../store";

const ThreadRow: Component<{
  entry: Entry;
  expanded: boolean;
  onToggleTool: () => void;
  providers: PublicProvider[];
}> = (props) => {
  return (
    <Switch>
      <Match when={props.entry.kind === "note" ? props.entry : null}>
        {(item) => <NoticeBubble item={item()} />}
      </Match>
      <Match when={props.entry.kind === "review" ? props.entry : null}>
        {(item) => <ReviewCard entry={item()} providers={props.providers} />}
      </Match>
      <Match when={isUserMessage(props.entry) ? props.entry : null}>
        {(item) => <UserBubble message={item().message} />}
      </Match>
      <Match when={isAssistantMessage(props.entry) ? props.entry : null}>
        {(item) => <AssistantBubble message={item().message} />}
      </Match>
      <Match when={isToolMessage(props.entry) ? props.entry : null}>
        {(item) => (
          <ToolAccordion
            item={item() as MessageEntry}
            expanded={props.expanded}
            onToggle={props.onToggleTool}
          />
        )}
      </Match>
    </Switch>
  );
};

export const TranscriptList: Component<{
  entries: Entry[];
  streamReasoning?: string;
  streamText: string;
  pending: PendingStep | null;
  configured: boolean;
  providers: PublicProvider[];
  onSelectPrompt: (text: string) => void;
}> = (props) => {
  const [expandedTools, setExpandedTools] = createSignal<Set<number>>(new Set());
  let containerRef: HTMLDivElement | undefined;

  const lastUserIndex = createMemo(() => {
    let last = -1;
    props.entries.forEach((entry, i) => {
      if (isUserMessage(entry)) last = i;
    });
    return last;
  });

  const lastUser = createMemo(() => {
    const idx = lastUserIndex();
    if (idx < 0) return null;
    const entry = props.entries[idx];
    return isUserMessage(entry) ? entry : null;
  });

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
    <div class="h-full min-h-0 flex flex-col">
      <Show when={lastUser()}>
        {(entry) => (
          <div class="shrink-0 px-3 pt-0.5 pb-2 relative z-10">
            <UserBubble message={entry().message} pinned />
          </div>
        )}
      </Show>

      <div
        ref={containerRef}
        class="flex-1 overflow-y-auto custom-scrollbar px-3 pb-3 space-y-2.5 min-h-0"
      >
        <Show when={!props.configured}>
          <DisconnectedNotice />
        </Show>

        <Show when={props.configured && props.entries.length === 0 && doc().children.length === 0}>
          <EmptyState onSelectPrompt={props.onSelectPrompt} />
        </Show>

        <For each={props.entries}>
          {(entry, i) => (
            <Show when={i() !== lastUserIndex()}>
              <ThreadRow
                entry={entry}
                expanded={expandedTools().has(i())}
                onToggleTool={() => toggleTool(i())}
                providers={props.providers}
              />
            </Show>
          )}
        </For>

        <Show when={props.pending}>
          {(step) => <PendingStepBubble step={step()} />}
        </Show>

        <Show when={props.streamReasoning}>
          {(text) => <ThinkingBubble text={text()} />}
        </Show>

        <Show when={props.streamText}>
          {(text) => <LiveStreamBubble text={text()} />}
        </Show>
      </div>
    </div>
  );
};
