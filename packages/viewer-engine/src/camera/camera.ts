export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface ZoomLimits {
  readonly minZoom: number;
  readonly maxZoom: number;
}

export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SlideExtent {
  readonly width: number;
  readonly height: number;
}

export interface SlidePoint {
  readonly x: number;
  readonly y: number;
}

export const defaultZoomLimits: ZoomLimits = { minZoom: -12, maxZoom: 4 };

export const originCamera: Camera = { x: 0, y: 0, zoom: 0 };

export function screenScale(camera: Camera): number {
  return 2 ** camera.zoom;
}

export function clampCamera(camera: Camera, limits: ZoomLimits): Camera {
  const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, camera.zoom));
  return zoom === camera.zoom ? camera : { ...camera, zoom };
}

export function sameCamera(a: Camera, b: Camera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

export function screenToSlide(
  camera: Camera,
  rect: ScreenRect,
  clientX: number,
  clientY: number,
): SlidePoint {
  const scale = screenScale(camera);
  return {
    x: camera.x + (clientX - rect.left - rect.width / 2) / scale,
    y: camera.y + (clientY - rect.top - rect.height / 2) / scale,
  };
}

export function slideToScreen(camera: Camera, rect: ScreenRect, point: SlidePoint): SlidePoint {
  const scale = screenScale(camera);
  return {
    x: rect.left + rect.width / 2 + (point.x - camera.x) * scale,
    y: rect.top + rect.height / 2 + (point.y - camera.y) * scale,
  };
}

export function fitCamera(
  slide: SlideExtent,
  viewport: Pick<ScreenRect, "width" | "height">,
  limits: ZoomLimits,
): Camera {
  const centre = { x: slide.width / 2, y: slide.height / 2 };
  if (viewport.width <= 0 || viewport.height <= 0 || slide.width <= 0 || slide.height <= 0) {
    return clampCamera({ ...centre, zoom: limits.minZoom }, limits);
  }
  const scale = Math.min(viewport.width / slide.width, viewport.height / slide.height);
  return clampCamera({ ...centre, zoom: Math.log2(scale) }, limits);
}
