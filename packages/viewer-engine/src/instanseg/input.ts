export interface InstanSegInput {
  pixels: Float32Array;
  height: number;
  width: number;
  paddedHeight: number;
  paddedWidth: number;
}

export interface RgbTile {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: number;
}

export const modelMicronsPerPixel = 0.5;
const lowPercentile = 0.1;
const highPercentile = 99.9;
const stretchEpsilon = 1e-6;
const inputFloor = -2;
const inputCeiling = 3;
const sizeMultiple = 16;
const precisionBits = 32 - 8 - 2;

export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

interface Taps {
  starts: Int32Array;
  counts: Int32Array;
  weights: Float64Array;
  span: number;
}

function bilinearTaps(inputSize: number, outputSize: number): Taps {
  const scale = inputSize / outputSize;
  const filterScale = Math.max(scale, 1);
  const support = filterScale;
  const span = Math.ceil(support) * 2 + 1;
  const starts = new Int32Array(outputSize);
  const counts = new Int32Array(outputSize);
  const weights = new Float64Array(outputSize * span);
  for (let out = 0; out < outputSize; out += 1) {
    const centre = (out + 0.5) * scale;
    const start = Math.max(Math.trunc(centre - support + 0.5), 0);
    const count = Math.min(Math.trunc(centre + support + 0.5), inputSize) - start;
    let total = 0;
    const raw: number[] = [];
    for (let tap = 0; tap < count; tap += 1) {
      const distance = Math.abs((tap + start - centre + 0.5) / filterScale);
      const weight = distance < 1 ? 1 - distance : 0;
      raw.push(weight);
      total += weight;
    }
    for (let tap = 0; tap < count; tap += 1) {
      const weight = total === 0 ? 0 : (raw[tap] ?? 0) / total;
      weights[out * span + tap] =
        weight < 0
          ? Math.trunc(-0.5 + weight * 2 ** precisionBits)
          : Math.trunc(0.5 + weight * 2 ** precisionBits);
    }
    starts[out] = start;
    counts[out] = count;
  }
  return { starts, counts, weights, span };
}

function clip8(sum: number): number {
  const value = Math.floor(sum / 2 ** precisionBits);
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

export function resizeRgb(tile: RgbTile, width: number, height: number): Uint8Array {
  const across = bilinearTaps(tile.width, width);
  const down = bilinearTaps(tile.height, height);
  const half = 2 ** (precisionBits - 1);
  const wide = new Uint8Array(width * tile.height * 3);
  for (let row = 0; row < tile.height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const start = across.starts[column] ?? 0;
      const count = across.counts[column] ?? 0;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = half;
        for (let tap = 0; tap < count; tap += 1) {
          const source = (row * tile.width + start + tap) * tile.channels + channel;
          sum += (tile.data[source] ?? 0) * (across.weights[column * across.span + tap] ?? 0);
        }
        wide[(row * width + column) * 3 + channel] = clip8(sum);
      }
    }
  }
  const out = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    const start = down.starts[row] ?? 0;
    const count = down.counts[row] ?? 0;
    for (let column = 0; column < width; column += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = half;
        for (let tap = 0; tap < count; tap += 1) {
          const source = ((start + tap) * width + column) * 3 + channel;
          sum += (wide[source] ?? 0) * (down.weights[row * down.span + tap] ?? 0);
        }
        out[(row * width + column) * 3 + channel] = clip8(sum);
      }
    }
  }
  return out;
}

function lerp(low: number, high: number, fraction: number): number {
  const difference = high - low;
  return fraction >= 0.5 ? high - difference * (1 - fraction) : low + difference * fraction;
}

export function percentile(sorted: Float32Array, percent: number): number {
  const position = (percent / 100) * (sorted.length - 1);
  const below = Math.floor(position);
  const above = Math.min(below + 1, sorted.length - 1);
  return Math.fround(lerp(sorted[below] ?? 0, sorted[above] ?? 0, position - below));
}

export function stretchChannels(planes: Float32Array, height: number, width: number): void {
  const plane = height * width;
  const epsilon = Math.fround(stretchEpsilon);
  for (let channel = 0; channel < 3; channel += 1) {
    const values = planes.subarray(channel * plane, (channel + 1) * plane);
    const sorted = Float32Array.from(values).sort();
    const low = percentile(sorted, lowPercentile);
    const high = percentile(sorted, highPercentile);
    const range = Math.fround(Math.fround(high - low) + epsilon);
    for (let index = 0; index < plane; index += 1) {
      values[index] = Math.fround(Math.fround((values[index] ?? 0) - low) / range);
    }
  }
}

export function paddedSize(size: number): number {
  return Math.ceil(size / sizeMultiple) * sizeMultiple;
}

export function networkInput(planes: Float32Array, height: number, width: number): InstanSegInput {
  const paddedHeight = paddedSize(height);
  const paddedWidth = paddedSize(width);
  const pixels = new Float32Array(3 * paddedHeight * paddedWidth);
  const reflect = (index: number, size: number) => (index < size ? index : 2 * (size - 1) - index);
  for (let channel = 0; channel < 3; channel += 1) {
    for (let row = 0; row < paddedHeight; row += 1) {
      const sourceRow = reflect(row, height);
      for (let column = 0; column < paddedWidth; column += 1) {
        const value = planes[channel * height * width + sourceRow * width + reflect(column, width)];
        pixels[(channel * paddedHeight + row) * paddedWidth + column] = Math.min(
          inputCeiling,
          Math.max(inputFloor, value ?? 0),
        );
      }
    }
  }
  return { pixels, height, width, paddedHeight, paddedWidth };
}

export function modelSize(size: number, micronsPerPixel: number): number {
  const factor = micronsPerPixel / modelMicronsPerPixel;
  return factor === 1 ? size : roundHalfEven(size * factor);
}

export function instansegInput(tile: RgbTile, micronsPerPixel: number): InstanSegInput {
  const width = modelSize(tile.width, micronsPerPixel);
  const height = modelSize(tile.height, micronsPerPixel);
  const unchanged = width === tile.width && height === tile.height;
  const rgb = unchanged ? tile.data : resizeRgb(tile, width, height);
  const step = unchanged ? tile.channels : 3;
  const plane = width * height;
  const planes = new Float32Array(3 * plane);
  for (let index = 0; index < plane; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      planes[channel * plane + index] = rgb[index * step + channel] ?? 0;
    }
  }
  stretchChannels(planes, height, width);
  return networkInput(planes, height, width);
}
