export interface CatalogModel {
  id: string;
  label: string;
  description?: string;
  api?: "responses" | "messages";
  vision?: boolean;
  /** Overrides the provider ceiling for this model. See maxOutputTokens below. */
  maxOutputTokens?: number;
}

export interface CatalogProvider {
  id: "vercel" | "opencode-zen" | "opencode-go" | "qwen-studio" | "gemini" | "xai";
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
    /*
     * One key, several vendors.
     *
     * The gateway routes vendor-prefixed ids, so this is the only provider
     * where the design model and the critic can be different houses without
     * asking the user for a second key. That matters for review: a model does
     * not see the thing it just failed to see, and until now the critic was
     * always the model that drew the canvas.
     *
     * Luna stays first: loadProvider falls back to models[0] when the caller
     * names none, and the cheapest model in the series is the right thing to
     * bill an unattended default to. The vendor-prefixed ids take the chat API
     * by inference, which the gateway serves for every vendor it routes.
     */
    models: [
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Cheap & fast", vision: true },
      { id: "deepseek/deepseek-v4-flash-vision-exp", label: "DeepSeek Flash Vision", description: "Cheap & decent", vision: true },
      { id: "minimax/minimax-m3", label: "MiniMax M3", description: "Fast & creative with vision", vision: true },
      { id: "mimo/mimo-v2.5-pro", label: "MiMo V2.5 Pro", description: "Balanced quality & reasoning", vision: true },
      { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash", description: "Fast & best value", vision: true },
      { id: "anthropic/claude-opus-5", label: "Claude Opus 5", description: "Expensive & highly capable", vision: true },
      { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol", description: "Expensive, frontier intelligence", vision: true }
    ]
  },
  {
    id: "opencode-zen",
    label: "OpenCode Zen",
    envKeys: ["OPENCODE_ZEN_API_KEY", "OPENCODE_API_KEY", "OPENCODE_GO_API_KEY"],
    baseUrlEnv: "OPENCODE_ZEN_BASE_URL",
    baseUrl: "https://opencode.ai/zen/v1",
    models: [
      { id: "x-preview-f-free", label: "Ox Alpha Free (Unlimited)", description: "Free & unlimited drafting", vision: true },
      { id: "hy3-free", label: "Hy3 Free", description: "Fast free generation" },
      { id: "mimo-v2.5-free", label: "MiMo V2.5 Free", description: "Free vision reasoning", vision: true },
      { id: "muse-spark-1.2-contributor-free", label: "Muse Spark 1.2 Free", description: "Free design generation" },
      { id: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra Free", description: "Free coding & design" },
      { id: "nemotron-3.5-lightning-free", label: "Nemotron 3.5 Lightning Free", description: "Ultra-fast free iterations" },
      { id: "laguna-s-2.1-free", label: "Laguna S 2.1 Free", description: "Lightweight free model" }
    ]
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    envKeys: ["OPENCODE_GO_API_KEY", "OPENCODE_API_KEY"],
    baseUrlEnv: "OPENCODE_GO_BASE_URL",
    baseUrl: "https://opencode.ai/zen/go/v1",
    models: [
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", description: "Cheap & fast", api: "responses", vision: true },
      { id: "grok-4.5", label: "Grok 4.5", description: "Fast reasoning", api: "responses", vision: true },
      { id: "ox-alpha-free", label: "Ox Alpha (Free)", description: "Free tier model", api: "responses", vision: true },
      { id: "kimi-k3", label: "Kimi K3", description: "Strong context & reasoning", vision: true },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", description: "Specialized code generation", vision: true },
      { id: "kimi-k2.6", label: "Kimi K2.6", description: "Solid coding model", vision: true },
      { id: "kimi-k2.5", label: "Kimi K2.5", description: "Fast conversational coder" },
      { id: "glm-5.3", label: "GLM-5.3", description: "Latest bilingual reasoning" },
      { id: "glm-5.2", label: "GLM-5.2", description: "Balanced reasoning model" },
      { id: "glm-5.1", label: "GLM-5.1", description: "Fast general model" },
      { id: "glm-5", label: "GLM-5", description: "Standard bilingual base" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", description: "High reasoning capacity" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", description: "High-speed text model" },
      { id: "deepseek-v4-flash-vision-exp", label: "DeepSeek V4 Flash Vision", description: "Cheap & decent", vision: true },
      { id: "minimax-m3", label: "MiniMax M3", description: "Fast & creative with vision", api: "messages", vision: true },
      { id: "minimax-m2.7", label: "MiniMax M2.7", description: "Creative copy and layout", api: "messages" },
      { id: "minimax-m2.5", label: "MiniMax M2.5", description: "Speed-focused creative agent", api: "messages" },
      { id: "qwen3.8-max", label: "Qwen3.8 Max", description: "Flagship vision & reasoning", api: "messages", vision: true },
      { id: "qwen3.7-max", label: "Qwen3.7 Max", description: "High capability model", api: "messages" },
      { id: "qwen3.7-plus", label: "Qwen3.7 Plus", description: "Balanced speed and depth" },
      { id: "qwen3.6-plus", label: "Qwen3.6 Plus", description: "Reliable general drafting" },
      { id: "qwen3.5-plus", label: "Qwen3.5 Plus", description: "Fast drafting model" },
      { id: "mimo-v2.5-pro", label: "MiMo-V2.5 Pro", description: "Balanced quality & reasoning" },
      { id: "mimo-v2.5", label: "MiMo-V2.5", description: "Fast multimodal reasoning", vision: true },
      { id: "mimo-v2-omni", label: "MiMo-V2 Omni", description: "Omni visual assistant", vision: true },
      { id: "mimo-v2-pro", label: "MiMo-V2 Pro", description: "Solid general performer" },
      { id: "hy3", label: "Hy3", description: "General multipurpose model" },
      { id: "hy3-preview", label: "Hy3 Preview", description: "Experimental preview release" },
      { id: "muse-spark-1.2-contributor", label: "Muse Spark 1.2", description: "Creative layout engine" }
    ]
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envKeys: ["GEMINI_API_KEY"],
    baseUrlEnv: "GEMINI_BASE_URL",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", description: "Advanced reasoning & vision", vision: true },
      { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", description: "Fast & best value", vision: true }
    ]
  },
  {
    id: "xai",
    label: "xAI",
    envKeys: ["XAI_API_KEY"],
    baseUrlEnv: "XAI_BASE_URL",
    baseUrl: "https://api.x.ai/v1",
    models: [
      { id: "grok-4.6", label: "Grok 4.6", description: "Frontier reasoning & vision", api: "responses", vision: true }
    ]
  },
  {
    id: "qwen-studio",
    label: "Qwen Studio",
    envKeys: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
    baseUrlEnv: ["QWEN_BASE_URL", "DASHSCOPE_BASE_URL"],
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen-plus", label: "Qwen Plus", description: "Balanced speed & quality" },
      { id: "qwen-turbo", label: "Qwen Turbo", description: "Fast & lightweight" },
      { id: "qwen-max", label: "Qwen Max", description: "High reasoning capacity" },
      { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus", description: "Optimized for structured code" },
      { id: "qwen3.8-max", label: "Qwen3.8 Max", description: "Flagship intelligence" }
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
