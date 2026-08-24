import type { Message } from "../../agent/provider";
import type { PublicProvider } from "../../agent/credentials";
import type { Document } from "../../model/types";
import type { AgentEvent } from "../../agent/session";
import type { ReviewResponse } from "../../agent/review";
import type { ResolvedContext } from "../../agent/context";
import { parseSseData } from "../../agent/stream";
import { SETUP_NOTICE } from "./types";

export interface AgentRunRequest {
  messages: Message[];
  doc: Document;
  selection: string[];
  providerId?: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  recentStyles?: unknown[];
  /** The page this run is confined to. */
  pageId?: string;
  sessionId: string;
}

export interface AgentReviewRequest {
  providerId?: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  brief: string;
  screenshot: string;
  screenshots?: { id: string; name: string; dataUrl: string; kind?: "screen" | "section" | "viewport"; parentId?: string }[];
  digest: string;
  direction?: unknown;
  audit: string;
  /** The page the screenshots and the audit both cover. */
  pageId?: string;
  /** What the builder resolved, so the critic judges the same product it built. */
  context?: ResolvedContext;
  sessionId: string;
}

export interface AgentStatusResult {
  configured: boolean;
  providers: PublicProvider[];
  requiresAccessCode?: boolean;
  authenticated?: boolean;
}

export async function authenticateAccessCode(code: string): Promise<boolean> {
  try {
    const res = await fetch("/agent/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchAgentStatus(): Promise<AgentStatusResult> {
  try {
    const res = await fetch("/agent/status");
    const body = (await res.json()) as {
      configured?: boolean;
      providers?: PublicProvider[];
      requiresAccessCode?: boolean;
      authenticated?: boolean;
    };
    const list = body.providers ?? [];
    return {
      configured: body.configured === true && list.length > 0,
      providers: list,
      requiresAccessCode: body.requiresAccessCode === true,
      authenticated: body.authenticated !== false
    };
  } catch {
    return { configured: false, providers: [], requiresAccessCode: false, authenticated: true };
  }
}

export async function* streamAgentRun(
  req: AgentRunRequest,
  signal: AbortSignal
): AsyncGenerator<AgentEvent, void, unknown> {
  const res = await fetch("/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal
  });

  if (!res.ok || !res.body) {
    let errMessage = SETUP_NOTICE;
    try {
      const errJson = await res.json();
      if (errJson?.error === "invalid_access_code") {
        errMessage = "Invalid or expired access code session. Please re-enter your access code.";
      } else if (errJson?.error) {
        errMessage = errJson.error;
      } else if (errJson?.message) {
        errMessage = errJson.message;
      }
    } catch {
      if (res.status !== 503) {
        errMessage = `Server error (${res.status}: ${res.statusText || "Request failed"})`;
      }
    }
    throw new Error(errMessage);
  }

  for await (const data of parseSseData(res.body)) {
    yield JSON.parse(data) as AgentEvent;
  }
}

export async function fetchAgentReview(
  req: AgentReviewRequest,
  signal: AbortSignal
): Promise<ReviewResponse> {
  const res = await fetch("/agent/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal
  });

  if (!res.ok) {
    const body = ((await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null);
    if (body?.error === "invalid_access_code") {
      throw new Error("Invalid or expired access code session");
    }
    const errorText = typeof body?.error === "string" ? body.error : `request failed (${res.status})`;
    throw new Error(errorText);
  }

  return (await res.json()) as ReviewResponse;
}
