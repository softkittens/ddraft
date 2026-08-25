import type { FrameSample } from "./logger";

interface NumberStats {
  average: number;
  p50: number;
  p95: number;
  max: number;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function stats(values: number[]): NumberStats {
  if (values.length === 0) return { average: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
  return {
    average: rounded(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50: rounded(at(0.5)),
    p95: rounded(at(0.95)),
    max: rounded(sorted[sorted.length - 1])
  };
}

function summarize(samples: FrameSample[]) {
  const values = (key: keyof FrameSample) => samples.map((sample) => sample[key] as number);
  return {
    frames: samples.length,
    fps: stats(values("fps")),
    totalMs: stats(values("totalTime")),
    paintMs: stats(values("paintTime")),
    layoutMs: stats(values("layoutTime")),
    dragMs: stats(values("dragTime")),
    hitTestMs: stats(values("hitTestTime")),
    paintCalls: stats(values("paintCalls")),
    nodeCount: stats(values("nodeCount"))
  };
}

export function buildPerformanceTrace(
  samples: FrameSample[],
  environment: Record<string, unknown>
): Record<string, unknown> {
  if (samples.length === 0) {
    return {
      version: 1,
      capturedAt: new Date().toISOString(),
      environment,
      summary: summarize([]),
      timeline: [],
      slowFrames: []
    };
  }

  const started = samples[0].timestamp;
  const timeline = new Map<number, FrameSample[]>();
  for (const sample of samples) {
    const slot = Math.floor((sample.timestamp - started) / 250) * 250;
    const list = timeline.get(slot) ?? [];
    list.push(sample);
    timeline.set(slot, list);
  }

  const compact = (sample: FrameSample) => ({
    t: rounded(sample.timestamp - started),
    fps: sample.fps,
    total: rounded(sample.totalTime),
    paint: rounded(sample.paintTime),
    layout: rounded(sample.layoutTime),
    drag: rounded(sample.dragTime),
    hitTest: rounded(sample.hitTestTime),
    calls: sample.paintCalls,
    nodes: sample.nodeCount
  });

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    environment,
    durationMs: rounded(samples[samples.length - 1].timestamp - started),
    summary: summarize(samples),
    timeline: [...timeline].map(([offsetMs, list]) => ({ offsetMs, ...summarize(list) })),
    slowFrames: [...samples]
      .sort((a, b) => b.totalTime - a.totalTime)
      .slice(0, 40)
      .map(compact)
  };
}
