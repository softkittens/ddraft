import { handleAgentRequest } from "./agent/http";
import { resolve, extname } from "node:path";
import { existsSync, statSync } from "node:fs";

const port = Number(process.env.PORT || process.env.DDRAFT_AGENT_PORT || process.env.PEN_AGENT_PORT) || 3000;
const distDir = resolve(process.cwd(), "dist");
const demoDir = resolve(process.cwd(), "demo-project");

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".pen": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm"
};

const server = Bun.serve({
  hostname: "0.0.0.0",
  port,
  // Quiet SSE while the model thinks is still a live request. Bun's default
  // idleTimeout is 10s; it aborts req.signal and kills the upstream stream.
  idleTimeout: 0,
  async fetch(req, bunServer) {
    const url = new URL(req.url);

    // 1. Agent API endpoints
    if (url.pathname.startsWith("/agent")) {
      bunServer.timeout(req, 0);
      return handleAgentRequest(req, {
        env: process.env,
        logDir: resolve(process.cwd(), "agent-logs")
      });
    }

    // 2. Demo project static assets
    if (url.pathname.startsWith("/demo-project/")) {
      const subPath = url.pathname.replace(/^\/demo-project\//, "");
      const demoPath = resolve(demoDir, subPath);
      if (existsSync(demoPath) && !statSync(demoPath).isDirectory()) {
        const ext = extname(demoPath).toLowerCase();
        return new Response(Bun.file(demoPath), {
          headers: {
            "Content-Type": mimeTypes[ext] || "application/octet-stream",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    }

    // 3. Static files from dist/
    const filePath = resolve(distDir, url.pathname.slice(1) || "index.html");
    if (existsSync(filePath) && !statSync(filePath).isDirectory()) {
      const ext = extname(filePath).toLowerCase();
      return new Response(Bun.file(filePath), {
        headers: {
          "Content-Type": mimeTypes[ext] || "application/octet-stream"
        }
      });
    }

    // 4. SPA Fallback to dist/index.html
    const indexHtml = resolve(distDir, "index.html");
    if (existsSync(indexHtml)) {
      return new Response(Bun.file(indexHtml), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    return new Response("Not Found", { status: 404 });
  },
  error(err) {
    console.error("[ddraft-server error]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});

console.info(`[ddraft] Server listening on http://0.0.0.0:${server.port}`);
