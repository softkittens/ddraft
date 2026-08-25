import { describe, expect, it } from "bun:test";
import type { FrameSample } from "../src/telemetry/logger";
import { buildPerformanceTrace } from "../src/telemetry/trace";

function sample(timestamp: number, paintTime: number, paintCalls = 1): FrameSample {
  return {
    timestamp,
    fps: 120,
    totalTime: paintTime + 1,
    paintTime,
    layoutTime: 1,
    dragTime: 0,
    hitTestTime: 0,
    nodeCount: 100,
    paintCalls
  };
}

describe("Canvas2D performance trace report", () => {
  it("summarizes frame costs and retains the slowest frames", () => {
    const report = buildPerformanceTrace(
      [sample(1000, 4), sample(1100, 12, 2), sample(1200, 8)],
      { devicePixelRatio: 2 }
    ) as any;

    expect(report.durationMs).toBe(200);
    expect(report.summary.paintMs.average).toBe(8);
    expect(report.summary.paintCalls.max).toBe(2);
    expect(report.slowFrames[0].paint).toBe(12);
  });

  it("produces a valid empty report", () => {
    const report = buildPerformanceTrace([], {}) as any;
    expect(report.summary.frames).toBe(0);
    expect(report.summary.paintMs).toEqual({ average: 0, p50: 0, p95: 0, max: 0 });
  });
});
