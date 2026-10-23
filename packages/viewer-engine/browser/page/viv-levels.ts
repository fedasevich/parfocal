import type { PixelSource, PixelWindow } from "../../src/index.ts";

export const vivTileSize = 256;

interface VivTileRequest {
  readonly x: number;
  readonly y: number;
  readonly signal?: AbortSignal;
}

interface VivRasterRequest {
  readonly signal?: AbortSignal;
}

export interface VivTile {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface VivLevel {
  readonly shape: [number, number, number];
  readonly labels: ["y", "x", "_c"];
  readonly dtype: "Uint8";
  readonly tileSize: number;
  readonly meta: { readonly photometricInterpretation: number };
  getTile(request: VivTileRequest): Promise<VivTile>;
  getRaster(request: VivRasterRequest): Promise<VivTile>;
  onTileError(error: Error): void;
}

const rgbPhotometric = 2;
const absentValue = 255;

function interleave(
  planes: readonly ArrayLike<number>[] | null,
  sourceWidth: number,
  width: number,
  height: number,
  step: number,
): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  if (planes === null) return out.fill(absentValue);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = row * step * sourceWidth;
    for (let column = 0; column < width; column += 1) {
      const source = sourceRow + column * step;
      const target = (row * width + column) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        out[target + channel] = planes[channel]?.[source] ?? 0;
      }
    }
  }
  return out;
}

function levelCount(width: number, height: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(width, height) / vivTileSize)) + 1);
}

export function vivLevels(source: PixelSource): VivLevel[] {
  if (source.photometric !== "rgb" || source.dtype !== "uint8") {
    throw new Error("The memory harness draws 8-bit RGB slides only");
  }
  const base = source.levels[0];
  if (!base) throw new Error("The slide has no levels");
  const levels: VivLevel[] = [];
  for (let index = 0; index < levelCount(base.width, base.height); index += 1) {
    const downsample = 2 ** index;
    let stored = 0;
    source.levels.forEach((level, at) => {
      if (level.downsample <= downsample) stored = at;
    });
    const real = source.levels[stored] ?? base;
    const step = downsample / real.downsample;
    if (!Number.isInteger(step)) {
      throw new Error(`Level ${stored} has downsample ${real.downsample}, not a power of two`);
    }
    const width = Math.ceil(real.width / step);
    const height = Math.ceil(real.height / step);
    const read = async (window: PixelWindow, signal?: AbortSignal): Promise<VivTile> => {
      const raster = await source.getRaster({
        level: stored,
        window,
        ...(signal ? { signal } : {}),
      });
      const outWidth = Math.ceil((window[2] - window[0]) / step);
      const outHeight = Math.ceil((window[3] - window[1]) / step);
      const planes = raster.absent ? null : raster.planes;
      return {
        data: interleave(planes, raster.width, outWidth, outHeight, step),
        width: outWidth,
        height: outHeight,
      };
    };
    levels.push({
      shape: [height, width, 3],
      labels: ["y", "x", "_c"],
      dtype: "Uint8",
      tileSize: vivTileSize,
      meta: { photometricInterpretation: rgbPhotometric },
      getTile: ({ x, y, signal }) => {
        const span = vivTileSize * step;
        const x0 = x * span;
        const y0 = y * span;
        return read(
          [x0, y0, Math.min(x0 + span, real.width), Math.min(y0 + span, real.height)],
          signal,
        );
      },
      getRaster: ({ signal }) => read([0, 0, real.width, real.height], signal),
      onTileError: (error) => {
        console.error(error);
      },
    });
  }
  return levels;
}
