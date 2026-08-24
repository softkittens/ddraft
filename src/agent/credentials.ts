import type { Provider, ReasoningEffort } from "./provider";
import {
  PROVIDER_CATALOG,
  catalogById,
  modelSupportsVision,
  readEnvKey,
  visionModelFor,
  type CatalogProvider
} from "./catalog";

export interface PublicProvider {
  id: CatalogProvider["id"];
  label: string;
  models: { id: string; label: string; description?: string }[];
}

function envBag(env?: Record<string, string | undefined>): Record<string, string | undefined> {
  return env ?? (process.env as Record<string, string | undefined>);
}

export function listConfiguredProviders(env?: Record<string, string | undefined>): PublicProvider[] {
  const bag = envBag(env);
  return PROVIDER_CATALOG.filter((p) => readEnvKey(bag, p.envKeys)).map((p) => ({
    id: p.id,
    label: p.label,
    models: p.models.map((m) => ({ id: m.id, label: m.label, description: m.description }))
  }));
}

/** A model that no provider in the catalog offers. */
export class UnknownModelError extends Error {}

export function loadProvider(
  id: string,
  env?: Record<string, string | undefined>,
  model?: string,
  reasoningEffort?: ReasoningEffort
): Provider | null {
  const spec = catalogById(id);
  if (!spec) return null;
  const bag = envBag(env);
  const apiKey = readEnvKey(bag, spec.envKeys);
  if (!apiKey) return null;
  // An unknown model is an error, not a reason to pick a different one. A run
  // billed and scored against a model nobody asked for is worse than no run.
  const selected = model
    ? spec.models.find((m) => m.id === model || m.id.endsWith(`/${model}`) || m.id.replace(/^[^/]+\//, "") === model)
    : spec.models[0];
  if (model && !selected) {
    throw new UnknownModelError(
      `${spec.label} does not offer the model "${model}". It offers: ${spec.models.map((m) => m.id).join(", ")}`
    );
  }
  const baseUrl = (spec.baseUrlEnv ? (Array.isArray(spec.baseUrlEnv) ? readEnvKey(bag, spec.baseUrlEnv) : bag[spec.baseUrlEnv]) : undefined) || spec.baseUrl;
  return {
    id: spec.id,
    baseUrl,
    model: selected?.id || model || spec.models[0].id,
    apiKey,
    reasoningEffort,
    api: selected?.api || "chat",
    vision: selected ? modelSupportsVision(spec, selected) : false,
    maxOutputTokens: selected?.maxOutputTokens ?? spec.maxOutputTokens,
    reasoning: selected?.reasoning ?? { defaultEffort: "medium" },
    wire: selected?.wire ?? {}
  };
}

/**
 * The same provider, loaded on a model that can read the screenshot.
 *
 * Returns null when this provider has no such model left to try, which the
 * caller reports rather than papering over: a review nobody ran is not a pass.
 */
export function loadVisionProvider(
  id: string,
  env: Record<string, string | undefined> | undefined,
  tried: readonly string[],
  reasoningEffort?: ReasoningEffort
): Provider | null {
  const alternate = visionModelFor(id, tried);
  return alternate ? loadProvider(id, env, alternate.id, reasoningEffort) : null;
}
