/**
 * A resolved geometric bounding box.
 * Coordinates (x, y) are in the local coordinate space of the parent node.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A node in the resolved layout tree.
 * Retains hierarchy and computed Box coordinates, separated from the document model.
 */
export interface LayoutNode {
  id: string;
  type: string;
  box: Box;
  rotation?: number; // In degrees, counter-clockwise around top-left (0, 0)
  children: LayoutNode[];
}

/**
 * Axis abstraction:
 * - In "horizontal" layout: main = X axis (width), cross = Y axis (height)
 * - In "vertical" layout: main = Y axis (height), cross = X axis (width)
 */
export type Axis = "main" | "cross";

/**
 * Standardised four-edge padding structure.
 */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
