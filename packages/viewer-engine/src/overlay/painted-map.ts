import type { SlideArea } from "../camera/camera.ts";
import {
  createViewMap,
  type ViewMap,
  type ViewMapLayout,
  type ViewMapTile,
  type ViewMapTileKey,
  viewMapLayout,
  viewMapTileId,
  viewMapTileSize,
  viewMapTilesIn,
  withViewMapTile,
} from "./view-map.ts";

export const paintedMapMagic = "PFPM";
export const paintedMapFormat = 1;
export const paintedMapHeaderBytes = 24;
export const paintedMapTileHeaderBytes = 4;
export const paintedMapFullValue = 255;

export type PaintedMapMode = "paint" | "erase";

export interface PaintedMapStroke {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly diameter: number;
  readonly mode: PaintedMapMode;
  readonly value?: number;
}

export class PaintedMapFormatError extends Error {
  override readonly name = "PaintedMapFormatError";
}

const strokeValue = (stroke: PaintedMapStroke): number => {
  if (stroke.mode === "erase") return 0;
  const value = stroke.value ?? paintedMapFullValue;
  if (!Number.isInteger(value) || value < 1 || value > paintedMapFullValue) {
    throw new RangeError("A painted value is a whole number from 1 to 255");
  }
  return value;
};

const distanceToSegment = (
  px: number,
  py: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
};

const strokeBounds = (stroke: PaintedMapStroke, radius: number): SlideArea => {
  const xs = stroke.points.map((point) => point.x);
  const ys = stroke.points.map((point) => point.y);
  const left = Math.min(...xs) - radius;
  const top = Math.min(...ys) - radius;
  return {
    x: left,
    y: top,
    width: Math.max(...xs) + radius - left,
    height: Math.max(...ys) + radius - top,
  };
};

const touches = (stroke: PaintedMapStroke, radius: number, cx: number, cy: number): boolean => {
  const { points } = stroke;
  if (points.length === 1) {
    const only = points[0];
    return only !== undefined && Math.hypot(cx - only.x, cy - only.y) <= radius;
  }
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    if (a !== undefined && b !== undefined && distanceToSegment(cx, cy, a, b) <= radius) {
      return true;
    }
  }
  return false;
};

const cellOf = (layout: ViewMapLayout, point: { x: number; y: number }) => ({
  column: Math.floor(point.x / layout.cell),
  row: Math.floor(point.y / layout.cell),
});

export function paintViewMap(map: ViewMap, stroke: PaintedMapStroke): ViewMap {
  if (stroke.points.length === 0) return map;
  if (!(stroke.diameter > 0)) throw new RangeError("A brush has a positive diameter");
  const value = strokeValue(stroke);
  const { layout } = map;
  const radius = stroke.diameter / 2;
  const under = new Set(
    stroke.points.map((point) => {
      const cell = cellOf(layout, point);
      return `${cell.column},${cell.row}`;
    }),
  );
  let current = map;
  for (const key of viewMapTilesIn(layout, strokeBounds(stroke, radius))) {
    const existing = current.tiles.get(viewMapTileId(key));
    if (existing === undefined && value === 0) continue;
    const { width, height } = viewMapTileSize(layout, key);
    const values =
      existing === undefined ? new Uint8Array(width * height) : existing.values.slice();
    let changed = false;
    for (let y = 0; y < height; y++) {
      const row = key.row * layout.tileCells + y;
      for (let x = 0; x < width; x++) {
        const column = key.column * layout.tileCells + x;
        const cx = (column + 0.5) * layout.cell;
        const cy = (row + 0.5) * layout.cell;
        if (!under.has(`${column},${row}`) && !touches(stroke, radius, cx, cy)) continue;
        const index = y * width + x;
        if (values[index] === value) continue;
        values[index] = value;
        changed = true;
      }
    }
    if (!changed) continue;
    current = values.some((cell) => cell !== 0)
      ? withViewMapTile(current, { key, width, height, values })
      : withoutTile(current, key);
  }
  return current;
}

