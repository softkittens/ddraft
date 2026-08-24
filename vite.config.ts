import { defineConfig, loadEnv, type Plugin } from "vite";
import { resolve, extname } from "path";
import { existsSync, createReadStream, cpSync } from "fs";
import solidPlugin from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { handleAgentRequest, abortSignalFromNode } from "./src/agent/http";
import type { IncomingMessage, ServerResponse } from "http";

function agentDevMiddleware(env: Record<string, string>): Plugin {
  return {
    name: "ddraft-agent-dev-middleware",
    closeBundle() {
      const srcDir = resolve(process.cwd(), "demo-project");
      const destDir = resolve(process.cwd(), "dist/demo-project");
      if (existsSync(srcDir)) {
        cpSync(srcDir, destDir, { recursive: true });
      }
    },
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith("/demo-project/")) {
          return next();
        }
        const cleanPath = req.url.split("?")[0].split("#")[0];
        const filePath = resolve(process.cwd(), "." + cleanPath);
        if (existsSync(filePath)) {
          const ext = extname(filePath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
            ".gif": "image/gif",
            ".avif": "image/avif",
            ".pen": "application/json",
            ".json": "application/json"
          };
          const mime = mimeTypes[ext] || "application/octet-stream";
          res.statusCode = 200;
          res.setHeader("Content-Type", mime);
          res.setHeader("Access-Control-Allow-Origin", "*");
          createReadStream(filePath).pipe(res);
          return;
        }
        next();
      });

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

          const currentEnv = {
            ...env,
            ...process.env,
            ...loadEnv(process.env.NODE_ENV || "development", process.cwd(), "")
          };
          const webRes = await handleAgentRequest(webReq, {
            env: currentEnv,
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
          console.error("[ddraft-agent middleware error]", err);
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
