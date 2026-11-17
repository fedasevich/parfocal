import type { PointBatch } from "../overlay/batch-types.ts";
import {
  buildCullGrid,
  type CellRect,
  type CullGrid,
  cullWindow,
  polygonSubset,
  rowRanges,
  triangleStarts,
  type ViewRect,
} from "../overlay/cull-grid.ts";
import {
  chooseLod,
  densityRaster,
  fullDetail,
  type LodChoice,
  type LodStats,
  lodLargeFactor,
  lodStats,
  smallShapeCentres,
  smallShapeIds,
} from "../overlay/lod.ts";
import type { RasterData, ShapeData } from "../overlay/types.ts";
import type { InstanceRanges, SetCounts } from "./protocol.ts";
import {
  type ShapeInstanceStarts,
  shapeInstanceStarts,
  type VectorInstanceOptions,
} from "./vector-instances.ts";

export interface CulledShapes {
  readonly stats: LodStats;
  readonly grid: CullGrid;
  readonly shapes: ShapeData;
  readonly smallCount: number;
  readonly centres: PointBatch;
  readonly density: RasterData | null;
}

export interface CulledSet extends CulledShapes {
  readonly starts: ShapeInstanceStarts;
  readonly counts: SetCounts;
  cells: CellRect | null | undefined;
}

export interface CulledDraw {
  readonly choice: LodChoice;
  readonly ranges: InstanceRanges;
  readonly dots: readonly number[] | null;
}

export function cullShapes(shapes: ShapeData): CulledShapes | null {
  const { polygons } = shapes;
  if (!polygons || polygons.count === 0) return null;
  const stats = lodStats(polygons);
  if (!stats.engaged) return null;
  const smallIds = smallShapeIds(polygons.count, stats);
  const unordered = smallShapeCentres(polygons, stats);
  const grid = buildCullGrid(unordered, stats.nucleusSize, stats.nucleusSize * lodLargeFactor);
  const ordered = new Uint32Array(polygons.count);
  const positions = new Float32Array(stats.smallCount * 2);
  const colors = new Uint8Array(stats.smallCount * 4);
  grid.order.forEach((small, at) => {
    ordered[at] = smallIds[small] ?? 0;
    positions[at * 2] = unordered.positions[small * 2] ?? 0;
    positions[at * 2 + 1] = unordered.positions[small * 2 + 1] ?? 0;
    colors.set(unordered.colors.subarray(small * 4, small * 4 + 4), at * 4);
  });
  ordered.set(stats.large, stats.smallCount);
  return {
    stats,
    grid,
    shapes: {
      ...shapes,
      polygons: polygonSubset(polygons, triangleStarts(polygons), ordered),
    },
    smallCount: stats.smallCount,
    centres: { count: stats.smallCount, positions, colors },
    density: densityRaster(unordered, stats.nucleusSize),
  };
}

export function culledSet(
  shapes: CulledShapes,
  counts: SetCounts,
  options: VectorInstanceOptions = {},
): CulledSet {
  const polygons = shapes.shapes.polygons;
  if (!polygons) throw new Error("A culled set needs polygons");
  return { ...shapes, starts: shapeInstanceStarts(polygons, options), counts, cells: undefined };
}

function push(ranges: number[], from: number, to: number): void {
  if (to <= from) return;
  const last = ranges.length - 1;
  if (last > 0 && ranges[last] === from) ranges[last] = to;
  else ranges.push(from, to);
}

function kindRanges(
  shapeRanges: readonly number[],
  starts: Uint32Array,
  smallCount: number,
  total: number,
): number[] {
  const ranges: number[] = [];
  for (let at = 0; at < shapeRanges.length; at += 2) {
    push(ranges, starts[shapeRanges[at] ?? 0] ?? 0, starts[shapeRanges[at + 1] ?? 0] ?? 0);
  }
  push(ranges, starts[smallCount] ?? 0, total);
  return ranges;
}

function windowCells(set: CulledSet, view: ViewRect | undefined): CellRect | null | undefined {
  if (view === undefined) return undefined;
  set.cells = cullWindow(set.grid, view, set.cells);
  return set.cells;
}

export function culledDraw(
  set: CulledSet,
  pixelsPerUnit: number,
  view: ViewRect | undefined,
): CulledDraw {
  const choice = Number.isFinite(pixelsPerUnit) ? chooseLod(set.stats, pixelsPerUnit) : fullDetail;
  const near = choice.tier === "density" ? undefined : windowCells(set, view);
  const visible = (): number[] =>
    near === undefined ? [0, set.smallCount] : rowRanges(set.grid, near);
  const shapeRanges = choice.tier === "outlines" ? visible() : [];
  const { starts, counts, smallCount } = set;
  return {
    choice,
    ranges: {
      triangles: kindRanges(shapeRanges, starts.triangles, smallCount, counts.triangles),
      segments: kindRanges(shapeRanges, starts.segments, smallCount, counts.segments),
      repeats: kindRanges(shapeRanges, starts.repeats, smallCount, counts.repeats ?? 0),
    },
    dots: choice.tier === "dots" ? visible() : null,
  };
}
