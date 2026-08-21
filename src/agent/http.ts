import { listConfiguredProviders, loadProvider, UnknownModelError } from "./credentials";
import { isAbortError, runSession, type AgentEvent } from "./session";
import { complete, type FetchFn, type ReasoningEffort } from "./provider";
import { criticMessages, parseDesignReview } from "./review";
import { z } from "zod";

export interface AgentHttpDeps {
  env?: Record<string, string | undefined>;
  fetch?: FetchFn;
}

const REVIEW_BODY_LIMIT = 8 * 1024 * 1024;
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
      brief?: unknown;
      screenshot?: unknown;
      digest?: unknown;
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

    let provider = null;
    try {
      provider = loadRequestedProvider(env, body.providerId, body.model, "none");
    } catch (e) {
      if (e instanceof UnknownModelError) return Response.json({ error: e.message }, { status: 400 });
      throw e;
    }
    if (!provider) {
      return Response.json({ error: "not configured" }, { status: 503 });
    }
    if (!provider.vision) {
      return Response.json({ error: `${provider.model} does not accept image input` }, { status: 422 });
    }

    const messages = criticMessages({
      brief: body.brief,
      screenshotDataUrl: body.screenshot,
      digest: body.digest
    });

    try {
      const reply = await complete(provider, messages, {
        fetch: deps.fetch,
        signal: req.signal
      });
      const parsed = extractJson(typeof reply.content === "string" ? reply.content : "");
      const review = parseDesignReview(parsed, body.digest);
      return Response.json(review);
    } catch (err) {
      if (isAbortError(err, req.signal)) {
        return new Response(null, { status: 204 });
      }
      if (err instanceof z.ZodError || err instanceof SyntaxError) {
        return Response.json({ error: "invalid_response" }, { status: 422 });
      }
      return Response.json({
        error: err instanceof Error ? err.message : String(err)
      }, { status: 502 });
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

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of runSession(provider, body.messages as never, body.doc as never, {
            fetch: deps.fetch,
            signal: req.signal,
            selection: Array.isArray(body.selection)
              ? body.selection.filter((v): v is string => typeof v === "string")
              : []
          })) {
            controller.enqueue(encodeEvent(event));
          }
        } catch (err) {
          if (!isAbortError(err, req.signal)) {
            controller.enqueue(encodeEvent({
              type: "error",
              code: "provider",
              message: err instanceof Error ? err.message : String(err)
            }));
          }
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    });
  }

  return new Response("not found", { status: 404 });
}
