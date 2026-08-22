import type { Message, MessageContent } from "../../agent/provider";
import type { PublicProvider } from "../../agent/credentials";
import type { ReviewResponse } from "../../agent/review";

export type NoteTone = "info" | "error" | "budget";

export interface NoteEntry {
  kind: "note";
  text: string;
  tone: NoteTone;
}

export interface ReviewEntry {
  kind: "review";
  pass: number;
  review: ReviewResponse;
  applied: number;
  thumbnail?: string;
}

export interface MessageEntry {
  kind: "message";
  message: Message;
  tool?: string;
}

export type Entry = NoteEntry | ReviewEntry | MessageEntry;

export interface PendingStep {
  label: string;
  detail?: string;
  icon: "tool" | "image" | "review";
}

export const SETUP_NOTICE =
  "No provider key found. Add OPENAI_API_KEY, OPENCODE_GO_API_KEY, GEMINI_API_KEY, or DASHSCOPE_API_KEY to your .env file and restart. Keys stay on your local agent server.";

export const AUTO_REVIEW_REVISIONS = 2;

export function renderMessageText(content: MessageContent | unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "object" && p && "type" in p && p.type === "text" ? p.text : ""))
      .join(" ");
  }
  return String(content ?? "");
}

export function isInternalMessage(content: MessageContent | unknown): boolean {
  const text = renderMessageText(content).trim();
  return text.startsWith("[IMAGE_PREVIEW]") || text.startsWith("[Visual review revision]");
}

export function toolLabel(messages: Message[], index: number): string {
  const id = messages[index]?.tool_call_id;
  if (!id) return "tool";
  for (let i = index - 1; i >= 0; i--) {
    const call = messages[i].tool_calls?.find((c) => c.id === id);
    if (call?.function.name) return call.function.name;
  }
  return id.startsWith("call_") || id.startsWith("chatcmpl") ? "tool" : id;
}

export function modelLabel(
  providers: PublicProvider[],
  providerId: string | undefined,
  model: string
): string {
  const spec = providers.find((p) => p.id === providerId);
  return spec?.models.find((m) => m.id === model)?.label ?? model;
}

const THUMBNAIL_WIDTH = 320;

export async function createThumbnail(dataUrl: string): Promise<string | undefined> {
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = dataUrl;
    });
    const scale = Math.min(1, THUMBNAIL_WIDTH / Math.max(image.width, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return undefined;
  }
}

export function isUserMessage(entry: Entry): entry is MessageEntry {
  return entry.kind === "message" && entry.message.role === "user" && !isInternalMessage(entry.message.content);
}

export function isAssistantMessage(entry: Entry): entry is MessageEntry {
  return (
    entry.kind === "message" &&
    entry.message.role === "assistant" &&
    renderMessageText(entry.message.content).trim().length > 0
  );
}

export function isToolMessage(entry: Entry): entry is MessageEntry {
  return entry.kind === "message" && entry.message.role === "tool";
}

function firstLine(text: string, max = 72): string {
  const line = text.trim().split(/\n/)[0] ?? "";
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

export function collapsedActivity(args: {
  entries: Entry[];
  pending: PendingStep | null;
  streamReasoning: string;
  streamText: string;
  running: boolean;
}): { title: string; detail?: string; live: boolean } {
  const pending = args.pending;
  if (pending) {
    return { title: pending.label, detail: pending.detail, live: true };
  }
  const stream = args.streamText.trim();
  if (stream) {
    return { title: firstLine(stream), live: true };
  }
  if (args.streamReasoning.trim()) {
    return { title: "Thinking…", live: true };
  }
  if (args.running) {
    return { title: "Working…", live: true };
  }

  for (let i = args.entries.length - 1; i >= 0; i--) {
    const entry = args.entries[i];
    switch (entry.kind) {
      case "review":
        return {
          title: `Visual review ${entry.pass}`,
          detail: entry.review.verdict,
          live: false
        };
      case "note":
        return { title: firstLine(entry.text), live: false };
      case "message": {
        if (entry.message.role === "tool") {
          return { title: entry.tool ?? "tool", detail: "ran", live: false };
        }
        if (entry.message.role === "assistant") {
          const text = renderMessageText(entry.message.content).trim();
          if (text) return { title: firstLine(text), live: false };
        }
        break;
      }
      default: {
        const _exhaustive: never = entry;
        return _exhaustive;
      }
    }
  }

  return { title: "No recent activity", live: false };
}
