import type { Document } from "./types";

export function createDefaultDocument(): Document {
  return { version: "2.17", children: [], variables: {} };
}
