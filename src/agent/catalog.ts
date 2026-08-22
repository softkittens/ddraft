export interface CatalogModel {
  id: string;
  label: string;
  api?: "responses" | "messages";
  vision?: boolean;
  /** Overrides the provider ceiling for this model. See maxOutputTokens below. */
  maxOutputTokens?: number;
}

export interface CatalogProvider {
  id: "vercel" | "opencode-go" | "qwen-studio" | "gemini" | "xai";
  label: string;
  envKeys: string[];
  baseUrlEnv?: string | string[];
  baseUrl: string;
  /**
   * Most output tokens one reply may use, when this provider caps lower than
   * the default in stream.ts.
   *
   * The default has to be generous — a round is meant to carry several tool
   * calls and a whole screen subtree is a large argument — but a ceiling above
   * what an endpoint accepts is a 400 on every request rather than a shorter
   * reply, so anything known to cap lower states it here.
   */
  maxOutputTokens?: number;
  models: CatalogModel[];
}

export const PROVIDER_CATALOG: CatalogProvider[] = [
  {
    id: "vercel",
    label: "Vercel AI Gateway",
    envKeys: ["VERCEL_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_AI_GATEWAY_API_KEY"],
    baseUrlEnv: ["VERCEL_BASE_URL", "AI_GATEWAY_BASE_URL"],
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    models: [
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", vision: true }
    ]
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    envKeys: ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"],
    baseUrlEnv: "OPENCODE_GO_BASE_URL",
    baseUrl: "https://opencode.ai/zen/go/v1",
    models: [
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", api: "responses", vision: true },
      { id: "grok-4.5", label: "Grok 4.5", api: "responses", vision: true },
      { id: "kimi-k3", label: "Kimi K3", vision: true },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", vision: true },
      { id: "glm-5.3", label: "GLM-5.3" },
      { id: "glm-5.2", label: "GLM-5.2" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-flash-vision-exp", label: "DeepSeek V4 Flash Vision", vision: true },
      { id: "minimax-m3", label: "MiniMax M3", api: "messages", vision: true },
      { id: "qwen3.8-max", label: "Qwen3.8 Max", api: "messages", vision: true },
      { id: "qwen3.7-max", label: "Qwen3.7 Max", api: "messages" },
      { id: "mimo-v2.5-pro", label: "MiMo-V2.5 Pro" },
      { id: "mimo-v2.5", label: "MiMo-V2.5", vision: true },
      { id: "hy3", label: "Hy3" }
    ]
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envKeys: ["GEMINI_API_KEY"],
    baseUrlEnv: "GEMINI_BASE_URL",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", vision: true },
      { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", vision: true }
    ]
  },
  {
    id: "xai",
    label: "xAI",
    envKeys: ["XAI_API_KEY"],
    baseUrlEnv: "XAI_BASE_URL",
    baseUrl: "https://api.x.ai/v1",
    models: [
      { id: "grok-4.6", label: "Grok 4.6", api: "responses", vision: true }
    ]
  },
  {
    id: "qwen-studio",
    label: "Qwen Studio",
    envKeys: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
    baseUrlEnv: ["QWEN_BASE_URL", "DASHSCOPE_BASE_URL"],
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen-plus", label: "Qwen Plus" },
      { id: "qwen-turbo", label: "Qwen Turbo" },
      { id: "qwen-max", label: "Qwen Max" },
      { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus" },
      { id: "qwen3.8-max", label: "Qwen3.8 Max" }
    ]
  }
];

export function catalogById(id: string): CatalogProvider | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

/**
 * Whether a model reads images.
 *
 * OpenAI's whole listed line takes image input, so it is declared once here
 * instead of on seventeen rows. Everything else says so per model. Kept in one
 * function because two places used to answer this question — loadProvider and
 * toApiMessages — and they answered it differently.
 */
export function modelSupportsVision(_provider: CatalogProvider, model: CatalogModel): boolean {
  return Boolean(model.vision);
}

/**
 * Another model on the same provider that can read the screenshot.
 *
 * The critic needs eyes; the model driving the canvas does not. When the chosen
 * model cannot see — or turns out not to, because the endpoint fails on the
 * image — the review is handed to the first vision model this provider offers
 * and the critique comes back for the original model to implement.
 *
 * Same provider, deliberately: that is the key the user already supplied and
 * the endpoint they already chose. Sending their canvas to a service they did
 * not select would not be a fallback, it would be a different decision.
 */
export function visionModelFor(
  providerId: string,
  exclude: readonly string[] = []
): CatalogModel | undefined {
  const spec = catalogById(providerId);
  return spec?.models.find(
    (model) => modelSupportsVision(spec, model) && !exclude.includes(model.id)
  );
}

export function readEnvKey(env: Record<string, string | undefined>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value) return value;
  }
  return undefined;
}
