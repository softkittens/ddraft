import { Component, For, Show, createSignal, createMemo, createUniqueId, onMount, onCleanup } from "solid-js";
import { ChevronDown, Check, Sparkles, Search } from "lucide-solid";
import type { PublicProvider } from "../agent/credentials";

export type ReasoningEffort = "low" | "medium" | "high";

export interface ModelSelectorProps {
  providers: PublicProvider[];
  configured: boolean;
  choice: string;
  onChoiceChange: (choice: string) => void;
  effort: ReasoningEffort;
  onEffortChange: (effort: ReasoningEffort) => void;
  disabled?: boolean;
}

export function choiceValue(providerId: string, model: string): string {
  return `${providerId}:${model}`;
}

export function parseChoice(value: string): { providerId: string; model: string } | null {
  const split = value.indexOf(":");
  if (split <= 0) return null;
  return { providerId: value.slice(0, split), model: value.slice(split + 1) };
}

function modelBlurb(modelId: string): string {
  const id = modelId.toLowerCase();
  if (id.includes("flash") || id.includes("turbo") || id.includes("mini")) {
    return "Faster edits.";
  }
  if (id.includes("pro") || id.includes("max") || id.startsWith("o") || id.includes("codex")) {
    return "Prioritizes quality and reasoning.";
  }
  return "Designs and edits the canvas.";
}

function matchesQuery(query: string, providerLabel: string, modelId: string, modelLabel: string): boolean {
  if (!query) return true;
  return (
    modelLabel.toLowerCase().includes(query) ||
    modelId.toLowerCase().includes(query) ||
    providerLabel.toLowerCase().includes(query)
  );
}

