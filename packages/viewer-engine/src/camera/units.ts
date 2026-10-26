import {
  type Camera,
  type ScreenRect,
  type SlidePoint,
  screenScale,
  screenToSlide,
  slideToScreen,
  type Viewport,
} from "./camera.ts";
import {
  magnificationAtZoom,
  nearestObjectivePreset,
  type ObjectivePreset,
} from "./magnification.ts";

export type MicronsPerPixel = number | null | undefined;

export const digitalLabel = "digital";

export const scanObjectiveRatioLimit = 1.25;

export const digitalTolerance = 1e-6;

export const niceScaleBarMicrons: readonly number[] = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

export interface MagnificationReadout {
  readonly magnification: number | null;
  readonly scanObjective: number | null;
  readonly nearestPreset: ObjectivePreset | null;
  readonly digital: boolean;
}

export interface ScaleBar {
  readonly microns: number;
  readonly widthPx: number;
  readonly label: string;
}

export interface ScaleBarInput {
  readonly zoom: number;
  readonly micronsPerPixel: MicronsPerPixel;
  readonly maxWidthPx: number;
  readonly choices?: readonly number[];
}

export function knownSpacing(micronsPerPixel: MicronsPerPixel): number | null {
  return typeof micronsPerPixel === "number" &&
    Number.isFinite(micronsPerPixel) &&
    micronsPerPixel > 0
    ? micronsPerPixel
    : null;
}

export function slideLengthToMicrons(
  pixels: number,
  micronsPerPixel: MicronsPerPixel,
): number | null {
  const spacing = knownSpacing(micronsPerPixel);
  return spacing === null ? null : pixels * spacing;
}

export function micronsToSlideLength(
  microns: number,
  micronsPerPixel: MicronsPerPixel,
): number | null {
  const spacing = knownSpacing(micronsPerPixel);
  return spacing === null ? null : microns / spacing;
}

export function slidePointToMicrons(
  point: SlidePoint,
  micronsPerPixel: MicronsPerPixel,
): SlidePoint | null {
  const spacing = knownSpacing(micronsPerPixel);
  return spacing === null ? null : { x: point.x * spacing, y: point.y * spacing };
}

export function micronsToSlidePoint(
  microns: SlidePoint,
  micronsPerPixel: MicronsPerPixel,
): SlidePoint | null {
  const spacing = knownSpacing(micronsPerPixel);
  return spacing === null ? null : { x: microns.x / spacing, y: microns.y / spacing };
}

export function screenToMicrons(
  camera: Camera,
  rect: ScreenRect,
  clientX: number,
  clientY: number,
  micronsPerPixel: MicronsPerPixel,
): SlidePoint | null {
  return slidePointToMicrons(screenToSlide(camera, rect, clientX, clientY), micronsPerPixel);
}

export function micronsToScreen(
  camera: Camera,
  rect: ScreenRect,
  microns: SlidePoint,
  micronsPerPixel: MicronsPerPixel,
): SlidePoint | null {
  const point = micronsToSlidePoint(microns, micronsPerPixel);
  return point === null ? null : slideToScreen(camera, rect, point);
}

export function micronsPerScreenPixel(
  zoom: number,
  micronsPerPixel: MicronsPerPixel,
): number | null {
  const spacing = knownSpacing(micronsPerPixel);
  return spacing === null ? null : spacing / screenScale({ x: 0, y: 0, zoom });
}

export function micronsPerDevicePixel(
  zoom: number,
  micronsPerPixel: MicronsPerPixel,
  devicePixelRatio: number,
): number | null {
  const perScreenPixel = micronsPerScreenPixel(zoom, micronsPerPixel);
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return perScreenPixel === null ? null : perScreenPixel / ratio;
}

export function devicePixelsPerSlidePixel(zoom: number, devicePixelRatio: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return screenScale({ x: 0, y: 0, zoom }) * ratio;
}

export function viewWidthMicrons(
  viewport: Viewport,
  zoom: number,
  micronsPerPixel: MicronsPerPixel,
): number | null {
  const perPixel = micronsPerScreenPixel(zoom, micronsPerPixel);
  return perPixel === null ? null : viewport.width * perPixel;
}

export function effectiveMagnification(
  zoom: number,
  micronsPerPixel: MicronsPerPixel,
): number | null {
  const spacing = knownSpacing(micronsPerPixel);
  return spacing === null ? null : magnificationAtZoom(spacing, zoom);
}

export function scanObjective(
  micronsPerPixel: MicronsPerPixel,
  declaredObjective?: number | null,
): number | null {
  if (typeof declaredObjective === "number" && declaredObjective > 0) {
    return Number.isFinite(declaredObjective) ? declaredObjective : null;
  }
  const native = effectiveMagnification(0, micronsPerPixel);
  if (native === null) return null;
  const preset = nearestObjectivePreset(native);
  const ratio = Math.max(preset / native, native / preset);
  return ratio <= scanObjectiveRatioLimit ? preset : null;
}

export function isDigital(magnification: number | null, objective: number | null): boolean {
  if (magnification === null || objective === null) return false;
  return magnification > objective * (1 + digitalTolerance);
}

export function magnificationReadout(
  zoom: number,
  micronsPerPixel: MicronsPerPixel,
  declaredObjective?: number | null,
): MagnificationReadout {
  const magnification = effectiveMagnification(zoom, micronsPerPixel);
  const objective = scanObjective(micronsPerPixel, declaredObjective);
  return {
    magnification,
    scanObjective: objective,
    nearestPreset: magnification === null ? null : nearestObjectivePreset(magnification),
    digital: isDigital(magnification, objective),
  };
}

export function formatLength(microns: number): string {
  if (microns >= 1000) return `${Number((microns / 1000).toPrecision(6))} mm`;
  return `${Number(microns.toPrecision(6))} µm`;
}

export function scaleBar({
  zoom,
  micronsPerPixel,
  maxWidthPx,
  choices = niceScaleBarMicrons,
}: ScaleBarInput): ScaleBar | null {
  const spacing = knownSpacing(micronsPerPixel);
  if (spacing === null || !(maxWidthPx > 0) || choices.length === 0) return null;
  const pixelsPerMicron = screenScale({ x: 0, y: 0, zoom }) / spacing;
  const fitting = choices.filter((microns) => microns * pixelsPerMicron <= maxWidthPx);
  const microns = fitting.length > 0 ? Math.max(...fitting) : Math.min(...choices);
  return { microns, widthPx: microns * pixelsPerMicron, label: formatLength(microns) };
}
