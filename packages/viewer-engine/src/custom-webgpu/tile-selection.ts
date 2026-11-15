import type { Camera } from "../camera/camera.ts";
import type { VirtualLevel } from "../viv/viv-levels.ts";
import { tileInstanceFloats } from "./protocol.ts";

export interface ViewSize {
  readonly width: number;
  readonly height: number;
}

export interface TileAddress {
  readonly level: number;
  readonly x: number;
  readonly y: number;
}

export const minAtlasLayers = 32;

export const atlasSpareLayers = 16;

export function tileKey(tile: TileAddress): string {
  return `${tile.level}/${tile.x}/${tile.y}`;
}

export function tileLevelFor(zoom: number, levelCount: number): number {
  if (levelCount < 1) return 0;
  const level = -Math.ceil(zoom);
  return Math.min(levelCount - 1, Math.max(0, level));
}

export function magnifiesFinestLevel(level: number, zoom: number, pixelRatio: number): boolean {
  return level === 0 && 2 ** zoom * pixelRatio >= 1;
}

export function visibleTiles(
  camera: Camera,
  view: ViewSize,
  ladder: readonly VirtualLevel[],
  tileSize: number,
): TileAddress[] {
  const level = tileLevelFor(camera.zoom, ladder.length);
  const virtual = ladder[level];
  if (virtual === undefined || view.width <= 0 || view.height <= 0) return [];
  const scale = 2 ** camera.zoom;
  const span = tileSize * virtual.downsample;
  const halfWidth = view.width / 2 / scale;
  const halfHeight = view.height / 2 / scale;
  const columns = Math.ceil(virtual.width / tileSize);
  const rows = Math.ceil(virtual.height / tileSize);
  const firstX = Math.max(0, Math.floor((camera.x - halfWidth) / span));
  const firstY = Math.max(0, Math.floor((camera.y - halfHeight) / span));
  const endX = Math.min(columns, Math.ceil((camera.x + halfWidth) / span));
  const endY = Math.min(rows, Math.ceil((camera.y + halfHeight) / span));
  const tiles: TileAddress[] = [];
  for (let y = firstY; y < endY; y++) {
    for (let x = firstX; x < endX; x++) tiles.push({ level, x, y });
  }
  const centreX = camera.x / span - 0.5;
  const centreY = camera.y / span - 0.5;
  const distance = (tile: TileAddress) => (tile.x - centreX) ** 2 + (tile.y - centreY) ** 2;
  return tiles.sort((a, b) => distance(a) - distance(b));
}

export function parentTile(tile: TileAddress, levelCount: number): TileAddress | null {
  if (tile.level + 1 >= levelCount) return null;
  return { level: tile.level + 1, x: tile.x >> 1, y: tile.y >> 1 };
}

export function atlasLayersFor(view: ViewSize, tileSize: number, maxLayers: number): number {
  const across = Math.ceil((2 * Math.max(1, view.width)) / tileSize) + 1;
  const down = Math.ceil((2 * Math.max(1, view.height)) / tileSize) + 1;
  const wanted = 2 * across * down + atlasSpareLayers;
  return Math.max(1, Math.min(maxLayers, Math.max(minAtlasLayers, wanted)));
}

export interface PlacedTile {
  readonly tile: TileAddress;
  readonly layer: number;
  readonly width: number;
  readonly height: number;
  readonly alpha: number;
}

export function tileInstances(
  camera: Camera,
  view: ViewSize,
  ladder: readonly VirtualLevel[],
  tileSize: number,
  placed: readonly PlacedTile[],
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(placed.length * tileInstanceFloats);
  const scale = 2 ** camera.zoom;
  const toClipX = (2 * scale) / view.width;
  const toClipY = (-2 * scale) / view.height;
  placed.forEach((entry, index) => {
    const downsample = ladder[entry.tile.level]?.downsample ?? 1;
    const left = entry.tile.x * tileSize * downsample;
    const top = entry.tile.y * tileSize * downsample;
    const at = index * tileInstanceFloats;
    out[at] = (left - camera.x) * toClipX;
    out[at + 1] = (top - camera.y) * toClipY;
    out[at + 2] = (left + entry.width * downsample - camera.x) * toClipX;
    out[at + 3] = (top + entry.height * downsample - camera.y) * toClipY;
    out[at + 4] = entry.width / tileSize;
    out[at + 5] = entry.height / tileSize;
    out[at + 6] = entry.layer;
    out[at + 7] = entry.alpha;
  });
  return out;
}