export const ModelSelector: Component<ModelSelectorProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  const listId = createUniqueId();
  let containerRef: HTMLDivElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const activeLabel = createMemo(() => {
    const parsed = parseChoice(props.choice);
    if (!parsed) return "Model";
    const provider = props.providers.find((p) => p.id === parsed.providerId);
    const model = provider?.models.find((m) => m.id === parsed.model);
    return model?.label || parsed.model;
  });

  const q = () => query().trim().toLowerCase();

  const visibleModels = (provider: PublicProvider) =>
    provider.models.filter((m) => matchesQuery(q(), provider.label, m.id, m.label));

  const flat = createMemo(() =>
    props.providers.flatMap((p) =>
      visibleModels(p).map((m) => ({
        value: choiceValue(p.id, m.id),
        label: m.label
      }))
    )
  );

  const close = () => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  const openMenu = () => {
    if (props.disabled || !props.configured) return;
    const all = props.providers.flatMap((p) => p.models.map((m) => choiceValue(p.id, m.id)));
    const current = all.indexOf(props.choice);
    setQuery("");
    setActiveIndex(current >= 0 ? current : 0);
    setOpen(true);
  };

  const selectValue = (value: string) => {
    props.onChoiceChange(value);
    close();
  };

  const selectActive = () => {
    const item = flat()[activeIndex()];
    if (item) selectValue(item.value);
  };

  const moveActive = (delta: number) => {
    const n = flat().length;
    if (n === 0) return;
    setActiveIndex((i) => (i + delta + n) % n);
    queueMicrotask(() => {
      const el = listRef?.querySelector("[data-active='true']");
      if (el instanceof HTMLElement) el.scrollIntoView({ block: "nearest" });
    });
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (open() && containerRef && !containerRef.contains(e.target as Node)) {
      close();
    }
  };

  const handleDocumentKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open()) close();
  };

  const handleSearchKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(1);
        return;
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1);
        return;
      case "Enter":
        e.preventDefault();
        e.stopPropagation();
        selectActive();
        return;
      case "Escape":
        e.preventDefault();
        close();
        return;
      case "Tab":
        close();
        return;
      default:
        return;
    }
  };

  onMount(() => {
    document.addEventListener("pointerdown", handleClickOutside);
    document.addEventListener("keydown", handleDocumentKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("pointerdown", handleClickOutside);
    document.removeEventListener("keydown", handleDocumentKeyDown);
  });

  return (
    <div class="relative inline-block text-left" ref={containerRef}>
      <button
        type="button"
        disabled={props.disabled || !props.configured}
        onClick={() => (open() ? close() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={listId}
        class={`h-7 pl-2.5 pr-2 rounded-full flex items-center gap-1 text-[12px] font-medium cursor-pointer select-none max-w-full transition ${
          open()
            ? "bg-neutral-200/90 text-neutral-900"
            : "bg-neutral-100 text-neutral-800 hover:bg-neutral-200/70"
        } ${props.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
        title="Choose model"
      >
        <span class="truncate max-w-[148px]">{activeLabel()}</span>
        <ChevronDown
          size={12}
          stroke-width={2}
          class={`text-neutral-500 shrink-0 transition-transform duration-150 ${open() ? "rotate-180" : ""}`}
        />
      </button>

      <Show when={open()}>
        <div class="absolute bottom-full left-0 mb-3 w-[300px] rounded-[22px] bg-white/95 backdrop-blur-xl border border-black/[0.08] shadow-[0_18px_50px_rgba(15,15,15,0.16),0_2px_6px_rgba(15,15,15,0.06)] p-1.5 z-50">
          <div class="flex items-center gap-2 mx-0.5 mb-1 px-2.5 h-8 rounded-[14px] bg-black/[0.04]">
            <Search size={13} class="text-neutral-400 shrink-0" />
            <input
              ref={(el) => {
                queueMicrotask(() => el.focus());
              }}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={flat()[activeIndex()] ? `${listId}-${activeIndex()}` : undefined}
              value={query()}
              onInput={(e) => {
                setQuery(e.currentTarget.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search models"
              class="w-full bg-transparent text-[13px] text-neutral-800 placeholder:text-neutral-400 focus:outline-none select-text"
            />
          </div>

          <div
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label="Models"
            class="max-h-72 overflow-y-auto custom-scrollbar flex flex-col p-0.5"
          >
            <Show when={flat().length === 0}>
              <div class="px-2.5 py-3 text-[12px] text-neutral-400">No models match</div>
            </Show>
            <For each={props.providers}>
              {(p) => (
                <Show when={visibleModels(p).length > 0}>
                  <div class="flex flex-col">
                    <div class="px-2.5 pt-2.5 pb-1.5 text-[11px] font-medium text-neutral-400 tracking-wide">
                      {p.label}
                    </div>
                    <For each={visibleModels(p)}>
                      {(m) => {
                        const val = choiceValue(p.id, m.id);
                        const selected = () => props.choice === val;
                        const isActive = () => flat()[activeIndex()]?.value === val;
                        const optionIndex = () => flat().findIndex((item) => item.value === val);
                        return (
                          <button
                            type="button"
                            id={`${listId}-${optionIndex()}`}
                            role="option"
                            aria-selected={selected()}
                            data-active={isActive() ? "true" : "false"}
                            onMouseEnter={() => {
                              const idx = optionIndex();
                              if (idx >= 0) setActiveIndex(idx);
                            }}
                            onClick={() => selectValue(val)}
                            class={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[16px] text-left cursor-pointer transition ${
                              isActive() ? "bg-black/[0.07]" : "hover:bg-black/[0.04]"
                            }`}
                          >
                            <Sparkles size={14} class="text-neutral-800 shrink-0 mt-0.5" />
                            <div class="min-w-0 flex-1">
                              <div class="text-[13px] font-semibold text-neutral-900 leading-tight">
                                {m.label}
                              </div>
                              <div class="text-[11px] text-neutral-500 leading-snug mt-0.5">
                                {modelBlurb(m.id)}
                              </div>
                            </div>
                            <Show when={selected()}>
                              <Check size={14} stroke-width={2.2} class="text-neutral-900 shrink-0 mt-0.5" />
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              )}
            </For>
          </div>

          <div class="flex items-center gap-0.5 mx-0.5 mt-1 px-1.5 pt-1.5 pb-0.5 border-t border-black/[0.06]">
            {(["low", "medium", "high"] as const).map((level) => (
              <button
                type="button"
                onClick={() => props.onEffortChange(level)}
                class={`flex-1 h-6 rounded-full text-[11px] font-medium capitalize cursor-pointer transition ${
                  props.effort === level
                    ? "bg-black/[0.08] text-neutral-900"
                    : "text-neutral-500 hover:text-neutral-800 hover:bg-black/[0.04]"
                }`}
              >
                {level}
              </button>
            ))}
          </div>
        </div>
      </Show>
    </div>
  );
};
