import { listConfiguredProviders, loadProvider, UnknownModelError } from "./credentials";
import { runSession, type AgentEvent } from "./session";
import type { FetchFn, ReasoningEffort } from "./provider";

export interface AgentHttpDeps {
  env?: Record<string, string | undefined>;
  fetch?: FetchFn;
}

function encodeEvent(event: AgentEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function handleAgentRequest(req: Request, deps: AgentHttpDeps = {}): Promise<Response> {
  const url = new URL(req.url);
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const path = url.pathname.replace(/\/$/, "");

  if (req.method === "GET" && path.endsWith("/status")) {
    const providers = listConfiguredProviders(env);
    return Response.json({ configured: providers.length > 0, providers });
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
    const available = listConfiguredProviders(env);
    const providerId = body.providerId || available[0]?.id;
    let provider = null;
    try {
      provider = providerId ? loadProvider(providerId, env, body.model, body.reasoningEffort) : null;
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
          if (!(err instanceof Error && err.name === "AbortError")) {
            controller.enqueue(encodeEvent({ type: "error", message: err instanceof Error ? err.message : String(err) }));
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

