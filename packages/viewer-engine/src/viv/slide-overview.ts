import { planesToRgb } from "../patch/patch-reader.ts";
import type { PixelSource } from "../pixel-source/types.ts";

export const OVERVIEW_MAX_SIDE = 4096;

export interface SlideOverview {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
}

export function smallestLevel(source: Pick<PixelSource, "levels">): number {
  let best = -1;
  let bestArea = Number.POSITIVE_INFINITY;
  source.levels.forEach((level, index) => {
    const area = level.width * level.height;
    if (area < bestArea) {
      best = index;
      bestArea = area;
    }
  });
  return best;
}

export function rgbToRgba(rgb: ArrayLike<number>, count: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(count * 4);
  for (let index = 0; index < count; index++) {
    out[index * 4] = rgb[index * 3] ?? 0;
    out[index * 4 + 1] = rgb[index * 3 + 1] ?? 0;
    out[index * 4 + 2] = rgb[index * 3 + 2] ?? 0;
    out[index * 4 + 3] = 255;
  }
  return out;
}

export async function readSlideOverview(
  source: PixelSource,
  signal?: AbortSignal,
  maxSide = OVERVIEW_MAX_SIDE,
): Promise<SlideOverview | null> {
  const level = smallestLevel(source);
  const info = source.levels[level];
  if (info === undefined || Math.max(info.width, info.height) > maxSide) return null;
  if (source.dtype !== "uint8") return null;
  const raster = await source.getRaster(signal === undefined ? { level } : { level, signal });
  if (raster.absent) return null;
  const count = raster.width * raster.height;
  return {
    width: raster.width,
    height: raster.height,
    rgba: rgbToRgba(planesToRgb(raster.planes, raster.width, raster.height), count),
  };
}
