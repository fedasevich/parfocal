import { type Ring, ringArea, simplifyRing, traceContours } from "./contour-trace.ts";

export interface AisOptions {
  readonly foregroundThreshold: number;
  readonly centerThreshold: number;
  readonly boundaryThreshold: number;
  readonly foregroundSmoothing: number;
  readonly distanceSmoothing: number;
  readonly minArea: number;
  readonly outlineSmoothing: number;
  readonly simplifyPx: number;
}

export const aisDefaults: AisOptions = {
  foregroundThreshold: 0.5,
  centerThreshold: 0.5,
  boundaryThreshold: 0.5,
  foregroundSmoothing: 1,
  distanceSmoothing: 1.6,
  minArea: 20,
  outlineSmoothing: 1,
  simplifyPx: 0.25,
};

const tracedPixelCentre = 0.5;

export interface AisInstance {
  readonly ring: Ring;
  readonly area: number;
  readonly score: number;
  readonly centroid: { readonly x: number; readonly y: number };
}

export interface AisLabels {
  readonly labels: Int32Array;
  readonly count: number;
  readonly foreground: Float32Array;
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.round(4 * sigma));
  const weights = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    const weight = Math.exp(-(i * i) / (2 * sigma * sigma));
    weights[i + radius] = weight;
    total += weight;
  }
  for (let i = 0; i < weights.length; i++) weights[i] = (weights[i] ?? 0) / total;
  return weights;
}

function mirrored(index: number, size: number): number {
  if (size === 1) return 0;
  const period = size * 2;
  let wrapped = index % period;
  if (wrapped < 0) wrapped += period;
  return wrapped < size ? wrapped : period - 1 - wrapped;
}

export function gaussianBlur(
  values: Float32Array,
  width: number,
  height: number,
  sigma: number,
): Float32Array {
  if (sigma <= 0) return Float32Array.from(values);
  const weights = gaussianKernel(sigma);
  const radius = (weights.length - 1) / 2;
  const rows = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += (weights[k + radius] ?? 0) * (values[row + mirrored(x + k, width)] ?? 0);
      }
      rows[row + x] = sum;
    }
  }
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += (weights[k + radius] ?? 0) * (rows[mirrored(y + k, height) * width + x] ?? 0);
      }
      out[y * width + x] = sum;
    }
  }
  return out;
}

export function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; count: number } {
  const labels = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== 0) continue;
    count += 1;
    labels[start] = count;
    let top = 0;
    stack[top++] = start;
    while (top > 0) {
      const index = stack[--top] ?? 0;
      const x = index % width;
      const y = (index - x) / width;
      const visit = (next: number) => {
        if (mask[next] && labels[next] === 0) {
          labels[next] = count;
          stack[top++] = next;
        }
      };
      if (x > 0) visit(index - 1);
      if (x < width - 1) visit(index + 1);
      if (y > 0) visit(index - width);
      if (y < height - 1) visit(index + width);
    }
  }
  return { labels, count };
}

class PixelHeap {
  private keys: number[] = [];
  private order: number[] = [];
  private items: number[] = [];
  private pushed = 0;

  get size(): number {
    return this.items.length;
  }

  push(key: number, item: number): void {
    this.keys.push(key);
    this.order.push(this.pushed++);
    this.items.push(item);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (!this.before(child, parent)) break;
      this.swap(child, parent);
      child = parent;
    }
  }

  pop(): number {
    const top = this.items[0] ?? -1;
    const last = this.items.length - 1;
    this.swap(0, last);
    this.keys.pop();
    this.order.pop();
    this.items.pop();
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let best = parent;
      if (left < this.items.length && this.before(left, best)) best = left;
      if (right < this.items.length && this.before(right, best)) best = right;
      if (best === parent) break;
      this.swap(parent, best);
      parent = best;
    }
    return top;
  }

  private before(a: number, b: number): boolean {
    const keyA = this.keys[a] ?? 0;
    const keyB = this.keys[b] ?? 0;
    return keyA < keyB || (keyA === keyB && (this.order[a] ?? 0) < (this.order[b] ?? 0));
  }

  private swap(a: number, b: number): void {
    for (const array of [this.keys, this.order, this.items]) {
      const held = array[a] ?? 0;
      array[a] = array[b] ?? 0;
      array[b] = held;
    }
  }
}

export function markerWatershed(
  surface: Float32Array,
  markers: Int32Array,
  mask: Uint8Array,
  width: number,
): Int32Array {
  const labels = Int32Array.from(markers);
  const height = labels.length / width;
  const queued = new Uint8Array(labels.length);
  const heap = new PixelHeap();
  const enqueueAround = (index: number) => {
    const x = index % width;
    const y = (index - x) / width;
    const visit = (next: number) => {
      if (labels[next] === 0 && mask[next] && !queued[next]) {
        queued[next] = 1;
        heap.push(surface[next] ?? 0, next);
      }
    };
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y < height - 1) visit(index + width);
  };
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== 0) enqueueAround(i);
  }
  while (heap.size > 0) {
    const index = heap.pop();
    const x = index % width;
    const y = (index - x) / width;
    let label = 0;
    if (x > 0) label ||= labels[index - 1] ?? 0;
    if (x < width - 1) label ||= labels[index + 1] ?? 0;
    if (y > 0) label ||= labels[index - width] ?? 0;
    if (y < height - 1) label ||= labels[index + width] ?? 0;
    if (label === 0) continue;
    labels[index] = label;
    enqueueAround(index);
  }
  return labels;
}

