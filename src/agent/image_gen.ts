import { readFileSync, existsSync } from "fs";

export interface ImageGenResult {
  url: string;
  provider: "qwen" | "openai";
}

/** Thrown when no image provider is configured or every provider failed. */
export class ImageGenUnavailableError extends Error {}

function getEnvKey(key: string): string | undefined {
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
 * Generate an image using Qwen-Image-3.0-Pro (DashScope) in the background,
 * with fallback to OpenAI DALL-E or styled photorealistic SVG placeholder.
 */
export async function generateDesignImage(
  prompt: string,
  options: {
    model?: string;
    size?: string;
    aspectRatio?: "square" | "portrait" | "landscape";
  } = {}
): Promise<ImageGenResult> {
  const qwenKey = getEnvKey("QWEN_API_KEY") || getEnvKey("DASHSCOPE_API_KEY");
  const qwenBase = getEnvKey("QWEN_BASE_URL") || "https://dashscope.aliyuncs.com";
  const modelName = options.model || "qwen-image-3.0-pro";

  const sizeMap: Record<string, string> = {
    square: "1024*1024",
    portrait: "768*1024",
    landscape: "1024*768"
  };
  const sizeParam = sizeMap[options.aspectRatio || "portrait"] || options.size || "1024*1024";

  // 1. Try Qwen DashScope Text2Image API
  if (qwenKey && qwenKey.length > 5) {
    try {
      const endpoint = `${qwenBase.replace(/\/compatible-mode\/v1\/?$/, "")}/api/v1/services/aigc/text2image/image-synthesis`;
      const submitResp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${qwenKey}`,
          "X-DashScope-Async": "enable"
        },
        body: JSON.stringify({
          model: modelName,
          input: {
            prompt: prompt
          },
          parameters: {
            size: sizeParam,
            n: 1,
            prompt_extend: true
          }
        })
      });

      if (submitResp.ok) {
        const submitData = await submitResp.json() as any;
        const taskId = submitData?.output?.task_id;
        if (taskId) {
          // Poll DashScope task status
          const taskUrl = `${qwenBase.replace(/\/compatible-mode\/v1\/?$/, "")}/api/v1/tasks/${taskId}`;
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 1500));
            const pollResp = await fetch(taskUrl, {
              headers: { "Authorization": `Bearer ${qwenKey}` }
            });
            if (pollResp.ok) {
              const pollData = await pollResp.json() as any;
              const status = pollData?.output?.task_status;
              if (status === "SUCCEEDED") {
                const imgUrl = pollData?.output?.results?.[0]?.url;
                if (imgUrl) {
                  return { url: imgUrl, provider: "qwen" };
                }
              } else if (status === "FAILED" || status === "CANCELED") {
                break;
              }
            }
          }
        }
      }
    } catch {
      // Qwen image API failed or offline, proceed to fallback
    }
  }

  // 2. Fallback to OpenAI DALL-E if OPENAI_API_KEY is available
  const openaiKey = getEnvKey("OPENAI_API_KEY");
  if (openaiKey && openaiKey.length > 5) {
    try {
      const openaiResp = await fetch("https://api.openai.com/v1/images/generations", {
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
      }
    } catch {
      // OpenAI image API failed or offline, proceed to fallback
    }
  }

  // There is no third option. An earlier version returned one fixed stock
  // photograph here, with the prompt appended as a url fragment — which no
  // server ever receives. Every "generated" image was the same picture, and
  // the caller could not tell. A tool that cannot do its job says so.
  throw new ImageGenUnavailableError(
    "Image generation is not configured. Set QWEN_API_KEY (or DASHSCOPE_API_KEY) " +
      "or OPENAI_API_KEY to enable it."
  );
}
