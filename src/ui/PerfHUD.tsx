import { Component, Show, For, createSignal, onCleanup } from "solid-js";
import { Activity, ChevronDown, ChevronUp, AlertTriangle } from "lucide-solid";
import { telemetry, type FrameSample, type LogEntry } from "../telemetry/logger";
import { buildPerformanceTrace } from "../telemetry/trace";

export const PerfHUD: Component = () => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [latestSample, setLatestSample] = createSignal<FrameSample | null>(null);
  const [fps, setFps] = createSignal(0);
  const [recentLogs, setRecentLogs] = createSignal<LogEntry[]>([]);
  const [recording, setRecording] = createSignal(false);
  const [traceLog, setTraceLog] = createSignal("");
  const [traceStatus, setTraceStatus] = createSignal("");
  let traceStartedAt = 0;

  setRecentLogs(telemetry.getRecentLogs());
  const unsubscribe = telemetry.subscribe((sample, currentFps) => {
    setLatestSample(sample);
    setFps(currentFps);
    setRecentLogs(telemetry.getRecentLogs());
  });
  onCleanup(unsubscribe);

  const getFpsColor = () => {
    const f = fps();
    if (f >= 110) return "text-emerald-600 bg-emerald-50 border-emerald-200";
    if (f >= 80) return "text-amber-600 bg-amber-50 border-amber-200";
    return "text-rose-600 bg-rose-50 border-rose-200";
  };

  const toggleTrace = () => {
    if (!recording()) {
      traceStartedAt = performance.now();
      setTraceLog("");
      setTraceStatus("Recording… pan and zoom now");
      setRecording(true);
      return;
    }

    const samples = telemetry.getRecentSamples().filter((sample) => sample.timestamp >= traceStartedAt);
    const report = buildPerformanceTrace(samples, {
      renderer: "Canvas2D",
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    });
    const log = JSON.stringify(report, null, 2);
    setTraceLog(log);
    setRecording(false);
    setTraceStatus(`${samples.length} frames captured`);
    console.info("[CanvasPerfTrace]", report);
  };

  const copyTrace = async () => {
    try {
      await navigator.clipboard.writeText(traceLog());
      setTraceStatus("Trace copied — paste it into Codex");
    } catch {
      setTraceStatus("Copy failed; use the CanvasPerfTrace console entry");
    }
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
        <Activity size={13} class={fps() >= 110 ? "text-emerald-500" : "text-amber-500"} />
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
            <div class="flex items-center justify-between">
              <span class="text-neutral-500">Paint Calls:</span>
              <span class="font-bold text-neutral-800">{latestSample()?.paintCalls || 0}</span>
            </div>
          </div>

          <div class="pt-2 border-t border-neutral-100 space-y-1.5">
            <div class="flex gap-1.5">
              <button
                onClick={toggleTrace}
                class={`flex-1 rounded-lg px-2 py-1.5 font-semibold text-white ${recording() ? "bg-rose-600" : "bg-neutral-800"}`}
              >
                {recording() ? "Stop trace" : "Record trace"}
              </button>
              <Show when={traceLog()}>
                <button onClick={copyTrace} class="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 font-semibold">
                  Copy log
                </button>
              </Show>
            </div>
            <Show when={traceStatus()}>
              <div class="text-[9px] text-neutral-500">{traceStatus()}</div>
            </Show>
          </div>

          {/* Warnings List */}
          <div class="pt-2 border-t border-neutral-100">
            <div class="text-[10px] text-neutral-400 font-semibold mb-1 uppercase tracking-wider">
              Recent Logs
            </div>
            <div class="max-h-24 overflow-y-auto custom-scrollbar space-y-1">
              <Show
                when={recentLogs().length > 0}
                fallback={<div class="text-neutral-400 text-[10px]">No performance warnings</div>}
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
