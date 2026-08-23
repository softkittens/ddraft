import { createMemo, type Component } from "solid-js";
import { radiusScale, setNodeProperty } from "../../store";
import { PILL_RADIUS } from "../../../model/tokens";
import type { PenNode } from "../../../model/types";
import { StepPicker } from "./StepPicker";
import { sharedValue } from "./values";

/**
 * Corner radius.
 *
 * Only offered for the node types that draw a box. `shapes.ts` reads
 * cornerRadius in its default branch, so text, icons, ellipses, paths and
 * polygons ignore it — a control for it there would do nothing visible.
 */
const BOXLESS = new Set(["text", "icon", "ellipse", "path", "polygon"]);

export function hasCorners(node: PenNode): boolean {
  return !BOXLESS.has(node.type);
}

/** One number when every corner agrees, otherwise nothing to show. */
function uniformRadius(node: PenNode): number | undefined {
  const raw = (node as any).cornerRadius;
  if (typeof raw === "number") return raw;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.every((corner) => corner === raw[0]) ? raw[0] : undefined;
}

export const RadiusControl: Component<{ nodes: () => readonly PenNode[] }> = (props) => {
  const boxes = createMemo(() => props.nodes().filter(hasCorners));
  const current = createMemo(() => sharedValue<number>(boxes(), uniformRadius, String));

  const label = () => {
    if (current().mixed) return "Mixed";
    const value = current().value;
    if (value === undefined) return "0";
    return value >= PILL_RADIUS ? "Full" : String(value);
  };

  return (
    <StepPicker
      label="Radius"
      width={208}
      columns={4}
      display={label}
      steps={() => [
        { label: "0", value: 0 },
        ...radiusScale().map((step: number) => ({ label: String(step), value: step })),
        { label: "Full", value: PILL_RADIUS }
      ]}
      active={() => current().value}
      onPick={(value) => setNodeProperty("cornerRadius", value, boxes().map((node) => node.id))}
    />
  );
};
