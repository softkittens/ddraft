import type { Document } from "../model/types";

export type AgentDocumentDecision =
  | { action: "accept"; expected: Document }
  | { action: "skip" }
  | { action: "abort" };

/**
 * Stale-snapshot gate: accept an agent document only if the canvas is still
 * the document the agent was last allowed to write.
 */
export function decideAgentDocument(
  current: Document,
  expected: Document,
  incoming: Document | undefined
): AgentDocumentDecision {
  if (!incoming) return { action: "skip" };
  if (incoming === expected) return { action: "skip" };
  if (current !== expected) return { action: "abort" };
  return { action: "accept", expected: incoming };
}
