import type { CheckZone } from "./cells-to-check.ts";
import { BAND_CUTOFFS, CLOSE_GAP } from "./confidence-words.ts";

export type Point = readonly [number, number];

export type Extent = readonly [number, number, number, number];

export type ZoneCell = {
  id: string;
  x: number;
  y: number;
  unsure: boolean;
  topTypes: readonly [string, string];
  modelsDisagree?: boolean;
  mayNotBeCell?: boolean;
};

export type UnsureZoneSettings = {
  unsure_zone_square_px: number;
  unsure_zone_min_nuclei: number;
  unsure_zone_min_unsure_percent: number;
  unsure_zone_min_unsure_cells: number;
};

export const DEFAULT_UNSURE_ZONE_SETTINGS: UnsureZoneSettings = {
  unsure_zone_square_px: 128,
  unsure_zone_min_nuclei: 3,
  unsure_zone_min_unsure_percent: 30,
  unsure_zone_min_unsure_cells: 4,
};

export const SOFT_OUTLINE_PAD_PX = 46;

export const MODELS_DISAGREE = "Models disagree";

export const POSSIBLY_NOT_CELLS = "Possibly not cells";

export type UnsureZone = CheckZone & {
  name: string;
  outline: Point[];
};

export type UnsureZones = {
  zones: UnsureZone[];
  scatteredUnsureCellIds: string[];
};

export function isUnsureCall(top: number, second: number): boolean {
  return top < BAND_CUTOFFS.unsure || top - second < CLOSE_GAP;
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function zoneName(unsureCells: readonly ZoneCell[]): string {
  const asTop = new Map<string, number>();
  for (const cell of unsureCells) {
    asTop.set(cell.topTypes[0], (asTop.get(cell.topTypes[0]) ?? 0) + 1);
  }
  const moreCommonFirst = (a: string, b: string) =>
    (asTop.get(b) ?? 0) - (asTop.get(a) ?? 0) || a.localeCompare(b);
  const pairs = new Map<string, number>();
  for (const cell of unsureCells) {
    const [first, second] = [...cell.topTypes].sort(moreCommonFirst);
    const pair = `${capitalised(first ?? "")} or ${second ?? ""}`;
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  const dominates = (count: number) => count * 2 > unsureCells.length;
  if (dominates(unsureCells.filter((cell) => cell.mayNotBeCell).length)) return POSSIBLY_NOT_CELLS;
  if (dominates(unsureCells.filter((cell) => cell.modelsDisagree).length)) return MODELS_DISAGREE;
  return [...pairs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

const cross = (o: Point, a: Point, b: Point) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function halfHull(points: readonly Point[]): Point[] {
  const chain: Point[] = [];
  for (const point of points) {
    while (chain.length >= 2) {
      const [a, b] = chain.slice(-2) as [Point, Point];
      if (cross(a, b, point) > 0) break;
      chain.pop();
    }
    chain.push(point);
  }
  return chain.slice(0, -1);
}

function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  return [...halfHull(sorted), ...halfHull(sorted.toReversed())];
}

export function softOutline(points: readonly Point[], pad: number = SOFT_OUTLINE_PAD_PX): Point[] {
  const hull = convexHull(points);
  if (hull.length === 0) return [];
  const cx = hull.reduce((sum, point) => sum + point[0], 0) / hull.length;
  const cy = hull.reduce((sum, point) => sum + point[1], 0) / hull.length;
  return hull.map(([x, y]) => {
    const distance = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / distance) * pad, y + ((y - cy) / distance) * pad] as const;
  });
}

type Grid = {
  columns: number;
  rows: number;
  squareOf: (cell: ZoneCell) => number | null;
};

function gridOver(extent: Extent, size: number): Grid {
  const [minX, minY, maxX, maxY] = extent;
  const columns = Math.max(1, Math.ceil((maxX - minX) / size));
  const rows = Math.max(1, Math.ceil((maxY - minY) / size));
  const squareOf = (cell: ZoneCell) => {
    const column = Math.floor((cell.x - minX) / size);
    const row = Math.floor((cell.y - minY) / size);
    if (column < 0 || row < 0 || column >= columns || row >= rows) return null;
    return row * columns + column;
  };
  return { columns, rows, squareOf };
}

function joinedSquares(on: ReadonlySet<number>, grid: Grid): number[][] {
  const seen = new Set<number>();
  const groups: number[][] = [];
  for (const start of [...on].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start];
    const members: number[] = [];
    for (let square = stack.pop(); square !== undefined; square = stack.pop()) {
      members.push(square);
      const column = square % grid.columns;
      const row = Math.floor(square / grid.columns);
      const neighbours = [
        column > 0 ? square - 1 : null,
        column < grid.columns - 1 ? square + 1 : null,
        row > 0 ? square - grid.columns : null,
        row < grid.rows - 1 ? square + grid.columns : null,
      ];
      for (const next of neighbours) {
        if (next === null || seen.has(next) || !on.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    groups.push(members);
  }
  return groups;
}

export function unsureZonesFor(
  cells: readonly ZoneCell[],
  extent: Extent,
  settings: UnsureZoneSettings = DEFAULT_UNSURE_ZONE_SETTINGS,
): UnsureZones {
  const grid = gridOver(extent, settings.unsure_zone_square_px);
  const bySquare = new Map<number, ZoneCell[]>();
  for (const cell of cells) {
    const square = grid.squareOf(cell);
    if (square === null) continue;
    const members = bySquare.get(square);
    if (members) members.push(cell);
    else bySquare.set(square, [cell]);
  }
  const on = new Set<number>();
  for (const [square, members] of bySquare) {
    const unsure = members.filter((cell) => cell.unsure).length;
    if (
      members.length >= settings.unsure_zone_min_nuclei &&
      unsure * 100 >= settings.unsure_zone_min_unsure_percent * members.length
    ) {
      on.add(square);
    }
  }
  const kept = joinedSquares(on, grid)
    .map((squares) => {
      const zoneCells = squares.flatMap((square) => bySquare.get(square) ?? []);
      return {
        first: Math.min(...squares),
        zoneCells,
        unsureCells: zoneCells.filter((cell) => cell.unsure),
      };
    })
    .filter((zone) => zone.unsureCells.length >= settings.unsure_zone_min_unsure_cells)
    .sort(
      (a, b) =>
        b.unsureCells.length - a.unsureCells.length ||
        b.zoneCells.length - a.zoneCells.length ||
        a.first - b.first,
    );
  const inZones = new Set(kept.flatMap((zone) => zone.unsureCells.map((cell) => cell.id)));
  return {
    zones: kept.map((zone, index) => ({
      id: `zone-${index + 1}`,
      cellIds: zone.zoneCells.map((cell) => cell.id),
      unsureCellIds: zone.unsureCells.map((cell) => cell.id),
      name: zoneName(zone.unsureCells),
      outline: softOutline(zone.unsureCells.map((cell) => [cell.x, cell.y] as const)),
    })),
    scatteredUnsureCellIds: cells
      .filter((cell) => cell.unsure && !inZones.has(cell.id))
      .map((cell) => cell.id),
  };
}
