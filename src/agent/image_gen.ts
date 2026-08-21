import { readFileSync, existsSync } from "fs";
import { catalogById } from "./catalog";
import type { FetchFn } from "./provider";

export interface ImageGenResult {
  url: string;
  provider: "qwen" | "openai";
}

/** Thrown when no image provider is configured or every provider failed. */
export class ImageGenUnavailableError extends Error {}

function getEnvKey(key: string, env?: Record<string, string | undefined>): string | undefined {
  if (env) return env[key];
  if (process.env[key]) return process.env[key];
  if (existsSync(".env")) {
    try {
      const content = readFileSync(".env", "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith(`${key}=`)) {
          return trimmed.slice(key.length + 1).trim();
        }
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

/**
 * Generate an image using Qwen-Image-3.0-Pro (DashScope),
 * with fallback to OpenAI DALL-E.
 */
export async function generateDesignImage(
  prompt: string,
  options: {
    model?: string;
    size?: string;
    aspectRatio?: "square" | "portrait" | "landscape";
    env?: Record<string, string | undefined>;
    fetch?: FetchFn;
  } = {}
): Promise<ImageGenResult> {
  const env = options.env;
  const fetchImpl = options.fetch ?? fetch;
  const qwenKey = getEnvKey("QWEN_API_KEY", env) || getEnvKey("DASHSCOPE_API_KEY", env);
  const qwenBase = getEnvKey("QWEN_BASE_URL", env) || getEnvKey("DASHSCOPE_BASE_URL", env) ||
    catalogById("qwen-studio")?.baseUrl || "";
  const modelName = options.model || "qwen-image-3.0-pro";
  const failures: string[] = [];

  const sizeMap: Record<string, string> = {
    square: "1024*1024",
    portrait: "768*1024",
    landscape: "1024*768"
  };
  const sizeParam = sizeMap[options.aspectRatio || "portrait"] || options.size || "1024*1024";

  // Qwen chat and image endpoints share an origin, but not an API path.
  const qwenOrigin = qwenBase.replace(/\/(?:compatible-mode|api)\/v1\/?$/, "");

  // 1. Try Qwen Image 3.0 through its synchronous multimodal endpoint.
  if (qwenKey && qwenKey.length > 5 && qwenOrigin) {
    try {
      const endpoint = `${qwenOrigin}/api/v1/services/aigc/multimodal-generation/generation`;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${qwenKey}`
        },
        body: JSON.stringify({
          model: modelName,
          input: {
            messages: [{ role: "user", content: [{ text: prompt }] }]
          },
          parameters: {
            size: sizeParam,
            n: 1,
            prompt_extend: true
          }
        })
      });
      const data = await response.json() as {
        code?: string;
        message?: string;
        output?: { choices?: { message?: { content?: { image?: string }[] } }[] };
      };
      if (!response.ok) {
        failures.push(`Qwen ${response.status}${data.code ? ` ${data.code}` : ""}: ${data.message || "request failed"}`);
      } else {
        const imgUrl = data.output?.choices?.[0]?.message?.content?.find((part) => part.image)?.image;
        if (imgUrl) return { url: imgUrl, provider: "qwen" };
        failures.push("Qwen returned no image");
      }
    } catch (err) {
      failures.push(`Qwen request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Fallback to OpenAI DALL-E if OPENAI_API_KEY is available
  const openaiKey = getEnvKey("OPENAI_API_KEY", env);
  if (openaiKey && openaiKey.length > 5) {
    try {
      const openaiResp = await fetchImpl("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: prompt,
          size: options.aspectRatio === "landscape" ? "1792x1024" : options.aspectRatio === "portrait" ? "1024x1792" : "1024x1024",
          n: 1
        })
      });

      if (openaiResp.ok) {
        const openaiData = await openaiResp.json() as any;
        const imgUrl = openaiData?.data?.[0]?.url;
        if (imgUrl) {
          return { url: imgUrl, provider: "openai" };
        }
        failures.push("OpenAI returned no image");
      } else {
        const data = await openaiResp.json().catch(() => null) as { error?: { message?: string } } | null;
        failures.push(`OpenAI ${openaiResp.status}: ${data?.error?.message || "request failed"}`);
      }
    } catch (err) {
      failures.push(`OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // There is no third option. An earlier version returned one fixed stock
  // photograph here, with the prompt appended as a url fragment — which no
  // server ever receives. Every "generated" image was the same picture, and
  // the caller could not tell. A tool that cannot do its job says so.
  if (failures.length > 0) {
    throw new ImageGenUnavailableError(`Image generation failed. ${failures.join(" ")}`);
  }
  throw new ImageGenUnavailableError(
    "Image generation is not configured. Set QWEN_API_KEY (or DASHSCOPE_API_KEY) " +
      "or OPENAI_API_KEY to enable it."
  );
}
