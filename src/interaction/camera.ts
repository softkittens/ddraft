export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export function createCamera(x = 0, y = 0, zoom = 1): Camera {
  return { x, y, zoom };
}

/**
 * Converts a point from world space (document coordinates) to screen space (pixels).
 */
export function worldToScreen(world: Point, camera: Camera): Point {
  return {
    x: world.x * camera.zoom + camera.x,
    y: world.y * camera.zoom + camera.y
  };
}

/**
 * Converts a point from screen space (pixels) to world space (document coordinates).
 */
export function screenToWorld(screen: Point, camera: Camera): Point {
  return {
    x: (screen.x - camera.x) / camera.zoom,
    y: (screen.y - camera.y) / camera.zoom
  };
}

/**
 * Zooms the camera while keeping the world point directly under the cursor stationary.
 *
 * Why:
 * Zooming around the cursor anchor feels natural (like Figma/Google Maps),
 * instead of zooming toward the top-left (0,0) corner.
 */
export function zoomAtScreenPoint(
  camera: Camera,
  screenAnchor: Point,
  nextZoom: number,
  minZoom = 0.05,
  maxZoom = 32
): Camera {
  const clampedZoom = Math.max(minZoom, Math.min(maxZoom, nextZoom));
  const worldAnchor = screenToWorld(screenAnchor, camera);

  return {
    zoom: clampedZoom,
    x: screenAnchor.x - worldAnchor.x * clampedZoom,
    y: screenAnchor.y - worldAnchor.y * clampedZoom
  };
}

/**
 * Pans the camera by delta screen pixels.
 */
export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    x: camera.x + dx,
    y: camera.y + dy
  };
}

export interface ViewportBounds {
  width: number;
  height: number;
  leftPadding?: number;
  rightPadding?: number;
  topPadding?: number;
  bottomPadding?: number;
}

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Calculates a Camera that fits content bounds within a viewport, respecting panel paddings.
 */
export function calculateFitCamera(
  content: ContentBounds,
  viewport: ViewportBounds,
  maxZoom = 1.0,
  minZoom = 0.05
): Camera {
  const contentW = Math.max(1, content.width);
  const contentH = Math.max(1, content.height);
  const contentCenterX = content.x + contentW / 2;
  const contentCenterY = content.y + contentH / 2;

  const leftPad = viewport.leftPadding ?? 420;
  const rightPad = viewport.rightPadding ?? 60;
  const topPad = viewport.topPadding ?? 70;
  const bottomPad = viewport.bottomPadding ?? 60;

  const availW = Math.max(80, viewport.width - leftPad - rightPad);
  const availH = Math.max(80, viewport.height - topPad - bottomPad);

  const scaleX = availW / contentW;
  const scaleY = availH / contentH;
  const targetZoom = Math.max(minZoom, Math.min(maxZoom, Math.min(scaleX, scaleY)));

  const viewCenterX = leftPad + availW / 2;
  const viewCenterY = topPad + availH / 2;

  return {
    zoom: targetZoom,
    x: viewCenterX - contentCenterX * targetZoom,
    y: viewCenterY - contentCenterY * targetZoom
  };
}

