export type ParsedSizing =
  | { mode: "auto" }
  | { mode: "fit_content"; fallback?: number }
  | { mode: "fill_container"; fallback?: number }
  | { mode: "fixed"; value: number };

export type PaddingValue = number | [number, number] | [number, number, number, number] | number[];

export type ColorStop = { offset: number; color: string };

export type BlendMode =
  | "normal"
  | "darken"
  | "multiply"
  | "linearBurn"
  | "colorBurn"
  | "light"
  | "screen"
  | "linearDodge"
  | "colorDodge"
  | "overlay"
  | "softLight"
  | "hardLight"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export interface ColorFill {
  type: "color";
  color?: string;
  enabled?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  [key: string]: any;
}

export interface GradientFill {
  type: "gradient";
  gradientType?: "linear" | "radial" | "angular" | string;
  rotation?: number;
  stops?: ColorStop[];
  colors?: { color: string; position: number }[];
  center?: { x?: number; y?: number };
  size?: { width?: number; height?: number };
  enabled?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  [key: string]: any;
}

export interface ImageFill {
  type: "image";
  url?: string;
  src?: string;
  data?: string;
  mode?: "fill" | "fit" | "tile" | "stretch" | "crop" | string;
  enabled?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  [key: string]: any;
}

export interface ShaderFill {
  type: "shader";
  url?: string;
  uniforms?: Record<string, any>;
  enabled?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  [key: string]: any;
}

export interface MeshGradientFill {
  type: "mesh_gradient";
  columns?: number;
  rows?: number;
  colors?: string[];
  points?: any[];
  enabled?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  [key: string]: any;
}

export type Fill =
  | string
  | ColorFill
  | GradientFill
  | ImageFill
  | ShaderFill
  | MeshGradientFill
  | Record<string, any>;

export interface ShadowEffect {
  type: "shadow" | "inner_shadow";
  color?: string;
  x?: number;
  y?: number;
  offset?: { x?: number; y?: number };
  blur?: number;
  radius?: number;
  spread?: number;
  shadowType?: string;
  blendMode?: BlendMode;
  enabled?: boolean;
  [key: string]: any;
}

export interface BlurEffect {
  type: "blur" | "background_blur";
  radius?: number;
  blur?: number;
  enabled?: boolean;
  [key: string]: any;
}

export type Effect = ShadowEffect | BlurEffect;

export interface BaseNode {
  id: string;
  type: string;
  name?: string;
  context?: string;
  theme?: Record<string, string>;
  x?: number;
  y?: number;
  width?: number | string;
  height?: number | string;
  fill?: Fill | Fill[];
  fills?: Fill[];
  stroke?: Fill | Fill[];
  strokes?: Fill[];
  strokeWidth?: number | { top?: number; right?: number; bottom?: number; left?: number };
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "bevel" | "round";
  strokeAlignment?: "inner" | "center" | "outer";
  cornerRadius?: number | [number, number, number, number] | number[];
  rotation?: number;
  opacity?: number;
  flipX?: boolean;
  flipY?: boolean;
  layoutPosition?: "auto" | "absolute";
  clip?: boolean;
  reusable?: boolean;
  enabled?: boolean;
  effect?: Effect | Effect[];
  metadata?: Record<string, any>;
  [key: string]: any;
}

export interface FrameNode extends BaseNode {
  type: "frame";
  layout?: "horizontal" | "vertical" | "none";
  gap?: number;
  padding?: PaddingValue;
  layoutIncludeStroke?: boolean;
  placeholder?: boolean;
  slot?: false | string[];
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
export interface PolygonNode extends BaseNode {
  type: "polygon";
  polygonCount?: number;
  points?: number[] | any[];
}
export interface PathNode extends BaseNode {
  type: "path";
  geometry?: string;
  viewBox?: string | [number, number, number, number];
  fillRule?: "nonzero" | "evenodd";
}
export interface TextNode extends BaseNode {
  type: "text";
  content?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  letterSpacing?: number;
  lineHeight?: number;
  fontStyle?: string;
  underline?: boolean;
  strikethrough?: boolean;
  href?: string;
  textAlign?: "left" | "center" | "right" | "justify" | string;
  textAlignVertical?: "top" | "middle" | "bottom";
  textGrowth?: "auto" | "fixed-width" | "fixed-width-height";
}
export interface NoteNode extends BaseNode { type: "note"; content?: string }
export interface PromptNode extends BaseNode { type: "prompt"; content?: string; model?: string }
export interface ContextNode extends BaseNode { type: "context"; content?: string }
export interface IconNode extends BaseNode {
  type: "icon";
  icon?: string;
  library?: string;
  geometry?: string;
  weight?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: Fill | Fill[] | string;
}
export interface ScriptNode extends BaseNode {
  type: "script";
  code?: string;
  scriptUri?: string;
  inputs?: Record<string, any>;
}
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
  themes?: Record<string, string[]>;
  imports?: Record<string, string>;
  variables?: Record<string, any>;
  fileToken?: string;
  metadata?: Record<string, any>;
  [key: string]: any;
}
