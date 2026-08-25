export interface MetricSpan {
  name: string;
  startTime: number;
  duration?: number;
}

export interface FrameSample {
  timestamp: number;
  fps: number;
  totalTime: number;
  paintTime: number;
  layoutTime: number;
  dragTime: number;
  hitTestTime: number;
  nodeCount: number;
  paintCalls: number;
}

export interface LogEntry {
  level: "info" | "warn" | "error" | "perf";
  category: "render" | "layout" | "interaction" | "agent" | "model" | "perf";
  message: string;
  data?: any;
  timestamp: number;
}

class TelemetrySubsystem {
  private samples: FrameSample[] = [];
  private logs: LogEntry[] = [];
  private maxSamples = 2400;
  private maxLogs = 300;

  private activeSpans = new Map<string, number>();
  private currentFrameMetrics: Partial<FrameSample> = {};

  private frameTimestamps: number[] = [];
  private pendingFrame: number | null = null;
  private pendingNodeCount = 0;
  private pendingPaintCalls = 0;
  private lastListenerUpdate = 0;
  private currentFps = 0;

  private enabled = true;

  // Realtime Observable Listeners
  private listeners = new Set<(sample: FrameSample, currentFps: number) => void>();

  startSpan(name: string): () => number {
    if (!this.enabled || this.listeners.size === 0) return () => 0;
    const start = performance.now();
    this.activeSpans.set(name, start);
    return () => {
      const end = performance.now();
      const dur = end - start;
      this.activeSpans.delete(name);

      if (name.includes("layout")) this.currentFrameMetrics.layoutTime = (this.currentFrameMetrics.layoutTime || 0) + dur;
      else if (name.includes("paint") || name.includes("render")) {
        this.currentFrameMetrics.paintTime = (this.currentFrameMetrics.paintTime || 0) + dur;
      } else if (name.includes("drag")) this.currentFrameMetrics.dragTime = (this.currentFrameMetrics.dragTime || 0) + dur;
      else if (name.includes("hittest")) {
        this.currentFrameMetrics.hitTestTime = (this.currentFrameMetrics.hitTestTime || 0) + dur;
      }

      if (dur > 50) {
        this.log("warn", "perf", `Slow operation detected in [${name}]: ${dur.toFixed(2)}ms (> 50ms)`, { duration: dur });
      }

      return dur;
    };
  }

  recordFrame(nodeCount: number) {
    if (!this.enabled) return;
    if (this.listeners.size === 0) {
      this.currentFrameMetrics = {};
      this.pendingPaintCalls = 0;
      return;
    }

    this.pendingPaintCalls += 1;
    this.pendingNodeCount = nodeCount;
    if (this.pendingFrame !== null) return;

    if (typeof requestAnimationFrame === "undefined") {
      this.samplePresentedFrame(performance.now());
      return;
    }

    this.pendingFrame = requestAnimationFrame((timestamp) => {
      this.pendingFrame = null;
      // Include any other renderer callbacks submitted in this display tick.
      window.setTimeout(() => {
        if (this.pendingPaintCalls === 0) return;
        this.samplePresentedFrame(timestamp);
      }, 0);
    });
  }

  private samplePresentedFrame(now: number) {
    const cutoff = now - 1000;
    this.frameTimestamps.push(now);
    while (this.frameTimestamps.length > 1 && this.frameTimestamps[0] < cutoff) {
      this.frameTimestamps.shift();
    }

    if (this.frameTimestamps.length > 1) {
      const elapsed = now - this.frameTimestamps[0];
      this.currentFps = elapsed > 0
        ? Math.round(((this.frameTimestamps.length - 1) * 1000) / elapsed)
        : 0;
    } else {
      this.currentFps = 0;
    }

    const sample: FrameSample = {
      timestamp: now,
      fps: this.currentFps,
      totalTime:
        (this.currentFrameMetrics.paintTime || 0) +
        (this.currentFrameMetrics.layoutTime || 0) +
        (this.currentFrameMetrics.dragTime || 0) +
        (this.currentFrameMetrics.hitTestTime || 0),
      paintTime: this.currentFrameMetrics.paintTime || 0,
      layoutTime: this.currentFrameMetrics.layoutTime || 0,
      dragTime: this.currentFrameMetrics.dragTime || 0,
      hitTestTime: this.currentFrameMetrics.hitTestTime || 0,
      nodeCount: this.pendingNodeCount,
      paintCalls: this.pendingPaintCalls
    };

    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    this.currentFrameMetrics = {};
    this.pendingPaintCalls = 0;
    // The HUD must not become part of the cost it measures.
    if (now - this.lastListenerUpdate >= 200) {
      this.lastListenerUpdate = now;
      for (const listener of this.listeners) {
        listener(sample, this.currentFps);
      }
    }
  }

  info(category: LogEntry["category"], message: string, data?: any) {
    this.log("info", category, message, data);
  }

  warn(category: LogEntry["category"], message: string, data?: any) {
    this.log("warn", category, message, data);
  }

  error(category: LogEntry["category"], message: string, data?: any) {
    this.log("error", category, message, data);
  }

  private log(level: LogEntry["level"], category: LogEntry["category"], message: string, data?: any) {
    const entry: LogEntry = {
      level,
      category,
      message,
      data,
      timestamp: performance.now()
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    if (level === "error") {
      console.error(`[${category.toUpperCase()}] ${message}`, data || "");
    }
  }

  subscribe(callback: (sample: FrameSample, currentFps: number) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getRecentSamples(): FrameSample[] {
    return [...this.samples];
  }

  getRecentLogs(): LogEntry[] {
    return [...this.logs];
  }
}

export const telemetry = new TelemetrySubsystem();
