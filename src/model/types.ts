/**
 * Sizing modes supported by the Pen specification.
 * - fixed: Explicit pixel value (e.g. 300)
 * - fit_content: Hugs the node's children/content (calculated during measure stage)
 * - fill_container: Stretches across remaining space in parent (calculated during arrange stage)
 */
export type SizingMode = "fit_content" | "fill_container" | "fixed";

export type ParsedSizing =
  | { mode: "fit_content"; fallback?: number }
  | { mode: "fill_container"; fallback?: number }
  | { mode: "fixed"; value: number };

/**
 * Padding can be defined as a single number (uniform), 2-tuple [v, h], or 4-tuple [t, r, b, l].
 */
export type PaddingValue = number | [number, number] | [number, number, number, number];

/**
 * Common properties shared by all node types in the document tree.
 */
export interface BaseNode {
  id: string;
  type: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  fill?: any;
  stroke?: any;
  strokeWidth?: number | { top?: number; right?: number; bottom?: number; left?: number };
  cornerRadius?: number | [number, number, number, number];
  rotation?: number;       // In degrees, counter-clockwise around top-left origin
  opacity?: number;
  layoutPosition?: "absolute"; // When set to absolute, node leaves normal flex flow
  clip?: boolean;
  reusable?: boolean;      // Marks a component definition
  enabled?: boolean;
}

export interface FrameNode extends BaseNode {
  type: "frame";
  layout?: "horizontal" | "vertical" | "none";
  gap?: number;
  padding?: PaddingValue;
  justifyContent?: "start" | "center" | "end" | "space_between" | "space_around";
  alignItems?: "start" | "center" | "end";
  children?: PenNode[];
}

export interface GroupNode extends BaseNode {
  type: "group";
  children?: PenNode[];
}

export interface RectangleNode extends BaseNode { type: "rectangle" }
export interface EllipseNode extends BaseNode { type: "ellipse" }
export interface PolygonNode extends BaseNode { type: "polygon"; points?: number[] }
export interface PathNode extends BaseNode { type: "path"; geometry?: string; viewBox?: string }
export interface TextNode extends BaseNode {
  type: "text";
  content?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  letterSpacing?: number;
  lineHeight?: number;
  textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
}
export interface NoteNode extends BaseNode { type: "note"; content?: string }
export interface PromptNode extends BaseNode { type: "prompt"; content?: string }
export interface ContextNode extends BaseNode { type: "context"; content?: string }
export interface IconNode extends BaseNode { type: "icon"; icon?: string; library?: string }
export interface ScriptNode extends BaseNode { type: "script"; code?: string }
export interface RefNode extends BaseNode {
  type: "ref";
  ref?: string;
  descendants?: Record<string, any>;
}

export type PenNode =
  | FrameNode | GroupNode | RectangleNode | EllipseNode | PolygonNode
  | PathNode | TextNode | NoteNode | PromptNode | ContextNode
  | IconNode | ScriptNode | RefNode;

export interface Document {
  version: string;
  children: PenNode[];
  variables?: Record<string, any>;
  fileToken?: string;
}
