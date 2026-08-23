import type { Document, PenNode } from "./types";
import { setProperty } from "./edit";
import { findNode } from "./tree";
import { setInstanceProperty, splitInstanceId, type InstanceDescendantTarget } from "./instance";
import { getLucideIconPath } from "./icons";
import { ALLOWED_PROPERTIES, normalizePropertyValue, propertyAppliesTo } from "./vocabulary";

/**
 * One write path for setting a property on selected nodes.
 *
 * Before this, deciding whether an id named a real node or a descendant inside
 * a component instance was copied out at every call site that wanted to write
 * one — the inline text editor, the delete action, each agent tool. A control
 * panel is a dozen more call sites, and a dozen more chances to write straight
 * through an instance and edit every copy of a component at once.
 *
 * The rules, in order:
 *
 *   unknown property     refused, because the renderer honours a fixed set and
 *                        anything else is a silent no-op
 *   value vocabulary     'space-between' becomes 'space_between' once, before
 *                        the fan-out, so every node in the selection agrees
 *   wrong node type      skipped, not stamped — setting the size of two labels
 *                        and a frame should set two font sizes
 *   instance descendant  written as an override on the instance, so the
 *                        component and its other copies are left alone
 */

export interface ApplyPropertyResult {
  /** The same document object when nothing changed, so callers can test identity. */
  doc: Document;
  /** Ids actually written. */
  applied: string[];
  /** Ids the property does not apply to, or that name nothing. */
  skipped: string[];
  /** Why a value was rewritten or refused. Empty when the write was ordinary. */
  note: string;
}

/** The node a composite instance id points at, for the type check. */
function instanceDescendantNode(doc: Document, target: InstanceDescendantTarget): PenNode | null {
  const host = findNode(doc.children, target.refId);
  if (!host || host.type !== "ref" || !host.ref) return null;
  const component = findNode(doc.children, host.ref);
  if (!component) return null;
  return findNode([component], target.descendantId);
}

/**
 * An icon with no geometry draws nothing. The name is the part a person picks
 * and the path is the part the renderer needs, so a swap has to set both.
 */
function withIconGeometry(doc: Document, id: string, property: string, value: unknown): Document {
  if (property !== "icon" || typeof value !== "string") return doc;
  return setProperty(doc, id, "geometry", getLucideIconPath(value) || undefined);
}

export function applyProperty(
  doc: Document,
  ids: Iterable<string>,
  property: string,
  value: unknown
): ApplyPropertyResult {
  const targets = [...ids];
  const unchanged = (note: string): ApplyPropertyResult => ({ doc, applied: [], skipped: targets, note });

  if (!ALLOWED_PROPERTIES.has(property)) {
    return unchanged(`error: invalid property "${property}"`);
  }

  // Normalized once rather than per node, so a selection cannot end up half in
  // one spelling and half in the other.
  const vocabulary = normalizePropertyValue(property, value);
  // undefined is a legitimate value meaning "clear this property". It is only a
  // refusal when the caller passed something and the vocabulary rejected it.
  if (vocabulary.value === undefined && value !== undefined) return unchanged(vocabulary.note);
  const resolved = vocabulary.value;

  let next = doc;
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const id of targets) {
    const node = findNode(next.children, id);

    if (node) {
      if (!propertyAppliesTo(node.type, property)) {
        skipped.push(id);
        continue;
      }
      const before = next;
      next = setProperty(next, id, property, resolved);
      next = withIconGeometry(next, id, property, resolved);
      if (next === before) skipped.push(id);
      else applied.push(id);
      continue;
    }

    const inside = splitInstanceId(next, id);
    if (!inside) {
      skipped.push(id);
      continue;
    }
    const descendant = instanceDescendantNode(next, inside);
    if (!descendant || !propertyAppliesTo(descendant.type, property)) {
      skipped.push(id);
      continue;
    }
    const before = next;
    next = setInstanceProperty(next, inside, property, resolved);
    if (property === "icon" && typeof resolved === "string") {
      next = setInstanceProperty(next, inside, "geometry", getLucideIconPath(resolved) || undefined);
    }
    if (next === before) skipped.push(id);
    else applied.push(id);
  }

  return { doc: next, applied, skipped, note: vocabulary.note };
}
