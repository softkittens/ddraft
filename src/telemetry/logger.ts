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
  private maxSamples = 120;
  private maxLogs = 300;

  private activeSpans = new Map<string, number>();
  private currentFrameMetrics: Partial<FrameSample> = {};

  private lastFrameTimestamp = performance.now();
  private frameCount = 0;
  private currentFps = 60;

  private enabled = true;

  // Realtime Observable Listeners
  private listeners = new Set<(sample: FrameSample, currentFps: number) => void>();

  startSpan(name: string): () => number {
    if (!this.enabled) return () => 0;
    const start = performance.now();
    this.activeSpans.set(name, start);
    return () => {
      const end = performance.now();
      const dur = end - start;
      this.activeSpans.delete(name);

      if (name.includes("layout")) this.currentFrameMetrics.layoutTime = dur;
      else if (name.includes("paint") || name.includes("render")) this.currentFrameMetrics.paintTime = dur;
      else if (name.includes("drag")) this.currentFrameMetrics.dragTime = dur;
      else if (name.includes("hittest")) this.currentFrameMetrics.hitTestTime = dur;

      if (dur > 16.6) {
        this.warn("perf", `Slow operation detected in [${name}]: ${dur.toFixed(2)}ms (> 16.6ms budget)`, { duration: dur });
      }

      return dur;
    };
  }

  recordFrame(nodeCount: number) {
    if (!this.enabled) return;
    const now = performance.now();
    const delta = now - this.lastFrameTimestamp;
    this.frameCount++;

    if (delta >= 500) {
      this.currentFps = Math.round((this.frameCount * 1000) / delta);
      this.frameCount = 0;
      this.lastFrameTimestamp = now;
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
      nodeCount
    };


    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    this.currentFrameMetrics = {};
    for (const listener of this.listeners) {
      listener(sample, this.currentFps);
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
    } else if (level === "warn") {
      console.warn(`[${category.toUpperCase()}] ${message}`, data || "");
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

  getSummary() {
    if (this.samples.length === 0) return { avgFps: 60, avgPaint: 0, avgLayout: 0, maxFrameTime: 0 };
    const avgPaint = this.samples.reduce((s, x) => s + x.paintTime, 0) / this.samples.length;
    const avgLayout = this.samples.reduce((s, x) => s + x.layoutTime, 0) / this.samples.length;
    const maxFrameTime = Math.max(...this.samples.map((s) => s.totalTime));
    return {
      fps: this.currentFps,
      avgPaint: Number(avgPaint.toFixed(2)),
      avgLayout: Number(avgLayout.toFixed(2)),
      maxFrameTime: Number(maxFrameTime.toFixed(2))
    };
  }
}

export const telemetry = new TelemetrySubsystem();
