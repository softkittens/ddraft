import type { Document, PenNode } from "../model/types";
import { childrenOf, cloneDocument, findNode, findParent, indexDocument, isParentNode } from "../model/tree";

export type AgentDocumentDecision =
  | { action: "accept"; expected: Document }
  | { action: "skip" };

/**
 * 3-Way AST Merge: Merges agent modifications against the current canvas state,
 * preserving all user edits made while the agent was working.
 */
export function mergeDocuments(
  base: Document,
  user: Document,
  agent: Document
): Document {
  if (user === base) return agent;
  if (agent === base) return user;

  const baseMap = indexDocument(base);
  const userMap = indexDocument(user);
  const agentMap = indexDocument(agent);

  // Start with a clone of user document to preserve all user modifications & positions
  const merged: Document = cloneDocument(user);
  const mergedMap = indexDocument(merged);

  // 1. Merge variables / styles
  if (agent.variables) {
    merged.variables = { ...merged.variables, ...agent.variables };
  }

  // 2. Process node additions and property updates from Agent
  for (const [id, agentNode] of agentMap.entries()) {
    const baseNode = baseMap.get(id);
    const userNode = userMap.get(id);

    if (!baseNode) {
      // Node was CREATED by Agent
      if (!mergedMap.has(id)) {
        const agentParent = findParent(agent.children, id);
        if (agentParent) {
          const mergedParent = findNode(merged.children, agentParent.id);
          if (mergedParent && isParentNode(mergedParent)) {
            const agentKids = childrenOf(agentParent);
            const index = agentKids.findIndex((k) => k.id === id);
            const clonedChild = structuredClone(agentNode);
            const parentChildren = childrenOf(mergedParent);
            if (index >= 0 && index < parentChildren.length) {
              parentChildren.splice(index, 0, clonedChild);
            } else {
              parentChildren.push(clonedChild);
            }
            (mergedParent as any).children = parentChildren;
            mergedMap.set(id, clonedChild);
          } else {
            const clonedChild = structuredClone(agentNode);
            merged.children.push(clonedChild);
            mergedMap.set(id, clonedChild);
          }
        } else {
          const clonedChild = structuredClone(agentNode);
          merged.children.push(clonedChild);
          mergedMap.set(id, clonedChild);
        }
      }
    } else {
      // Node existed in base. Apply Agent's property updates where User didn't touch them
      const targetMergedNode = mergedMap.get(id);
      if (targetMergedNode) {
        for (const key of Object.keys(agentNode) as (keyof PenNode)[]) {
          if (key === "children" || key === "id") continue;
          const baseVal = (baseNode as any)[key];
          const agentVal = (agentNode as any)[key];
          const userVal = userNode ? (userNode as any)[key] : undefined;

          // If Agent changed the property:
          if (JSON.stringify(agentVal) !== JSON.stringify(baseVal)) {
            // If User did NOT modify this property from base, accept Agent's change:
            if (JSON.stringify(userVal) === JSON.stringify(baseVal)) {
              (targetMergedNode as any)[key] = structuredClone(agentVal);
            }
          }
        }
      }
    }
  }

  // 3. Process node deletions by Agent
  for (const [id, baseNode] of baseMap.entries()) {
    if (!agentMap.has(id) && userMap.has(id)) {
      const userNode = userMap.get(id);
      // Only delete if user didn't modify it
      if (JSON.stringify(userNode) === JSON.stringify(baseNode)) {
        const mergedParent = findParent(merged.children, id);
        if (mergedParent && isParentNode(mergedParent)) {
          (mergedParent as any).children = childrenOf(mergedParent).filter((c) => c.id !== id);
        } else {
          merged.children = merged.children.filter((c) => c.id !== id);
        }
      }
    }
  }

  return merged;
}

/**
 * Reconcile incoming agent document against live canvas state via 3-way AST merge.
 */
export function decideAgentDocument(
  current: Document,
  expected: Document,
  incoming: Document | undefined
): AgentDocumentDecision {
  if (!incoming) return { action: "skip" };
  if (incoming === expected && current === expected) return { action: "skip" };
  if (current === expected) return { action: "accept", expected: incoming };

  const merged = mergeDocuments(expected, current, incoming);
  return { action: "accept", expected: merged };
}
