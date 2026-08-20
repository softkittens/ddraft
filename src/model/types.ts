export type ParsedSizing =
  | { mode: "auto" }
  | { mode: "fit_content"; fallback?: number }
  | { mode: "fill_container"; fallback?: number }
  | { mode: "fixed"; value: number };

export type PaddingValue = number | [number, number] | [number, number, number, number];

export type ColorStop = { offset: number; color: string };

export type Fill =
  | string
  | { type: "color"; color: string }
  | {
      type: "gradient";
      gradientType?: "linear" | "radial";
      rotation?: number;
      stops: ColorStop[];
    }
  | { type: "image"; src: string; mode?: "fill" | "fit" | "tile" };

export interface ShadowEffect {
  type: "shadow" | "inner_shadow";
  color?: string;
  x?: number;
  y?: number;
  blur?: number;
  spread?: number;
}

export interface BlurEffect {
  type: "blur";
  radius?: number;
}

export type Effect = ShadowEffect | BlurEffect | { type: "background_blur"; radius?: number };

export interface BaseNode {
  id: string;
  type: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  fill?: Fill;
  stroke?: Fill;
  strokeWidth?: number | { top?: number; right?: number; bottom?: number; left?: number };
  cornerRadius?: number | [number, number, number, number];
  rotation?: number;
  opacity?: number;
  layoutPosition?: "absolute";
  clip?: boolean;
  reusable?: boolean;
  enabled?: boolean;
  effects?: Effect[];
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
