import { Component, Show, For, createSignal, createEffect, onCleanup } from "solid-js";
import { Activity, ChevronDown, ChevronUp, AlertTriangle } from "lucide-solid";
import { telemetry, type FrameSample, type LogEntry } from "../telemetry/logger";

export const PerfHUD: Component = () => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [latestSample, setLatestSample] = createSignal<FrameSample | null>(null);
  const [fps, setFps] = createSignal(60);
  const [recentLogs, setRecentLogs] = createSignal<LogEntry[]>([]);

  // Subscribe to telemetry only when HUD is open
  createEffect(() => {
    if (!isOpen()) return;

    setRecentLogs(telemetry.getRecentLogs());
    const unsubscribe = telemetry.subscribe((sample, currentFps) => {
      setLatestSample(sample);
      setFps(currentFps);
      setRecentLogs(telemetry.getRecentLogs());
    });

    onCleanup(unsubscribe);
  });

  const getFpsColor = () => {
    const f = fps();
    if (f >= 55) return "text-emerald-600 bg-emerald-50 border-emerald-200";
    if (f >= 30) return "text-amber-600 bg-amber-50 border-amber-200";
    return "text-rose-600 bg-rose-50 border-rose-200";
  };

  return (
    <div class="fixed bottom-4 right-4 z-40 select-none font-mono text-[11px]">
      {/* Collapsed Pill Button */}
      <div
        onClick={() => setIsOpen(!isOpen())}
        class={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl shadow-lg border backdrop-blur-md cursor-pointer transition ${
          isOpen() ? "bg-white/95 border-neutral-300" : "bg-white/80 border-neutral-200 hover:bg-white"
        }`}
      >
        <Activity size={13} class={fps() >= 50 ? "text-emerald-500" : "text-amber-500"} />
        <span class={`font-bold px-1.5 py-0.5 rounded border text-[10px] ${getFpsColor()}`}>
          {fps()} FPS
        </span>
        <Show when={latestSample()}>
          <span class="text-neutral-500">
            {latestSample()?.totalTime.toFixed(1)}ms
          </span>
        </Show>
        <button class="text-neutral-400 hover:text-neutral-700">
          <Show when={isOpen()} fallback={<ChevronUp size={12} />}>
            <ChevronDown size={12} />
          </Show>
        </button>
      </div>

      {/* Expanded Performance & Diagnostics Panel */}
      <Show when={isOpen()}>
        <div class="mt-2 w-72 bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-neutral-300 p-3 flex flex-col gap-2.5">
          <div class="flex items-center justify-between pb-2 border-b border-neutral-100 font-semibold text-neutral-800 text-xs">
            <span>Diagnostics & Telemetry</span>
            <span class="text-[10px] font-normal text-neutral-400">
              {latestSample()?.nodeCount || 0} nodes
            </span>
          </div>

          <div class="space-y-1.5 text-neutral-600">
            <div class="flex items-center justify-between">
              <span class="text-neutral-500">Canvas Paint:</span>
              <span class="font-bold text-neutral-800">
                {(latestSample()?.paintTime || 0).toFixed(2)} ms
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-neutral-500">Drag Move Latency:</span>
              <span class="font-bold text-neutral-800">
                {(latestSample()?.dragTime || 0).toFixed(2)} ms
              </span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-neutral-500">Scene Hit-Test:</span>
              <span class="font-bold text-neutral-800">
                {(latestSample()?.hitTestTime || 0).toFixed(2)} ms
              </span>
            </div>
          </div>

          {/* Warnings List */}
          <div class="pt-2 border-t border-neutral-100">
            <div class="text-[10px] text-neutral-400 font-semibold mb-1 uppercase tracking-wider">
              Recent Logs
            </div>
            <div class="max-h-24 overflow-y-auto custom-scrollbar space-y-1">
              <Show
                when={recentLogs().length > 0}
                fallback={<div class="text-neutral-400 text-[10px]">No issues detected (60 FPS solid)</div>}
              >
                <For each={recentLogs().slice(-3)}>
                  {(log) => (
                    <div class="flex items-start gap-1 text-[10px] text-amber-700 bg-amber-50/80 p-1 rounded">
                      <AlertTriangle size={10} class="shrink-0 mt-0.5" />
                      <span class="truncate">{log.message}</span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
