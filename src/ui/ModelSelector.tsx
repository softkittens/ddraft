import { Component, For, Show, createSignal, onMount, onCleanup, createMemo } from "solid-js";
import { ChevronDown, Check, Zap, Scale, Brain, Sparkles, Cpu } from "lucide-solid";
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

export const ModelSelector: Component<ModelSelectorProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  const activeModelInfo = createMemo(() => {
    const parsed = parseChoice(props.choice);
    if (!parsed) return { providerLabel: "Agent", modelLabel: "Default Model" };
    const provider = props.providers.find((p) => p.id === parsed.providerId);
    const model = provider?.models.find((m) => m.id === parsed.model);
    return {
      providerLabel: provider?.label || parsed.providerId,
      modelLabel: model?.label || parsed.model
    };
  });

  const effortIcons = {
    low: Zap,
    medium: Scale,
    high: Brain
  };

  const effortLabels = {
    low: "Low",
    medium: "Med",
    high: "High"
  };

  const effortDescriptions = {
    low: "Fast single-turn edits",
    medium: "Balanced UI design",
    high: "Deep multi-step reasoning"
  };

  // Close when clicking outside
  const handleClickOutside = (e: MouseEvent) => {
    if (open() && containerRef && !containerRef.contains(e.target as Node)) {
      setOpen(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  };

  onMount(() => {
    document.addEventListener("pointerdown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("pointerdown", handleClickOutside);
    document.removeEventListener("keydown", handleKeyDown);
  });

  const CurrentEffortIcon = () => {
    const Icon = effortIcons[props.effort] || Scale;
    return <Icon size={10} class={props.effort === "high" ? "text-purple-600" : props.effort === "low" ? "text-amber-500" : "text-blue-500"} />;
  };

  return (
    <div class="relative inline-block text-left" ref={containerRef}>
      {/* Trigger Capsule */}
      <button
        type="button"
        disabled={props.disabled || !props.configured}
        onClick={() => setOpen(!open())}
        class={`group h-6 px-2 rounded-lg flex items-center gap-1.5 text-xs transition border cursor-pointer select-none max-w-full ${
          open()
            ? "bg-neutral-100/90 border-neutral-300 text-neutral-900 shadow-2xs"
            : "bg-white/80 hover:bg-neutral-100/80 border-neutral-200/80 text-neutral-700 hover:text-neutral-900 shadow-2xs"
        } ${props.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
        title="Configure AI Model & Effort Level"
      >
        <span
          class={`w-1.5 h-1.5 rounded-full shrink-0 ${
            props.configured ? "bg-emerald-500" : "bg-amber-400"
          }`}
        />

        <span class="font-medium truncate max-w-[130px] text-[11px] text-neutral-800">
          {activeModelInfo().modelLabel}
        </span>

        <span class="text-neutral-300 text-[10px]">·</span>

        <div class="flex items-center gap-1 bg-neutral-100/80 group-hover:bg-white/90 border border-neutral-200/60 rounded px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 transition">
          <CurrentEffortIcon />
          <span>{effortLabels[props.effort]}</span>
        </div>

        <ChevronDown
          size={11}
          class={`text-neutral-400 transition-transform duration-150 shrink-0 ${
            open() ? "rotate-180 text-neutral-700" : "group-hover:text-neutral-600"
          }`}
        />
      </button>

      {/* Flyout Popover */}
      <Show when={open()}>
        <div class="absolute bottom-full left-0 mb-2 w-[310px] bg-white/98 backdrop-blur-md border border-neutral-200/90 rounded-2xl shadow-xl p-3 z-50 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div class="flex items-center justify-between border-b border-neutral-100 pb-2">
            <div class="flex items-center gap-1.5 text-xs font-semibold text-neutral-800">
              <Sparkles size={12} class="text-blue-500" />
              <span>Model & Intelligence</span>
            </div>
            <span class="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Pen AI</span>
          </div>

          {/* Section 1: Reasoning Effort Segmented Bar */}
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center justify-between text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
              <span>Reasoning Effort</span>
              <span class="text-[9.5px] text-neutral-400 font-normal lowercase">
                {effortDescriptions[props.effort]}
              </span>
            </div>

            <div class="grid grid-cols-3 gap-1 bg-neutral-100/90 p-1 rounded-xl border border-neutral-200/60">
              {(["low", "medium", "high"] as const).map((level) => {
                const isSelected = props.effort === level;
                const Icon = effortIcons[level];
                return (
                  <button
                    type="button"
                    onClick={() => {
                      props.onEffortChange(level);
                    }}
                    class={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition cursor-pointer ${
                      isSelected
                        ? "bg-white text-neutral-900 shadow-xs font-semibold border border-neutral-200/60"
                        : "text-neutral-500 hover:text-neutral-800 hover:bg-white/50"
                    }`}
                  >
                    <Icon
                      size={11}
                      class={
                        level === "high"
                          ? "text-purple-600"
                          : level === "low"
                          ? "text-amber-500"
                          : "text-blue-500"
                      }
                    />
                    <span class="text-[11px] capitalize">{level}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Model Selection List */}
          <div class="flex flex-col gap-1.5">
            <div class="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
              Available Models
            </div>

            <div class="max-h-52 overflow-y-auto custom-scrollbar flex flex-col gap-2 pr-0.5">
              <For each={props.providers}>
                {(p) => (
                  <div class="flex flex-col gap-0.5">
                    <div class="text-[10px] font-semibold text-neutral-400 px-2 py-0.5 uppercase tracking-wider flex items-center gap-1">
                      <Cpu size={9} />
                      <span>{p.label}</span>
                    </div>

                    <div class="flex flex-col gap-0.5">
                      <For each={p.models}>
                        {(m) => {
                          const val = choiceValue(p.id, m.id);
                          const isSelected = props.choice === val;
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                props.onChoiceChange(val);
                                setOpen(false);
                              }}
                              class={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition text-left cursor-pointer ${
                                isSelected
                                  ? "bg-blue-50 text-blue-900 font-semibold"
                                  : "text-neutral-700 hover:bg-neutral-100/80"
                              }`}
                            >
                              <span class="truncate text-[11.5px]">{m.label}</span>
                              <Show when={isSelected}>
                                <Check size={12} class="text-blue-600 shrink-0 ml-2" />
                              </Show>
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
