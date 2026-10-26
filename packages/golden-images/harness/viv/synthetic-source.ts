import type { PixelResult, PixelSource, PixelWindow } from "@parfocal/viewer-engine";

export const syntheticTileSize = 128;

export const syntheticWidth = 2048;

export const syntheticHeight = 1536;

export const syntheticLevelCount = 5;

export type Rgb = readonly [number, number, number];

function hash(x: number, y: number, salt: number): number {
  let value =
    Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return (value ^ (value >>> 15)) & 255;
}

export function finestPixel(x: number, y: number): Rgb {
  return [hash(x, y, 1), hash(x, y, 2), hash(x, y, 3)];
}

export function coarsePixel(x: number, y: number): Rgb {
  const tile = Math.floor(x / syntheticTileSize) + Math.floor(y / syntheticTileSize);
  const value = tile % 2 === 0 ? 0 : 255;
  return [value, value, value];
}

export function syntheticPixel(level: number, x: number, y: number): Rgb {
  return level === 0 ? finestPixel(x, y) : coarsePixel(x, y);
}

function levelSize(level: number): { width: number; height: number } {
  const downsample = 2 ** level;
  return {
    width: Math.ceil(syntheticWidth / downsample),
    height: Math.ceil(syntheticHeight / downsample),
  };
}

function rasterOf(level: number, window: PixelWindow): PixelResult {
  const { width: levelWidth, height: levelHeight } = levelSize(level);
  const [x0, y0, x1, y1] = window;
  const width = Math.min(x1, levelWidth) - x0;
  const height = Math.min(y1, levelHeight) - y0;
  const planes = [0, 1, 2].map(() => new Uint8Array(width * height));
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const colour = syntheticPixel(level, x0 + column, y0 + row);
      for (let channel = 0; channel < 3; channel++) {
        const plane = planes[channel];
        if (plane) plane[row * width + column] = colour[channel] ?? 0;
      }
    }
  }
  return { absent: false, width, height, planes };
}

export function createSyntheticSource(): PixelSource {
  const levels = Array.from({ length: syntheticLevelCount }, (_, level) => ({
    downsample: 2 ** level,
    ...levelSize(level),
    tileWidth: syntheticTileSize,
    tileHeight: syntheticTileSize,
  }));
  const getRaster: PixelSource["getRaster"] = (request) => {
    const size = levelSize(request.level);
    const window = request.window ?? [0, 0, size.width, size.height];
    return Promise.resolve(rasterOf(request.level, window));
  };
  return {
    formatId: "generic-tiff",
    levels,
    tileSize: { width: syntheticTileSize, height: syntheticTileSize },
    micronsPerPixel: { x: 0.25, y: 0.25 },
    photometric: "rgb",
    dtype: "uint8",
    channels: ["red", "green", "blue"].map((name) => ({ name, color: null, window: null })),
    getTile: (request) => {
      const x0 = request.x * syntheticTileSize;
      const y0 = request.y * syntheticTileSize;
      return getRaster({
        level: request.level,
        window: [x0, y0, x0 + syntheticTileSize, y0 + syntheticTileSize],
      });
    },
    getRaster,
    close: () => {},
  };
}
