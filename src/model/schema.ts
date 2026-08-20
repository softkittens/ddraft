import { z } from "zod";

const paddingSchema = z.union([
  z.number(),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()])
]);

export const colorStopSchema = z.object({
  offset: z.number(),
  color: z.string()
}).strict();

export const fillSchema = z.union([
  z.string(),
  z.object({ type: z.literal("color"), color: z.string() }).strict(),
  z.object({
    type: z.literal("gradient"),
    gradientType: z.enum(["linear", "radial"]).optional(),
    rotation: z.number().optional(),
    stops: z.array(colorStopSchema)
  }).strict(),
  z.object({
    type: z.literal("image"),
    src: z.string(),
    mode: z.enum(["fill", "fit", "tile"]).optional()
  }).strict()
]);

export const effectSchema = z.union([
  z.object({
    type: z.enum(["shadow", "inner_shadow"]),
    color: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    blur: z.number().optional(),
    spread: z.number().optional()
  }).strict(),
  z.object({
    type: z.literal("blur"),
    radius: z.number().optional()
  }).strict(),
  z.object({
    type: z.literal("background_blur"),
    radius: z.number().optional()
  }).strict()
]);

const baseProps = {
  id: z.string(),
  name: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  fill: fillSchema.optional(),
  stroke: fillSchema.optional(),
  strokeWidth: z.union([
    z.number(),
    z.object({ top: z.number().optional(), right: z.number().optional(), bottom: z.number().optional(), left: z.number().optional() }).strict()
  ]).optional(),
  cornerRadius: z.union([z.number(), z.tuple([z.number(), z.number(), z.number(), z.number()])]).optional(),
  rotation: z.number().optional(),
  opacity: z.number().optional(),
  layoutPosition: z.enum(["absolute"]).optional(),
  clip: z.boolean().optional(),
  reusable: z.boolean().optional(),
  enabled: z.boolean().optional(),
  effects: z.array(effectSchema).optional()
};

export const penNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ ...baseProps, type: z.literal("frame"), layout: z.enum(["horizontal", "vertical", "none"]).optional(), gap: z.number().optional(), padding: paddingSchema.optional(), justifyContent: z.enum(["start", "center", "end", "space_between", "space_around"]).optional(), alignItems: z.enum(["start", "center", "end"]).optional(), children: z.array(penNodeSchema).optional() }).strict(),
    z.object({ ...baseProps, type: z.literal("group"), children: z.array(penNodeSchema).optional() }).strict(),
    z.object({ ...baseProps, type: z.literal("rectangle") }).strict(),
    z.object({ ...baseProps, type: z.literal("ellipse") }).strict(),
    z.object({ ...baseProps, type: z.literal("polygon"), points: z.array(z.number()).optional() }).strict(),
    z.object({ ...baseProps, type: z.literal("path"), geometry: z.string().optional(), viewBox: z.string().optional() }).strict(),
    z.object({ ...baseProps, type: z.literal("text"), content: z.string().optional(), fontFamily: z.string().optional(), fontSize: z.number().optional(), fontWeight: z.union([z.string(), z.number()]).optional(), letterSpacing: z.number().optional(), lineHeight: z.number().optional(), textGrowth: z.enum(["auto", "fixed-width", "fixed-width-height"]).optional() }).strict(),
    z.object({ ...baseProps, type: z.literal("note"), content: z.string().optional() }).strict(),
    z.object({ ...baseProps, type: z.literal("prompt"), content: z.string().optional() }).strict(),
    z.object({ ...baseProps, type: z.literal("context"), content: z.string().optional() }).strict(),
    z.object({ ...baseProps, type: z.literal("icon"), icon: z.string().optional(), library: z.string().optional() }).strict(),
    z.object({ ...baseProps, type: z.literal("script"), code: z.string().optional() }).strict(),
    z.object({ ...baseProps, type: z.literal("ref"), ref: z.string().optional(), descendants: z.record(z.any()).optional() }).strict()
  ])
);

export const documentSchema = z.object({
  version: z.string(),
  children: z.array(penNodeSchema),
  variables: z.record(z.any()).optional(),
  fileToken: z.string().optional()
}).strict();
