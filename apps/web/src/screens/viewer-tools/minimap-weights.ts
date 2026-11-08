import type { HotSpot, ScreenRect } from "./minimap-placement.ts";

export const hotWeight = {
  tumorEdge: 3,
  cellToCheck: 4,
  proposal: 5,
  pin: 20,
  currentCell: 50,
  measurementSample: 200,
} as const;

export const measurementSamples = 11;

export type ScreenPoint = [number, number];

export function weighted(points: ScreenPoint[], weight: number): HotSpot[] {
  return points.map(([x, y]) => [x, y, weight]);
}

export function measurementSpots(from: ScreenPoint, to: ScreenPoint): HotSpot[] {
  const spots: HotSpot[] = [];
  for (let step = 0; step < measurementSamples; step += 1) {
    const at = step / (measurementSamples - 1);
    spots.push([
      from[0] + (to[0] - from[0]) * at,
      from[1] + (to[1] - from[1]) * at,
      hotWeight.measurementSample,
    ]);
  }
  return spots;
}

export function chromeBlocks(chrome: {
  openThread?: ScreenRect | null;
  cellsPanel?: ScreenRect | null;
  cellCard?: ScreenRect | null;
  legend?: ScreenRect | null;
}): ScreenRect[] {
  return [chrome.openThread, chrome.cellsPanel, chrome.cellCard, chrome.legend].filter(
    (rect): rect is ScreenRect => Boolean(rect),
  );
}

export function heldPlacement<T>(shown: T | null, next: T, panning: boolean): T {
  return panning && shown ? shown : next;
}
