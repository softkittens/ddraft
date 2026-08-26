import { Component, For, Show, Switch, Match, createMemo, createSignal, createEffect, onCleanup } from "solid-js";
import type { PublicProvider } from "../../agent/credentials";
import { ReviewCard } from "./ReviewCard";
import {
  NoticeBubble,
  UserBubble,
  AssistantBubble,
  ToolAccordion,
  ToolGroupAccordion,
  PendingStepBubble,
  ThinkingBubble,
  LiveStreamBubble,
  DisconnectedNotice,
  EmptyState
} from "./TranscriptRows";
import {
  type Entry,
  type NoteEntry,
  type ReviewEntry,
  type MessageEntry,
  type PendingStep,
  type DisplayItem,
  isUserMessage,
  isAssistantMessage,
  groupTranscriptEntries
} from "./types";
import { doc } from "../store";

const DisplayRow: Component<{
  item: DisplayItem;
  stickyUser?: boolean;
  expandedGroups: Set<number>;
  onToggleGroup: (idx: number) => void;
  expandedTools: Set<number>;
  onToggleTool: (idx: number) => void;
  providers: PublicProvider[];
}> = (props) => {
  return (
    <Switch>
      <Match when={props.item.type === "tool_group" ? props.item : null}>
        {(group) => {
          const g = group();
          if (g.entries.length === 1) {
            const idx = g.startIndex;
            return (
              <ToolAccordion
                item={g.entries[0]}
                expanded={props.expandedTools.has(idx)}
                onToggle={() => props.onToggleTool(idx)}
              />
            );
          }
          return (
            <ToolGroupAccordion
              items={g.entries}
              startIndex={g.startIndex}
              expanded={props.expandedGroups.has(g.startIndex)}
              onToggle={() => props.onToggleGroup(g.startIndex)}
              expandedToolIndices={props.expandedTools}
              onToggleToolIndex={props.onToggleTool}
            />
          );
        }}
      </Match>
      <Match when={props.item.type === "entry" ? props.item.entry : null}>
        {(entry) => (
          <Switch>
            <Match when={entry().kind === "note" ? entry() : null}>
              {(item) => <NoticeBubble item={item() as NoteEntry} />}
            </Match>
            <Match when={entry().kind === "review" ? entry() : null}>
              {(item) => (
                <ReviewCard
                  entry={item() as ReviewEntry}
                  providers={props.providers}
                />
              )}
            </Match>
            <Match when={isUserMessage(entry()) ? entry() : null}>
              {(item) => (
                <UserBubble
                  message={(item() as MessageEntry).message}
                  sticky={props.stickyUser}
                />
              )}
            </Match>
            <Match when={isAssistantMessage(entry()) ? entry() : null}>
              {(item) => <AssistantBubble message={(item() as MessageEntry).message} />}
            </Match>
          </Switch>
        )}
      </Match>
    </Switch>
  );
};

import { AccessCodeCard } from "./AccessCodeCard";

export const TranscriptList: Component<{
  entries: Entry[];
  streamReasoning?: string;
  streamText: string;
  pending: PendingStep | null;
  configured: boolean;
  requiresAccessCode?: boolean;
  authenticated?: boolean;
  onUnlock?: (code: string) => Promise<boolean>;
  providers: PublicProvider[];
  expanded: boolean;
  onSelectPrompt: (text: string) => void;
}> = (props) => {
  const [expandedTools, setExpandedTools] = createSignal<Set<number>>(new Set());
  const [expandedGroups, setExpandedGroups] = createSignal<Set<number>>(new Set());
  let containerRef: HTMLDivElement | undefined;

  const toggleSet = (set: Set<number>, val: number) => {
    const next = new Set(set);
    if (!next.delete(val)) next.add(val);
    return next;
  };

  const toggleTool = (idx: number) => setExpandedTools((prev) => toggleSet(prev, idx));
  const toggleGroup = (idx: number) => setExpandedGroups((prev) => toggleSet(prev, idx));

  const items = createMemo(() => groupTranscriptEntries(props.entries));
  const lastUserEntry = createMemo(() => {
    const list = props.entries;
    for (let i = list.length - 1; i >= 0; i--) {
      if (isUserMessage(list[i])) return list[i];
    }
    return null;
  });

  const isLocked = () => props.requiresAccessCode && !props.authenticated;

  const isEmpty = () =>
    props.configured && !isLocked() && props.entries.length === 0 && doc().children.length === 0;

  const scrollToBottom = () => {
    const parent = containerRef?.parentElement;
    if (parent) parent.scrollTop = parent.scrollHeight;
  };

  createEffect(() => {
    props.entries.length;
    props.streamText;
    props.pending;
    if (!props.expanded) return;
    scrollToBottom();
    const frame = requestAnimationFrame(scrollToBottom);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return (
    <div
      ref={containerRef}
      class="flex flex-col gap-2.5 select-text"
    >
      <Show when={isLocked()}>
        <div class="shrink-0 pt-1">
          <AccessCodeCard onUnlock={props.onUnlock || (async () => false)} />
        </div>
      </Show>

      <Show when={!props.configured && !isLocked()}>
        <div class="shrink-0 pt-1">
          <DisconnectedNotice />
        </div>
      </Show>

      <Show
        when={isEmpty()}
        fallback={
          <For each={items()}>
            {(item) => {
              const isSticky = () =>
                item.type === "entry" && item.entry === lastUserEntry();
              return (
                <DisplayRow
                  item={item}
                  stickyUser={isSticky()}
                  expandedGroups={expandedGroups()}
                  onToggleGroup={toggleGroup}
                  expandedTools={expandedTools()}
                  onToggleTool={toggleTool}
                  providers={props.providers}
                />
              );
            }}
          </For>
        }
      >
        <EmptyState onSelectPrompt={props.onSelectPrompt} />
      </Show>

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
  );
};
