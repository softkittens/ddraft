import type { LayoutNode, Box } from "../layout/types";
import type { PenNode, TextNode } from "../model/types";

export type DrawCommand =
  | { type: "save" }
  | { type: "restore" }
  | { type: "translate"; x: number; y: number }
  | { type: "clip_rect"; box: Box; cornerRadius?: number | [number, number, number, number] }
  | {
      type: "draw_node";
      nodeId: string;
      nodeType: string;
      box: Box;
      nodeData?: PenNode;
    };

/**
 * Converts a LayoutNode tree into a flat display list of draw commands.
 *
 * Why:
 * Separating draw commands from layout enables filtering (frustum culling),
 * layer reordering, and swapping renderers (Canvas2D, WebGL, SVG).
 */
export function buildDisplayList(
  nodes: LayoutNode[],
  nodeDataMap?: Map<string, PenNode>
): DrawCommand[] {
  const commands: DrawCommand[] = [];

  function traverse(layoutNode: LayoutNode) {
    const nodeData = nodeDataMap?.get(layoutNode.id);

    commands.push({
      type: "draw_node",
      nodeId: layoutNode.id,
      nodeType: layoutNode.type,
      box: layoutNode.box,
      nodeData
    });

    for (const child of layoutNode.children) {
      traverse(child);
    }
  }

  for (const root of nodes) {
    traverse(root);
  }

  return commands;
}
