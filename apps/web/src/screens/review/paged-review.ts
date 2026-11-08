import type { ReviewObject } from "@parfocal/api-client";
import type { CellRect, PagedCells, UnsureCell } from "../../viewer/viewer-engine.ts";
import type { CellShape } from "./slide-geometry.ts";

export const WORKING_SET = 1200;
export const FIELD_WIDTH = 1600;
export const FIELD_HEIGHT = 1000;
export const WINDOW_WIDTH = 1800;
export const WINDOW_HEIGHT = 1100;
export const MIN_PAGED_CELLS = 1000;

export type Point = { x: number; y: number };

export type Extent = readonly [number, number, number, number];

export type PagedProbe = {
  ready: boolean;
  cells: number;
  paged: boolean;
  resident: number;
  drawn: number;
  distinctAlphas: number;
  workingSet: number;
  indexed: number;
  fields: number;
};

export const idleProbe: PagedProbe = {
  ready: false,
  cells: 0,
  paged: false,
  resident: 0,
  drawn: 0,
  distinctAlphas: 0,
  workingSet: 0,
  indexed: 0,
  fields: 0,
};

export function pagedCountFrom(search: string): number | null {
  const raw = new URLSearchParams(search).get("pagedCells");
  const count = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(count) && count >= MIN_PAGED_CELLS ? count : null;
}

export const cellObjectId = (number: number) => `C${number}`;

export function circlePath(x: number, y: number, radius: number): string {
  const left = (x - radius).toFixed(1);
  const right = (x + radius).toFixed(1);
  const centre = y.toFixed(1);
  const r = radius.toFixed(1);
  return `M${left},${centre}A${r},${r} 0 1,0 ${right},${centre}A${r},${r} 0 1,0 ${left},${centre}Z`;
}

export function ringPath(ring: Float32Array): string {
  let path = "";
  for (let at = 0; at < ring.length; at += 2) {
    path += `${at === 0 ? "M" : "L"}${(ring[at] ?? 0).toFixed(1)},${(ring[at + 1] ?? 0).toFixed(1)}`;
  }
  return `${path}Z`;
}

export function centreOf(ring: Float32Array): Point {
  let x = 0;
  let y = 0;
  const points = ring.length / 2;
  for (let at = 0; at < ring.length; at += 2) {
    x += ring[at] ?? 0;
    y += ring[at + 1] ?? 0;
  }
  return { x: x / points, y: y / points };
}

export function slideExtent(summary: { x: Float32Array; y: Float32Array; count: number }): Extent {
  let right = 0;
  let bottom = 0;
  for (let row = 0; row < summary.count; row++) {
    right = Math.max(right, summary.x[row] ?? 0);
    bottom = Math.max(bottom, summary.y[row] ?? 0);
  }
  return [0, 0, right, bottom];
}

export function fieldAround(centre: Point, width: number, height: number): CellRect {
  return [centre.x - width / 2, centre.y - height / 2, centre.x + width / 2, centre.y + height / 2];
}

export function reviewObjectOf(cell: UnsureCell, classNames: readonly string[]): ReviewObject {
  const confidence = cell.confidence;
  const runnerUp = confidence?.shares.findIndex(
    (share, at) => at !== confidence.topClass && share === confidence.second,
  );
  return {
    object: cellObjectId(cell.number),
    kind: "cell",
    number: cell.number,
    class_name: classNames[cell.classIndex] ?? "Other",
    score: confidence?.top ?? 0,
    size_mm: null,
    other_class: classNames[runnerUp ?? -1] ?? null,
  };
}

export function placeholderShapes(
  cells: readonly UnsureCell[],
  paged: PagedCells,
): Record<string, CellShape> {
  const shapes: Record<string, CellShape> = {};
  for (const cell of cells) {
    const radius = Math.max(2, (paged.summary.diagonal[cell.row] ?? 8) / 2.83);
    shapes[cellObjectId(cell.number)] = {
      x: cell.x,
      y: cell.y,
      path: circlePath(cell.x, cell.y, radius),
    };
  }
  return shapes;
}

export type ConfidenceOf = (
  probs: Uint8Array | null,
  row: number,
  classes: number,
  temperature: number,
) => { top: number } | null;

export type WindowShapes = {
  shapes: Record<string, CellShape>;
  tops: Map<string, number>;
  drawn: number;
};

export function windowShapes(
  paged: PagedCells,
  confidenceOf: ConfidenceOf,
  view: CellRect,
  base: Readonly<Record<string, CellShape>>,
  baseTops: ReadonlyMap<string, number>,
): WindowShapes {
  const shapes: Record<string, CellShape> = { ...base };
  const tops = new Map(baseTops);
  let drawn = 0;
  paged.forEachLive((chunk, local) => {
    const ring = chunk.points.subarray(
      (chunk.offsets[local] ?? 0) * 2,
      (chunk.offsets[local + 1] ?? 0) * 2,
    );
    const centre = centreOf(ring);
    if (centre.x < view[0] || centre.x >= view[2] || centre.y < view[1] || centre.y >= view[3]) {
      return;
    }
    const id = cellObjectId(chunk.number[local] ?? 0);
    shapes[id] = { x: centre.x, y: centre.y, path: ringPath(ring) };
    const confidence = confidenceOf(chunk.probs, local, paged.summary.classes, paged.temperature);
    if (confidence !== null) tops.set(id, confidence.top);
    drawn += 1;
  });
  return { shapes, tops, drawn };
}

export function distinctAlphas(
  tops: ReadonlyMap<string, number>,
  fadeAlpha: (top: number) => number,
): number {
  const alphas = new Set<number>();
  for (const top of tops.values()) alphas.add(Math.round(255 * fadeAlpha(top)));
  return alphas.size;
}
