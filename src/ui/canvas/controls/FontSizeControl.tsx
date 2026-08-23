import { createMemo, type Component } from "solid-js";
import { typeScale, setNodeProperty } from "../../store";
import type { PenNode, TextNode } from "../../../model/types";
import { StepPicker } from "./StepPicker";
import { sharedValue } from "./values";

/** Font size, offered as the sizes this page already uses. */
export const FontSizeControl: Component<{ nodes: () => readonly PenNode[] }> = (props) => {
  const textNodes = createMemo(() => props.nodes().filter((node) => node.type === "text"));
  const current = createMemo(() =>
    sharedValue<number>(textNodes(), (node) => (node as TextNode).fontSize, String)
  );

  return (
    <StepPicker
      label="Size"
      min={1}
      display={() =>
        current().mixed ? "Mixed" : current().value !== undefined ? `${current().value}` : "—"
      }
      steps={() => typeScale().map((size) => ({ label: String(size), value: size }))}
      active={() => current().value}
      // Only the text nodes: applyProperty would skip the rest anyway, but
      // naming them keeps the reported result honest.
      onPick={(size) => setNodeProperty("fontSize", size, textNodes().map((node) => node.id))}
    />
  );
};
