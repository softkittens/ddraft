import { defineConfig, loadEnv, type Plugin } from "vite";
import { resolve } from "path";
import solidPlugin from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { handleAgentRequest, abortSignalFromNode } from "./src/agent/http";
import type { IncomingMessage, ServerResponse } from "http";

function agentDevMiddleware(env: Record<string, string>): Plugin {
  return {
    name: "pen-agent-dev-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith("/agent")) {
          return next();
        }

        try {
          const protocol = req.headers["x-forwarded-proto"] || "http";
          const host = req.headers.host || "127.0.0.1:3000";
          const url = new URL(req.url, `${protocol}://${host}`);

          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v)) v.forEach((val) => headers.append(k, val));
            else if (v) headers.set(k, v);
          }

          const method = req.method || "GET";
          let body: ReadableStream<Uint8Array> | null = null;
          if (method !== "GET" && method !== "HEAD") {
            body = new ReadableStream({
              start(controller) {
                req.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
                req.on("end", () => controller.close());
                req.on("error", (err) => controller.error(err));
              }
            });
          }

          const webReq = new Request(url.toString(), {
            method,
            headers,
            body,
            signal: abortSignalFromNode(req, res),
            // @ts-ignore
            duplex: "half"
          });

          const webRes = await handleAgentRequest(webReq, {
            env,
            logDir: resolve(process.cwd(), "agent-logs")
          });

          res.statusCode = webRes.status;
          webRes.headers.forEach((v, k) => res.setHeader(k, v));

          if (!webRes.body) {
            res.end();
            return;
          }

          const reader = webRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
            if (typeof (res as any).flush === "function") {
              (res as any).flush();
            }
          }
          res.end();
        } catch (err) {
          console.error("[pen-agent middleware error]", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          } else {
            res.end();
          }
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

  return {
    plugins: [tailwindcss(), solidPlugin(), agentDevMiddleware(env)],
    server: {
      port: 3000
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html")
        }
      }
    }
  };
});
