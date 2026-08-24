import { handleAgentRequest } from "./http";
import { resolve } from "node:path";

const port = Number(process.env.DDRAFT_AGENT_PORT || process.env.PEN_AGENT_PORT) || 3001;

Bun.serve({
  port,
  idleTimeout: 0,
  fetch: (req, bunServer) => {
    bunServer.timeout(req, 0);
    return handleAgentRequest(req, {
      logDir: resolve(process.cwd(), "agent-logs")
    });
  },
  error: (err) => {
    console.error("[ddraft-agent unhandled error]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});

console.info(`[ddraft-agent] standalone server listening on http://127.0.0.1:${port}`);
