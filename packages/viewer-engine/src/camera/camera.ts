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

export interface SlideArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface CameraBounds extends ZoomLimits {
  readonly extent?: SlideExtent | null;
}

export interface CameraBoundsInput {
  readonly slide: SlideExtent | null;
  readonly viewport: Viewport | null;
  readonly devicePixelRatio: number;
  readonly cap?: ZoomLimits | undefined;
}

export const defaultZoomLimits: ZoomLimits = { minZoom: -12, maxZoom: 4 };

export const zoomOutShareOfFit = 0.5;

export const maxDevicePixelsPerSlidePixel = 16;

export const originCamera: Camera = { x: 0, y: 0, zoom: 0 };

export function screenScale(camera: Camera): number {
  return 2 ** camera.zoom;
}

export function clampZoom(zoom: number, limits: ZoomLimits): number {
  return Math.min(limits.maxZoom, Math.max(limits.minZoom, zoom));
}

function within(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function clampCamera(camera: Camera, bounds: CameraBounds): Camera {
  const zoom = clampZoom(camera.zoom, bounds);
  const extent = bounds.extent;
  const x = extent ? within(camera.x, 0, extent.width) : camera.x;
  const y = extent ? within(camera.y, 0, extent.height) : camera.y;
  return zoom === camera.zoom && x === camera.x && y === camera.y ? camera : { x, y, zoom };
}

function hasArea(size: SlideExtent | Viewport | null): size is SlideExtent {
  return size !== null && size.width > 0 && size.height > 0;
}

export function cameraBounds({
  slide,
  viewport,
  devicePixelRatio,
  cap,
}: CameraBoundsInput): CameraBounds {
  if (!slide) return cap ?? defaultZoomLimits;
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const maxZoom = Math.min(
    cap?.maxZoom ?? Number.POSITIVE_INFINITY,
    Math.log2(maxDevicePixelsPerSlidePixel / ratio),
  );
  const fitted =
    hasArea(viewport) && hasArea(slide)
      ? Math.log2(Math.min(viewport.width / slide.width, viewport.height / slide.height))
      : null;
  const slideMin =
    fitted === null
      ? (cap?.minZoom ?? defaultZoomLimits.minZoom)
      : fitted + Math.log2(zoomOutShareOfFit);
  const minZoom = Math.min(maxZoom, cap ? Math.max(cap.minZoom, slideMin) : slideMin);
  return {
    minZoom,
    maxZoom,
    extent: { width: Math.max(0, slide.width), height: Math.max(0, slide.height) },
  };
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

export function fitCamera(slide: SlideExtent, viewport: Viewport, limits: CameraBounds): Camera {
  return areaCamera({ x: 0, y: 0, width: slide.width, height: slide.height }, viewport, limits);
}

export function areaCamera(area: SlideArea, viewport: Viewport, limits: CameraBounds): Camera {
  const centre = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  if (viewport.width <= 0 || viewport.height <= 0 || area.width <= 0 || area.height <= 0) {
    return clampCamera({ ...centre, zoom: limits.minZoom }, limits);
  }
  const scale = Math.min(viewport.width / area.width, viewport.height / area.height);
  return clampCamera({ ...centre, zoom: Math.log2(scale) }, limits);
}
