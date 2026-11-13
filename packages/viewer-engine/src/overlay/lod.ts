import type { PointBatch, PolygonBatch } from "./batch-types.ts";
import { createPolygonBatch } from "./batches.ts";
import type { RasterData } from "./types.ts";

export type LodTier = "density" | "dots" | "outlines";

export const lodMinShapes = 500;
export const lodLargeFactor = 3;
export const lodDensityBelowPx = 2;
export const lodDotsBelowPx = 7;

const dotShare = 0.3;
const dotMinPx = 0.8;
const dotMaxPx = 2.2;

const densityMaxCells = 1024;
const densityBlurCells = 1.2;
const densityMaxAlpha = 0.45;
const densityEmptyBelow = 0.05;
const densityReferenceQuantile = 0.9;

export interface LodStats {
  readonly nucleusSize: number;
  readonly smallCount: number;
  readonly large: Uint32Array;
  readonly engaged: boolean;
}

export interface LodChoice {
  readonly tier: LodTier;
  readonly dotRadiusPx: number;
}

export const fullDetail: LodChoice = { tier: "outlines", dotRadiusPx: 0 };

export function lodDotRadiusPx(sizePx: number): number {
  const radius = Math.min(dotMaxPx, Math.max(dotMinPx, sizePx * dotShare));
  return Math.round(radius * 10) / 10;
}

export function shapeDiagonals(batch: PolygonBatch): Float32Array {
  const diagonals = new Float32Array(batch.count);
  const { positions, starts } = batch;
  for (let shape = 0; shape < batch.count; shape++) {
    const from = starts[shape] ?? 0;
    const to = starts[shape + 1] ?? 0;
    if (to <= from) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let vertex = from; vertex < to; vertex++) {
      const x = positions[vertex * 2] ?? 0;
      const y = positions[vertex * 2 + 1] ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    diagonals[shape] = Math.hypot(maxX - minX, maxY - minY);
  }
  return diagonals;
}

export function lodStats(batch: PolygonBatch): LodStats {
  const diagonals = shapeDiagonals(batch);
  const sorted = diagonals.slice().sort();
  const nucleusSize = sorted[sorted.length >> 1] ?? 0;
  const limit = nucleusSize * lodLargeFactor;
  const large: number[] = [];
  for (let shape = 0; shape < batch.count; shape++) {
    if ((diagonals[shape] ?? 0) > limit) large.push(shape);
  }
  const smallCount = batch.count - large.length;
  return {
    nucleusSize,
    smallCount,
    large: Uint32Array.from(large),
    engaged: smallCount >= lodMinShapes && nucleusSize > 0,
  };
}

export function chooseLod(stats: LodStats, pixelsPerUnit: number): LodChoice {
  if (!stats.engaged || !Number.isFinite(pixelsPerUnit)) return fullDetail;
  const sizePx = stats.nucleusSize * pixelsPerUnit;
  if (sizePx < lodDensityBelowPx) return { tier: "density", dotRadiusPx: 0 };
  if (sizePx < lodDotsBelowPx) return { tier: "dots", dotRadiusPx: lodDotRadiusPx(sizePx) };
  return fullDetail;
}

export function lodKey(choice: LodChoice): string {
  return `${choice.tier}:${choice.dotRadiusPx}`;
}

export function smallShapeCentres(batch: PolygonBatch, stats: LodStats): PointBatch {
  const positions = new Float32Array(stats.smallCount * 2);
  const colors = new Uint8Array(stats.smallCount * 4);
  const { large } = stats;
  let nextLarge = 0;
  let cursor = 0;
  for (let shape = 0; shape < batch.count; shape++) {
    if (large[nextLarge] === shape) {
      nextLarge++;
      continue;
    }
    const from = batch.starts[shape] ?? 0;
    const to = batch.starts[shape + 1] ?? 0;
    let sumX = 0;
    let sumY = 0;
    for (let vertex = from; vertex < to; vertex++) {
      sumX += batch.positions[vertex * 2] ?? 0;
      sumY += batch.positions[vertex * 2 + 1] ?? 0;
    }
    const vertices = Math.max(1, to - from);
    positions[cursor * 2] = sumX / vertices;
    positions[cursor * 2 + 1] = sumY / vertices;
    colors.set(batch.colors.subarray(shape * 4, shape * 4 + 3), cursor * 4);
    colors[cursor * 4 + 3] = 255;
    cursor++;
  }
  return { count: stats.smallCount, positions, colors };
}