const withoutTile = (map: ViewMap, key: ViewMapTileKey): ViewMap => {
  const tiles = new Map(map.tiles);
  tiles.delete(viewMapTileId(key));
  return { layout: map.layout, tiles };
};

export function paintedCellCount(map: ViewMap): number {
  let count = 0;
  for (const tile of map.tiles.values()) {
    for (const cell of tile.values) if (cell !== 0) count++;
  }
  return count;
}

const orderedTiles = (map: ViewMap): ViewMapTile[] =>
  [...map.tiles.values()]
    .filter((tile) => tile.values.some((cell) => cell !== 0))
    .sort((a, b) => a.key.row - b.key.row || a.key.column - b.key.column);

export function encodePaintedMap(map: ViewMap): Uint8Array {
  const { layout } = map;
  if (layout.tileColumns > 0xffff || layout.tileRows > 0xffff || layout.tileCells > 0xffff) {
    throw new RangeError("A painted map has at most 65535 tiles a side");
  }
  const tiles = orderedTiles(map);
  const body = tiles.reduce((sum, tile) => sum + paintedMapTileHeaderBytes + tile.values.length, 0);
  const bytes = new Uint8Array(paintedMapHeaderBytes + body);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < paintedMapMagic.length; index++) {
    bytes[index] = paintedMapMagic.charCodeAt(index);
  }
  view.setUint16(4, paintedMapFormat, true);
  view.setUint16(6, layout.tileCells, true);
  view.setUint32(8, layout.cell, true);
  view.setUint32(12, layout.slide.width, true);
  view.setUint32(16, layout.slide.height, true);
  view.setUint32(20, tiles.length, true);
  let offset = paintedMapHeaderBytes;
  for (const tile of tiles) {
    view.setUint16(offset, tile.key.column, true);
    view.setUint16(offset + 2, tile.key.row, true);
    bytes.set(tile.values, offset + paintedMapTileHeaderBytes);
    offset += paintedMapTileHeaderBytes + tile.values.length;
  }
  return bytes;
}

export function decodePaintedMap(bytes: Uint8Array): ViewMap {
  if (bytes.length < paintedMapHeaderBytes) {
    throw new PaintedMapFormatError("A painted map file is too short");
  }
  const magic = String.fromCharCode(...bytes.subarray(0, paintedMapMagic.length));
  if (magic !== paintedMapMagic) throw new PaintedMapFormatError("This is not a painted map file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== paintedMapFormat) {
    throw new PaintedMapFormatError("This painted map file has a format this app cannot read");
  }
  const tileCells = view.getUint16(6, true);
  const cell = view.getUint32(8, true);
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  const count = view.getUint32(20, true);
  if (tileCells === 0 || cell === 0 || width === 0 || height === 0) {
    throw new PaintedMapFormatError("A painted map file needs a slide size and a cell size");
  }
  let map = createViewMap(viewMapLayout({ width, height }, cell, tileCells));
  let offset = paintedMapHeaderBytes;
  let previous = -1;
  for (let index = 0; index < count; index++) {
    if (offset + paintedMapTileHeaderBytes > bytes.length) {
      throw new PaintedMapFormatError("A painted map file ends inside a tile");
    }
    const key = { column: view.getUint16(offset, true), row: view.getUint16(offset + 2, true) };
    if (key.column >= map.layout.tileColumns || key.row >= map.layout.tileRows) {
      throw new PaintedMapFormatError("A painted map tile lies outside the slide");
    }
    const order = key.row * map.layout.tileColumns + key.column;
    if (order <= previous) throw new PaintedMapFormatError("Painted map tiles are out of order");
    previous = order;
    const { width: tileWidth, height: tileHeight } = viewMapTileSize(map.layout, key);
    const start = offset + paintedMapTileHeaderBytes;
    const end = start + tileWidth * tileHeight;
    if (end > bytes.length)
      throw new PaintedMapFormatError("A painted map file ends inside a tile");
    const values = bytes.slice(start, end);
    map = withViewMapTile(map, { key, width: tileWidth, height: tileHeight, values });
    offset = end;
  }
  if (offset !== bytes.length) {
    throw new PaintedMapFormatError("A painted map file has bytes after its last tile");
  }
  return map;
}
