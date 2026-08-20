import { documentSchema } from "./schema";
import type { Document, ParsedSizing } from "./types";

/**
 * Parses raw JSON string into a strictly validated Document structure.
 * Throws ZodError if the schema encounters unknown properties or invalid types.
 */
export function parseDocument(text: string): Document {
  const json = JSON.parse(text);
  return documentSchema.parse(json) as Document;
}

/**
 * Parses width or height values into a structured ParsedSizing object.
 *
 * Why:
 * The engine needs to easily distinguish between:
 * 1. Fixed numbers (e.g. 300) -> Used directly in measure/arrange
 * 2. "fit_content" or "fit_content(fallback)" -> Sized in measure pass
 * 3. "fill_container" or "fill_container(fallback)" -> Sized in arrange pass
 * 4. undefined -> { mode: "auto" } for groups and unconstrained frames
 */
export function parseSizing(value: number | string | undefined): ParsedSizing {
  if (value === undefined) {
    return { mode: "auto" };
  }

  if (typeof value === "number") {
    return { mode: "fixed", value };
  }

  const match = value.match(/^(fit_content|fill_container)(?:\((\d+(?:\.\d+)?)\))?$/);
  if (match) {
    const mode = match[1] as "fit_content" | "fill_container";
    const fallback = match[2] !== undefined ? parseFloat(match[2]) : undefined;
    return { mode, fallback };
  }

  return { mode: "fixed", value: 0 };
}
