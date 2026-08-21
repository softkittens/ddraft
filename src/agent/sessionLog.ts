import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface SessionLog {
  id: string;
  write(event: Record<string, unknown>): void;
  close(): Promise<void>;
}

const SAFE_ID = /^[a-zA-Z0-9_-]{1,120}$/;
const DATA_URL = /data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/g;

function safeValue(value: unknown, key = ""): unknown {
  if (/^(apiKey|authorization)$/i.test(key)) return "[redacted]";
  if (typeof value === "string") {
    return value.replace(DATA_URL, (image) => `[image data omitted: ${image.length} characters]`);
  }
  if (Array.isArray(value)) return value.map((item) => safeValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, safeValue(child, childKey)])
    );
  }
  return value;
}

/**
 * Append-only JSONL so an interrupted or hanging run still leaves useful
 * evidence. Logging is deliberately best-effort: a disk problem must never
 * stop an agent session.
 */
export function createSessionLog(directory: string, requestedId?: unknown): SessionLog | null {
  const id = typeof requestedId === "string" && SAFE_ID.test(requestedId)
    ? requestedId
    : randomUUID();
  const path = join(directory, `${id}.jsonl`);

  try {
    mkdirSync(directory, { recursive: true });
    const stream = createWriteStream(path, { flags: "a" });
    const started = performance.now();
    let failed = false;
    stream.on("error", (error) => {
      failed = true;
      console.warn(`[agent-log] ${error.message}`);
    });

    return {
      id,
      write(event) {
        if (failed) return;
        try {
          stream.write(`${JSON.stringify(safeValue({
            at: new Date().toISOString(),
            elapsedMs: Math.round(performance.now() - started),
            ...event
          }))}\n`);
        } catch (error) {
          failed = true;
          console.warn(`[agent-log] ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      close() {
        if (failed || stream.closed) return Promise.resolve();
        return new Promise((resolve) => stream.end(resolve));
      }
    };
  } catch (error) {
    console.warn(`[agent-log] ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