export function largeShapes(batch: PolygonBatch, stats: LodStats): PolygonBatch | null {
  const { large } = stats;
  if (large.length === 0) return null;
  let vertices = 0;
  for (const shape of large)
    vertices += (batch.starts[shape + 1] ?? 0) - (batch.starts[shape] ?? 0);
  const positions = new Float32Array(vertices * 2);
  const starts = new Uint32Array(large.length + 1);
  const colors = new Uint8Array(large.length * 4);
  const holeStarts: number[] = [];
  let hole = 0;
  let cursor = 0;
  large.forEach((shape, index) => {
    const from = batch.starts[shape] ?? 0;
    const to = batch.starts[shape + 1] ?? 0;
    positions.set(batch.positions.subarray(from * 2, to * 2), cursor * 2);
    colors.set(batch.colors.subarray(shape * 4, shape * 4 + 4), index * 4);
    while (hole < batch.holeStarts.length && (batch.holeStarts[hole] ?? 0) < from) hole++;
    while (hole < batch.holeStarts.length && (batch.holeStarts[hole] ?? 0) < to) {
      holeStarts.push((batch.holeStarts[hole++] ?? 0) - from + cursor);
    }
    cursor += to - from;
    starts[index + 1] = cursor;
  });
  return createPolygonBatch({
    positions,
    starts,
    colors,
    holeStarts: Uint32Array.from(holeStarts),
  });
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = weight;
    sum += weight;
  }
  return kernel.map((weight) => weight / sum);
}

function blur(field: Float32Array, width: number, height: number, kernel: Float32Array): void {
  const radius = kernel.length >> 1;
  const scratch = new Float32Array(field.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const column = Math.min(width - 1, Math.max(0, x + offset));
        sum += (field[y * width + column] ?? 0) * (kernel[offset + radius] ?? 0);
      }
      scratch[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset++) {
        const row = Math.min(height - 1, Math.max(0, y + offset));
        sum += (scratch[row * width + x] ?? 0) * (kernel[offset + radius] ?? 0);
      }
      field[y * width + x] = sum;
    }
  }
}

export function densityRaster(centres: PointBatch, nucleusSize: number): RasterData | null {
  if (centres.count === 0) return null;
  const { positions, colors } = centres;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let point = 0; point < centres.count; point++) {
    const x = positions[point * 2] ?? 0;
    const y = positions[point * 2 + 1] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const cell = Math.max(nucleusSize * 2, Math.max(spanX, spanY) / densityMaxCells, 1);
  const width = Math.ceil(spanX / cell) + 2;
  const height = Math.ceil(spanY / cell) + 2;
  const originX = minX - cell;
  const originY = minY - cell;

  const count = new Float32Array(width * height);
  const red = new Float32Array(width * height);
  const green = new Float32Array(width * height);
  const blue = new Float32Array(width * height);
  for (let point = 0; point < centres.count; point++) {
    const column = Math.min(
      width - 1,
      Math.max(0, Math.floor(((positions[point * 2] ?? 0) - originX) / cell)),
    );
    const row = Math.min(
      height - 1,
      Math.max(0, Math.floor(((positions[point * 2 + 1] ?? 0) - originY) / cell)),
    );
    const at = row * width + column;
    count[at] = (count[at] ?? 0) + 1;
    red[at] = (red[at] ?? 0) + (colors[point * 4] ?? 0);
    green[at] = (green[at] ?? 0) + (colors[point * 4 + 1] ?? 0);
    blue[at] = (blue[at] ?? 0) + (colors[point * 4 + 2] ?? 0);
  }

  const kernel = gaussianKernel(densityBlurCells);
  for (const field of [count, red, green, blue]) blur(field, width, height, kernel);

  const filled = count.filter((value) => value > densityEmptyBelow).sort();
  const reference = filled[Math.floor(filled.length * densityReferenceQuantile)] ?? 0;
  if (reference <= 0) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < count.length; at++) {
    const weight = count[at] ?? 0;
    if (weight <= densityEmptyBelow) continue;
    rgba[at * 4] = (red[at] ?? 0) / weight;
    rgba[at * 4 + 1] = (green[at] ?? 0) / weight;
    rgba[at * 4 + 2] = (blue[at] ?? 0) / weight;
    rgba[at * 4 + 3] = Math.min(1, weight / reference) * densityMaxAlpha * 255;
  }
  return {
    width,
    height,
    rgba,
    area: { x: originX, y: originY, width: width * cell, height: height * cell },
    smooth: true,
  };
}
