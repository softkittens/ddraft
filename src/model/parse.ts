import { z } from "zod";
import type { Document, ParsedSizing } from "./types";

const sizingExprRegex = /^(fit_content|fill_container)(\((\d+(\.\d+)?)\))?$/;

function openObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).passthrough();
}

export const colorStopSchema = openObject({
  offset: z.number(),
  color: z.string()
});

export const fillSchema = z.union([
  z.string(),
  openObject({
    type: z.literal("color"),
    color: z.string().optional(),
    enabled: z.boolean().optional(),
    opacity: z.number().optional()
  }),
  openObject({
    type: z.literal("gradient"),
    gradientType: z.enum(["linear", "radial"]).or(z.string()).optional(),
    rotation: z.number().optional(),
    stops: z.array(colorStopSchema).optional(),
    enabled: z.boolean().optional(),
    opacity: z.number().optional()
  }),
  openObject({
    type: z.literal("image"),
    url: z.string().optional(),
    src: z.string().optional(),
    data: z.string().optional(),
    mode: z.enum(["fill", "fit", "tile", "stretch", "crop"]).or(z.string()).optional(),
    enabled: z.boolean().optional(),
    opacity: z.number().optional()
  })
]);

export const shadowEffectSchema = z.object({
  type: z.enum(["shadow", "inner_shadow"]),
  color: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  blur: z.number().optional(),
  spread: z.number().optional(),
  enabled: z.boolean().optional()
}).strict();

export const blurEffectSchema = z.object({
  type: z.enum(["blur", "background_blur"]),
  radius: z.number().optional(),
  enabled: z.boolean().optional()
}).strict();

export const effectSchema = z.union([
  shadowEffectSchema,
  blurEffectSchema
]);

export const paddingSchema = z.union([
  z.number(),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
  z.array(z.number())
]);

const baseProps = {
  id: z.string(),
  name: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  fill: z.union([fillSchema, z.array(fillSchema)]).optional(),
  fills: z.array(fillSchema).optional(),
  stroke: z.union([fillSchema, z.array(fillSchema)]).optional(),
  strokes: z.array(fillSchema).optional(),
  strokeWidth: z.union([
    z.number(),
    openObject({
      top: z.number().optional(),
      right: z.number().optional(),
      bottom: z.number().optional(),
      left: z.number().optional()
    })
  ]).optional(),
  cornerRadius: z.union([
    z.number(),
    z.tuple([z.number(), z.number(), z.number(), z.number()]),
    z.array(z.number())
  ]).optional(),
  rotation: z.number().optional(),
  opacity: z.number().optional(),
  layoutPosition: z.enum(["absolute"]).optional(),
  clip: z.boolean().optional(),
  reusable: z.boolean().optional(),
  enabled: z.boolean().optional(),
  effect: z.union([effectSchema, z.array(effectSchema)]).optional(),
  metadata: z.record(z.any()).optional()
};

export const penNodeSchema: z.ZodType<any> = z.lazy(() =>
  z.discriminatedUnion("type", [
    openObject({
      ...baseProps,
      type: z.literal("frame"),
      layout: z.enum(["horizontal", "vertical", "none"]).optional(),
      gap: z.number().optional(),
      padding: paddingSchema.optional(),
      justifyContent: z.enum(["start", "center", "end", "space_between", "space_around"]).optional(),
      alignItems: z.enum(["start", "center", "end"]).optional(),
      children: z.array(penNodeSchema).optional()
    }),
    openObject({
      ...baseProps,
      type: z.literal("group"),
      children: z.array(penNodeSchema).optional()
    }),
    openObject({ ...baseProps, type: z.literal("rectangle") }),
    openObject({
      ...baseProps,
      type: z.literal("ellipse"),
      innerRadius: z.number().optional(),
      startAngle: z.number().optional(),
      sweepAngle: z.number().optional()
    }),
    openObject({
      ...baseProps,
      type: z.literal("polygon"),
      points: z.array(z.any()).optional()
    }),
    openObject({
      ...baseProps,
      type: z.literal("path"),
      geometry: z.string().optional(),
      viewBox: z.string().optional()
    }),
    openObject({
      ...baseProps,
      type: z.literal("text"),
      content: z.string().optional(),
      fontFamily: z.string().optional(),
      fontSize: z.number().optional(),
      fontWeight: z.union([z.string(), z.number()]).optional(),
      letterSpacing: z.number().optional(),
      lineHeight: z.number().optional(),
      textAlign: z.string().optional(),
      textGrowth: z.enum(["auto", "fixed-width", "fixed-width-height"]).optional()
    }),
    openObject({ ...baseProps, type: z.literal("note"), content: z.string().optional() }),
    openObject({ ...baseProps, type: z.literal("prompt"), content: z.string().optional() }),
    openObject({ ...baseProps, type: z.literal("context"), content: z.string().optional() }),
    openObject({ ...baseProps, type: z.literal("icon"), icon: z.string().optional(), library: z.string().optional(), geometry: z.string().optional() }),
    openObject({ ...baseProps, type: z.literal("script"), code: z.string().optional() }),
    openObject({
      ...baseProps,
      type: z.literal("ref"),
      ref: z.string().optional(),
      descendants: z.record(z.any()).optional()
    })
  ])
);

export const documentSchema = openObject({
  version: z.string().optional().default("2.17"),
  children: z.array(penNodeSchema).optional().default([]),
  variables: z.record(z.any()).optional(),
  fileToken: z.string().optional(),
  metadata: z.record(z.any()).optional()
});

export function parseDocument(text: string): Document {
  const json = JSON.parse(text);
  return documentSchema.parse(json) as Document;
}

export function parseSizing(value: number | string | undefined): ParsedSizing {
  if (value === undefined || value === "auto") {
    return { mode: "auto" };
  }
  if (typeof value === "number") {
    return { mode: "fixed", value };
  }
  const match = value.match(sizingExprRegex);
  if (match) {
    const mode = match[1] as "fit_content" | "fill_container";
    const fallback = match[3] ? parseFloat(match[3]) : undefined;
    return { mode, fallback };
  }
  return { mode: "fixed", value: 0 };
}
