import { handleAgentRequest } from "./http";

const port = Number(process.env.PEN_AGENT_PORT) || 3001;

Bun.serve({
  port,
  fetch: (req) => handleAgentRequest(req),
  error: (err) => {
    console.error("[pen-agent unhandled error]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});

console.info(`[pen-agent] standalone server listening on http://127.0.0.1:${port}`);
