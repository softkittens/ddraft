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

/**
 * Applies drop shadow and blur filter properties to a Canvas context.
 *
 * Why:
 * Canvas2D has native shadowColor/shadowBlur properties and CSS filter strings.
 * background_blur is deferred because it requires copying the framebuffer behind the node.
 */
export function applyEffects(ctx: CanvasRenderingContext2D, effects?: Effect[]): void {
  if (!effects || effects.length === 0) return;

  for (const effect of effects) {
    if (effect.type === "shadow") {
      ctx.shadowColor = effect.color ? (effect.color.startsWith("$") ? "rgba(0,0,0,0.2)" : effect.color) : "rgba(0,0,0,0.2)";
      ctx.shadowOffsetX = effect.x ?? 0;
      ctx.shadowOffsetY = effect.y ?? 4;
      ctx.shadowBlur = effect.blur ?? 8;
    } else if (effect.type === "blur") {
      const radius = effect.radius ?? 4;
      ctx.filter = `blur(${radius}px)`;
    }
  }
}

export function clearEffects(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = "transparent";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = 0;
  ctx.filter = "none";
}
