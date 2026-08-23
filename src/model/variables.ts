import type { Fill } from "./types";

export function resolveVariable(val: Fill | string | undefined, variables?: Record<string, any>): string {
  if (!val) return "";
  if (typeof val === "object" && val !== null) {
    if (val.type === "color") return resolveVariable(val.color, variables);
    return "";
  }
  if (typeof val === "string" && val.startsWith("$") && variables) {
    const key = val.slice(1);
    const item = variables[key] ?? variables[val];
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      if (typeof item.value === "string") return item.value;
      if (Array.isArray(item.value)) {
        const entry = item.value.find((v: any) => v && typeof v.value === "string");
        if (entry) return entry.value;
      }
    }
  }
  return typeof val === "string" ? val : "";
}
