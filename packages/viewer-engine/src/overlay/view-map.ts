import type { SlideArea, SlideExtent } from "../camera/camera.ts";
import type { HeatmapGrid } from "./types.ts";

export const viewMapCell = 256;
export const viewMapTileCells = 16;
export const viewMapMaxTilesPerAsk = 64;

export interface ViewMapLayout {
  readonly slide: SlideExtent;
  readonly cell: number;
  readonly tileCells: number;
  readonly columns: number;
  readonly rows: number;
  readonly tileColumns: number;
  readonly tileRows: number;
}

export interface ViewMapTileKey {
  readonly column: number;
  readonly row: number;
}

export interface ViewMapTile {
  readonly key: ViewMapTileKey;
  readonly width: number;
  readonly height: number;
  readonly values: Uint8Array;
}

export interface ViewMap {
  readonly layout: ViewMapLayout;
  readonly tiles: ReadonlyMap<string, ViewMapTile>;
}

export interface ViewMapTileRequest {
  readonly key: ViewMapTileKey;
  readonly area: SlideArea;
  readonly width: number;
  readonly height: number;
  readonly cell: number;
}

export type ViewMapScorer = (request: ViewMapTileRequest) => Promise<Uint8Array>;

export interface ViewMapPlan {
  readonly wanted: readonly ViewMapTileKey[];
  readonly missing: readonly ViewMapTileKey[];
  readonly tooWide: boolean;
}

export interface ViewMapAskOptions {
  readonly maxTiles?: number;
  readonly onTile?: (map: ViewMap) => void;
}

const positive = (value: number, name: string) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`A view map ${name} must be a positive whole number`);
  }
  return value;
};

export function viewMapLayout(
  slide: SlideExtent,
  cell: number = viewMapCell,
  tileCells: number = viewMapTileCells,
): ViewMapLayout {
  positive(cell, "cell");
  positive(tileCells, "tile");
  const columns = Math.max(1, Math.ceil(slide.width / cell));
  const rows = Math.max(1, Math.ceil(slide.height / cell));
  return {
    slide: { width: slide.width, height: slide.height },
    cell,
    tileCells,
    columns,
    rows,
    tileColumns: Math.ceil(columns / tileCells),
    tileRows: Math.ceil(rows / tileCells),
  };
}

export function createViewMap(layout: ViewMapLayout): ViewMap {
  return { layout, tiles: new Map() };
}

export const viewMapTileId = (key: ViewMapTileKey): string => `${key.column},${key.row}`;

export function viewMapTileSize(
  layout: ViewMapLayout,
  key: ViewMapTileKey,
): { width: number; height: number } {
  const left = key.column * layout.tileCells;
  const top = key.row * layout.tileCells;
  return {
    width: Math.min(layout.tileCells, layout.columns - left),
    height: Math.min(layout.tileCells, layout.rows - top),
  };
}

export function viewMapTileRequest(layout: ViewMapLayout, key: ViewMapTileKey): ViewMapTileRequest {
  const { width, height } = viewMapTileSize(layout, key);
  const span = layout.cell * layout.tileCells;
  return {
    key,
    width,
    height,
    cell: layout.cell,
    area: {
      x: key.column * span,
      y: key.row * span,
      width: width * layout.cell,
      height: height * layout.cell,
    },
  };
}

export function viewMapTilesIn(layout: ViewMapLayout, area: SlideArea): ViewMapTileKey[] {
  if (!(area.width > 0) || !(area.height > 0)) return [];
  const span = layout.cell * layout.tileCells;
  const left = Math.max(0, Math.floor(area.x / span));
  const top = Math.max(0, Math.floor(area.y / span));
  const right = Math.min(layout.tileColumns - 1, Math.ceil((area.x + area.width) / span) - 1);
  const bottom = Math.min(layout.tileRows - 1, Math.ceil((area.y + area.height) / span) - 1);
  const keys: ViewMapTileKey[] = [];
  for (let row = top; row <= bottom; row++) {
    for (let column = left; column <= right; column++) keys.push({ column, row });
  }
  return keys;
}

export function planViewMap(
  map: ViewMap,
  area: SlideArea,
  maxTiles: number = viewMapMaxTilesPerAsk,
): ViewMapPlan {
  const wanted = viewMapTilesIn(map.layout, area);
  const missing = wanted.filter((key) => !map.tiles.has(viewMapTileId(key)));
  return { wanted, missing, tooWide: missing.length > maxTiles };
}

export function withViewMapTile(map: ViewMap, tile: ViewMapTile): ViewMap {
  const { key } = tile;
  if (key.column < 0 || key.row < 0) throw new RangeError("A view map tile sits on the slide");
  if (key.column >= map.layout.tileColumns || key.row >= map.layout.tileRows) {
    throw new RangeError("A view map tile sits on the slide");
  }
  const size = viewMapTileSize(map.layout, key);
  if (tile.width !== size.width || tile.height !== size.height) {
    throw new RangeError("A view map tile has the size of its place on the slide");
  }
  if (tile.values.length !== tile.width * tile.height) {
    throw new RangeError("A view map tile needs one value for each cell");
  }
  const tiles = new Map(map.tiles);
  tiles.set(viewMapTileId(key), tile);
  return { layout: map.layout, tiles };
}

export function viewMapCoveredArea(map: ViewMap): SlideArea | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const tile of map.tiles.values()) {
    const { area } = viewMapTileRequest(map.layout, tile.key);
    left = Math.min(left, area.x);
    top = Math.min(top, area.y);
    right = Math.max(right, area.x + area.width);
    bottom = Math.max(bottom, area.y + area.height);
  }
  if (left === Number.POSITIVE_INFINITY) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function viewMapGrid(map: ViewMap): HeatmapGrid | null {
  const area = viewMapCoveredArea(map);
  if (area === null) return null;
  const { cell } = map.layout;
  const width = Math.round(area.width / cell);
  const height = Math.round(area.height / cell);
  const firstColumn = Math.round(area.x / cell);
  const firstRow = Math.round(area.y / cell);
  const values = new Float32Array(width * height).fill(Number.NaN);
  for (const tile of map.tiles.values()) {
    const { area: tileArea } = viewMapTileRequest(map.layout, tile.key);
    const column = Math.round(tileArea.x / cell) - firstColumn;
    const row = Math.round(tileArea.y / cell) - firstRow;
    for (let y = 0; y < tile.height; y++) {
      for (let x = 0; x < tile.width; x++) {
        values[(row + y) * width + column + x] = (tile.values[y * tile.width + x] ?? 0) / 255;
      }
    }
  }
  return { width, height, values, area };
}

export async function askViewMap(
  map: ViewMap,
  area: SlideArea,
  scorer: ViewMapScorer,
  options: ViewMapAskOptions = {},
): Promise<ViewMap> {
  const plan = planViewMap(map, area, options.maxTiles);
  if (plan.tooWide) throw new RangeError("This view is too wide to map, zoom in first");
  let current = map;
  await Promise.all(
    plan.missing.map(async (key) => {
      const request = viewMapTileRequest(map.layout, key);
      const values = await scorer(request);
      current = withViewMapTile(current, {
        key,
        width: request.width,
        height: request.height,
        values,
      });
      options.onTile?.(current);
    }),
  );
  return current;
}
