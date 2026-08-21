export type ParsedSizing =
  | { mode: "auto" }
  | { mode: "fit_content"; fallback?: number }
  | { mode: "fill_container"; fallback?: number }
  | { mode: "fixed"; value: number };

export type PaddingValue = number | [number, number] | [number, number, number, number];

export type ColorStop = { offset: number; color: string };

export interface ColorFill {
  type: "color";
  color?: string;
  enabled?: boolean;
  opacity?: number;
  [key: string]: any;
}

export interface GradientFill {
  type: "gradient";
  gradientType?: "linear" | "radial" | string;
  rotation?: number;
  stops?: ColorStop[];
  enabled?: boolean;
  opacity?: number;
  [key: string]: any;
}

export interface ImageFill {
  type: "image";
  url?: string;
  src?: string;
  mode?: "fill" | "fit" | "tile" | "stretch" | "crop" | string;
  enabled?: boolean;
  opacity?: number;
  [key: string]: any;
}

export type Fill =
  | string
  | ColorFill
  | GradientFill
  | ImageFill
  | Record<string, any>;

export interface ShadowEffect {
  type: "shadow" | "inner_shadow" | string;
  color?: string;
  x?: number;
  y?: number;
  blur?: number;
  spread?: number;
  enabled?: boolean;
  [key: string]: any;
}

export interface BlurEffect {
  type: "blur" | "background_blur" | string;
  radius?: number;
  enabled?: boolean;
  [key: string]: any;
}

export type Effect = ShadowEffect | BlurEffect | { type: string; enabled?: boolean; [key: string]: any };

export interface BaseNode {
  id: string;
  type: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  fill?: Fill | Fill[];
  fills?: Fill[];
  stroke?: Fill | Fill[];
  strokes?: Fill[];
  strokeWidth?: number | { top?: number; right?: number; bottom?: number; left?: number };
  cornerRadius?: number | [number, number, number, number];
  rotation?: number;
  opacity?: number;
  layoutPosition?: "absolute";
  clip?: boolean;
  reusable?: boolean;
  enabled?: boolean;
  effect?: Effect | Effect[];
  effects?: Effect[];
  metadata?: Record<string, any>;
  [key: string]: any;
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
export interface EllipseNode extends BaseNode {
  type: "ellipse";
  innerRadius?: number;
  startAngle?: number;
  sweepAngle?: number;
}
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
  textAlign?: "left" | "center" | "right" | "justify" | string;
  textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
}
export interface NoteNode extends BaseNode { type: "note"; content?: string }
export interface PromptNode extends BaseNode { type: "prompt"; content?: string }
export interface ContextNode extends BaseNode { type: "context"; content?: string }
export interface IconNode extends BaseNode {
  type: "icon";
  icon?: string;
  library?: string;
  stroke?: string;
  strokeWidth?: number;
  fill?: Fill | Fill[] | string;
}
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
  metadata?: Record<string, any>;
  [key: string]: any;
}
