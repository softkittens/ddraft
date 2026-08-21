import { handleAgentRequest } from "./http";
import { resolve } from "node:path";

const port = Number(process.env.PEN_AGENT_PORT) || 3001;

Bun.serve({
  port,
  fetch: (req) => handleAgentRequest(req, {
    logDir: resolve(process.cwd(), "agent-logs")
  }),
  error: (err) => {
    console.error("[pen-agent unhandled error]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});

console.info(`[pen-agent] standalone server listening on http://127.0.0.1:${port}`);
