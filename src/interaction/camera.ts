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