export function aisLabels(
  maps: Float32Array,
  width: number,
  height: number,
  options: AisOptions = aisDefaults,
): AisLabels {
  const plane = width * height;
  if (maps.length < plane * 3) throw new RangeError("AIS maps need three planes");
  const foreground = gaussianBlur(
    maps.subarray(0, plane),
    width,
    height,
    options.foregroundSmoothing,
  );
  const center = gaussianBlur(
    maps.subarray(plane, plane * 2),
    width,
    height,
    options.distanceSmoothing,
  );
  const boundary = gaussianBlur(
    maps.subarray(plane * 2, plane * 3),
    width,
    height,
    options.distanceSmoothing,
  );
  const mask = new Uint8Array(plane);
  const seeds = new Uint8Array(plane);
  for (let i = 0; i < plane; i++) {
    if ((foreground[i] ?? 0) <= options.foregroundThreshold) continue;
    mask[i] = 1;
    if (
      (center[i] ?? 1) < options.centerThreshold &&
      (boundary[i] ?? 1) < options.boundaryThreshold
    ) {
      seeds[i] = 1;
    }
  }
  const markers = labelComponents(seeds, width, height);
  return {
    labels: markerWatershed(boundary, markers.labels, mask, width),
    count: markers.count,
    foreground,
  };
}

function largestRing(rings: readonly Ring[]): Ring | null {
  let best: Ring | null = null;
  let bestArea = 0;
  for (const ring of rings) {
    const area = ringArea(ring);
    if (area > bestArea) {
      best = ring;
      bestArea = area;
    }
  }
  return best;
}

export function aisOutlines(
  found: AisLabels,
  width: number,
  height: number,
  options: AisOptions = aisDefaults,
): AisInstance[] {
  const { labels, count, foreground } = found;
  const minX = new Int32Array(count + 1).fill(width);
  const minY = new Int32Array(count + 1).fill(height);
  const maxX = new Int32Array(count + 1).fill(-1);
  const maxY = new Int32Array(count + 1).fill(-1);
  const area = new Int32Array(count + 1);
  const score = new Float64Array(count + 1);
  const sumX = new Float64Array(count + 1);
  const sumY = new Float64Array(count + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const label = labels[index] ?? 0;
      if (label === 0) continue;
      area[label] = (area[label] ?? 0) + 1;
      score[label] = (score[label] ?? 0) + (foreground[index] ?? 0);
      sumX[label] = (sumX[label] ?? 0) + x;
      sumY[label] = (sumY[label] ?? 0) + y;
      if (x < (minX[label] ?? width)) minX[label] = x;
      if (y < (minY[label] ?? height)) minY[label] = y;
      if (x > (maxX[label] ?? -1)) maxX[label] = x;
      if (y > (maxY[label] ?? -1)) maxY[label] = y;
    }
  }
  const pad = Math.ceil(3 * options.outlineSmoothing) + 1;
  const instances: AisInstance[] = [];
  for (let label = 1; label <= count; label++) {
    const pixels = area[label] ?? 0;
    if (pixels < options.minArea) continue;
    const x0 = (minX[label] ?? 0) - pad;
    const y0 = (minY[label] ?? 0) - pad;
    const cropWidth = (maxX[label] ?? 0) - (minX[label] ?? 0) + 1 + pad * 2;
    const cropHeight = (maxY[label] ?? 0) - (minY[label] ?? 0) + 1 + pad * 2;
    const field = new Float32Array(cropWidth * cropHeight);
    for (let y = 0; y < cropHeight; y++) {
      const sy = y0 + y;
      if (sy < 0 || sy >= height) continue;
      for (let x = 0; x < cropWidth; x++) {
        const sx = x0 + x;
        if (sx >= 0 && sx < width && labels[sy * width + sx] === label) {
          field[y * cropWidth + x] = 1;
        }
      }
    }
    const smooth = gaussianBlur(field, cropWidth, cropHeight, options.outlineSmoothing);
    const traced = largestRing(traceContours(smooth, cropWidth, cropHeight, 0.5));
    if (traced === null) continue;
    const ring = simplifyRing(traced, options.simplifyPx);
    for (let i = 0; i < ring.length; i += 2) {
      ring[i] = (ring[i] ?? 0) + x0 - tracedPixelCentre;
      ring[i + 1] = (ring[i + 1] ?? 0) + y0 - tracedPixelCentre;
    }
    instances.push({
      ring,
      area: pixels,
      score: (score[label] ?? 0) / pixels,
      centroid: { x: (sumX[label] ?? 0) / pixels, y: (sumY[label] ?? 0) / pixels },
    });
  }
  return instances;
}

export function aisInstances(
  maps: Float32Array,
  width: number,
  height: number,
  options: AisOptions = aisDefaults,
): AisInstance[] {
  return aisOutlines(aisLabels(maps, width, height, options), width, height, options);
}
