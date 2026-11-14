import type { LinkedView, ViewOffset } from "@parfocal/viewer-engine";

export type SlidePoint = { x: number; y: number };
export type ScreenPoint = { x: number; y: number };
export type PaneBox = { width: number; height: number };

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function screenOfPoint(
  view: LinkedView,
  box: PaneBox,
  point: SlidePoint,
  flip = false,
): ScreenPoint {
  const scale = 2 ** view.zoom;
  const dx = (point.x - view.x) * scale;
  const dy = (point.y - view.y) * scale;
  const turn = radians(view.rotation);
  const x = dx * Math.cos(turn) - dy * Math.sin(turn) + box.width / 2;
  const y = dx * Math.sin(turn) + dy * Math.cos(turn) + box.height / 2;
  return { x: flip ? box.width - x : x, y };
}

export function pointOfScreen(
  view: LinkedView,
  box: PaneBox,
  screen: ScreenPoint,
  flip = false,
): SlidePoint {
  const scale = 2 ** view.zoom;
  const dx = (flip ? box.width - screen.x : screen.x) - box.width / 2;
  const dy = screen.y - box.height / 2;
  const turn = -radians(view.rotation);
  return {
    x: view.x + (dx * Math.cos(turn) - dy * Math.sin(turn)) / scale,
    y: view.y + (dx * Math.sin(turn) + dy * Math.cos(turn)) / scale,
  };
}

export function pointOnPane<Side extends string>(
  point: SlidePoint,
  home: Side | undefined,
  side: Side,
  offsets: Readonly<Record<Side, ViewOffset>>,
): SlidePoint | null {
  if (home === undefined) return null;
  return home === side ? point : carryPoint(point, offsets[home], offsets[side]);
}

export function pointOnHome<Side extends string>(
  point: SlidePoint,
  side: Side,
  home: Side,
  offsets: Readonly<Record<Side, ViewOffset>>,
): SlidePoint {
  return home === side ? point : carryPoint(point, offsets[side], offsets[home]);
}

export function carryPoint(point: SlidePoint, from: ViewOffset, to: ViewOffset): SlidePoint {
  return { x: point.x + to.x - from.x, y: point.y + to.y - from.y };
}
