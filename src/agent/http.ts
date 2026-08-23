import {
  listConfiguredProviders,
  loadProvider,
  loadVisionProvider,
  UnknownModelError
} from "./credentials";
import { isAbortError, runSession, type AgentEvent } from "./session";
import { complete, type FetchFn, type ReasoningEffort } from "./provider";
import { criticMessages, parseDesignReview } from "./critic";
import { parseResolvedContext } from "./context";
import type { ReviewResponse } from "./review";
import type { StyleRun } from "../design/history";
import { createSessionLog } from "./sessionLog";
import { designDirection } from "../design/styleSystem";
import { catalogById } from "./catalog";
import { z } from "zod";

/** The client sends this; nothing else may reach the prompt. */
function isStyleRun(value: unknown): value is StyleRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Record<string, unknown>;
  return ["at", "brief", "palette", "headings", "elevation"].every(
    (key) => typeof run[key] === "string"
  ) && ["roundness", "thesis", "firstViewport"].every(
    (key) => run[key] === undefined || typeof run[key] === "string"
  );
}

export interface AgentHttpDeps {
  env?: Record<string, string | undefined>;
  fetch?: FetchFn;
  logDir?: string;
}

const REVIEW_BODY_LIMIT = 32 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,/i;

function encodeEvent(event: AgentEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = new URL(req.url).hostname;
    return o.hostname === host || o.hostname === "localhost" || o.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function loadRequestedProvider(
  env: Record<string, string | undefined>,
  providerId: string | undefined,
  model: string | undefined,
  reasoningEffort?: ReasoningEffort
) {
  const available = listConfiguredProviders(env);
  const id = providerId || available[0]?.id;
  return id ? loadProvider(id, env, model, reasoningEffort) : null;
}

function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

/** Bind a Fetch AbortSignal to Node HTTP sockets so a client disconnect cancels the provider call. */
export function abortSignalFromNode(
  req: { on(event: string, listener: () => void): void },
  res?: { on(event: string, listener: () => void): void; writableEnded?: boolean }
): AbortSignal {
  const ac = new AbortController();
  const abort = () => {
    if (!ac.signal.aborted) ac.abort();
  };
  req.on("aborted", abort);
  res?.on("close", () => {
    if (!res.writableEnded) abort();
  });
  return ac.signal;
}

export async function handleAgentRequest(req: Request, deps: AgentHttpDeps = {}): Promise<Response> {
  const url = new URL(req.url);
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const path = url.pathname.replace(/\/$/, "");

  if (!originAllowed(req)) {
    return Response.json({ error: "origin not allowed" }, { status: 403 });
  }

  if (req.method === "GET" && path.endsWith("/status")) {
    const providers = listConfiguredProviders(env);
    return Response.json({ configured: providers.length > 0, providers });
  }

  if (req.method === "POST" && path.endsWith("/review")) {
    const length = Number(req.headers.get("content-length") || 0);
    if (length > REVIEW_BODY_LIMIT) {
      return Response.json({ error: "body too large" }, { status: 413 });
    }
    const rawText = await req.text();
    if (rawText.length > REVIEW_BODY_LIMIT) {
      return Response.json({ error: "body too large" }, { status: 413 });
    }

    let body: {
      providerId?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      brief?: unknown;
      screenshot?: unknown;
      screenshots?: unknown;
      digest?: unknown;
      direction?: unknown;
      audit?: unknown;
      context?: unknown;
      pageId?: unknown;
      sessionId?: unknown;
    };
    try {
      body = JSON.parse(rawText) as typeof body;
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }

    if (typeof body.brief !== "string" || typeof body.digest !== "string") {
      return Response.json({ error: "brief and digest are required" }, { status: 400 });
    }
    if (typeof body.screenshot !== "string" || !IMAGE_DATA_URL.test(body.screenshot)) {
      return Response.json({ error: "screenshot must be an image data URL" }, { status: 400 });
    }

    const screenshots = Array.isArray(body.screenshots)
      ? body.screenshots.filter(
          (s): s is { id?: string; name?: string; dataUrl: string; kind?: "screen" | "section" | "viewport"; parentId?: string } =>
            Boolean(s && typeof s === "object" && typeof (s as any).dataUrl === "string" && IMAGE_DATA_URL.test((s as any).dataUrl))
        )
      : undefined;

    let provider = null;
    try {
      provider = loadRequestedProvider(env, body.providerId, body.model, body.reasoningEffort);
    } catch (e) {
      if (e instanceof UnknownModelError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
    if (!provider) {
      return Response.json({ error: "not configured" }, { status: 503 });
    }
    const messages = criticMessages({
      brief: body.brief,
      screenshotDataUrl: body.screenshot,
      screenshots: screenshots && screenshots.length > 0 ? screenshots : undefined,
      digest: body.digest,
      direction: designDirection(body.direction),
      audit: typeof body.audit === "string" ? body.audit : undefined,
      context: parseResolvedContext(body.context)
    });
    const log = deps.logDir ? createSessionLog(deps.logDir, body.sessionId) : null;
    const designModel = provider.model;
    /*
     * Which models have had a turn at the screenshot.
     *
     * A model is dropped from this list for either of two reasons — the catalog
     * says it has no eyes, or it accepted the request and failed on it. From
     * here those are the same fact, and both are worth one handoff rather than
     * one dead review.
     */
    const tried: string[] = [designModel];
    let handoff: string | undefined;

    if (!provider.vision) {
      const alternate = loadVisionProvider(provider.id, env, tried, body.reasoningEffort);
      if (!alternate) {
        await log?.close();
        return Response.json({
          error: `${designModel} does not accept image input, and ${
            catalogById(provider.id)?.label ?? provider.id
          } offers no model that does`
        }, { status: 422 });
      }
      handoff = `${designModel} does not read images`;
      provider = alternate;
      tried.push(provider.model);
    }

    try {
      for (;;) {
        log?.write({
          type: "review_request",
          providerId: provider.id,
          model: provider.model,
          designModel,
          handoff,
          reasoningEffort: provider.reasoningEffort,
          messages
        });
        try {
          // The overview request already receives the full screen and every
          // high-resolution section close-up. A second model call per section
          // duplicated the same evidence, doubled review cost, and could drag
          // a sound overview verdict down with a narrow crop-only opinion.
          const reply = await complete(provider, messages, {
            fetch: deps.fetch,
            signal: req.signal
          });
          log?.write({ type: "review_response", model: provider.model, response: reply });
          const parsed = extractJson(typeof reply.content === "string" ? reply.content : "");
          const review: ReviewResponse = parseDesignReview(parsed, body.digest);

          const response: ReviewResponse = {
            ...review,
            reviewedBy: { providerId: provider.id, model: provider.model, handoff }
          };
          log?.write({ type: "review_result", model: provider.model, handoff, review: response });
          return Response.json(response);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log?.write({ type: "review_error", model: provider.model, error: message });
          if (isAbortError(err, req.signal)) {
            return new Response(null, { status: 204 });
          }
          // The model answered; it just did not answer in the shape asked for.
          // Handing that to a second model would spend another call on a
          // failure a retry cannot distinguish from a stubborn one.
          if (err instanceof z.ZodError || err instanceof SyntaxError) {
            return Response.json({ error: "invalid_response" }, { status: 422 });
          }
          const alternate = loadVisionProvider(provider.id, env, tried, body.reasoningEffort);
          if (!alternate) {
            return Response.json({ error: message }, { status: 502 });
          }
          log?.write({
            type: "review_handoff",
            from: provider.model,
            to: alternate.model,
            reason: message
          });
          handoff = `${provider.model} failed on the screenshot (${message})`;
          provider = alternate;
          tried.push(provider.model);
        }
      }
    } finally {
      await log?.close();
    }
  }

  if (req.method === "POST" && path.endsWith("/run")) {
    const body = (await req.json()) as {
      messages?: unknown;
      doc?: unknown;
      providerId?: string;
      model?: string;
      reasoningEffort?: ReasoningEffort;
      selection?: unknown;
      recentStyles?: unknown;
      pageId?: unknown;
      sessionId?: unknown;
    };
    let provider = null;
    try {
      provider = loadRequestedProvider(env, body.providerId, body.model, body.reasoningEffort);
    } catch (e) {
      if (e instanceof UnknownModelError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
    if (!provider) {
      return Response.json({ error: "not configured" }, { status: 503 });
    }

    const log = deps.logDir ? createSessionLog(deps.logDir, body.sessionId) : null;
    log?.write({
      type: "session_start",
      sessionId: log?.id,
      providerId: provider.id,
      model: provider.model,
      api: provider.api ?? "chat",
      reasoningEffort: provider.reasoningEffort,
      selection: body.selection
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          try {
            for await (const event of runSession(provider, body.messages as never, body.doc as never, {
              fetch: deps.fetch,
              signal: req.signal,
              selection: Array.isArray(body.selection)
                ? body.selection.filter((v): v is string => typeof v === "string")
                : [],
              recentStyles: Array.isArray(body.recentStyles)
                ? (body.recentStyles.filter(isStyleRun) as StyleRun[])
                : [],
              pageId: typeof body.pageId === "string" && body.pageId.trim() ? body.pageId.trim() : undefined,
              trace: (event) => log?.write(event)
            })) {
              if (event.type === "done") log?.write({ type: "session_done" });
              if (event.type === "error") {
                log?.write({ type: "session_error", code: event.code, message: event.message });
              }
              controller.enqueue(encodeEvent(event));
            }
          } catch (err) {
            if (!isAbortError(err, req.signal)) {
              log?.write({ type: "session_error", code: "provider", message: err instanceof Error ? err.message : String(err) });
              controller.enqueue(encodeEvent({
                type: "error",
                code: "provider",
                message: err instanceof Error ? err.message : String(err)
              }));
            }
          } finally {
            log?.write({ type: "session_end" });
            await log?.close();
            controller.close();
          }
        })();
      }
    });

    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    };
    if (log) headers["X-Agent-Session-Id"] = log.id;
    return new Response(stream, { headers });
  }

  return new Response("not found", { status: 404 });
}
