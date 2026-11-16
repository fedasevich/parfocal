export interface DenseLayer {
  inputs: number;
  outputs: number;
  weights: Float32Array;
  bias: Float32Array;
}

export interface InstanSegPostProcess {
  classifier: readonly DenseLayer[];
  maskThreshold: number;
  peakDistance: number;
  seedThreshold: number;
  overlapThreshold: number;
  windowSize: number;
}

export interface InstanSegMaps {
  data: Float32Array;
  height: number;
  width: number;
}

export interface InstanSegLabels {
  labels: Int32Array;
  height: number;
  width: number;
  seeds: number;
}

const mapChannels = 5;
const coordinateSpan = 64 / 256;
const seedScale = 15;
const fieldScale = 8;
const componentIterations = 100;
const neighbours = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const;

function sigmoid(value: number): number {
  return Math.fround(1 / (1 + Math.exp(-value)));
}

function coordinates(count: number): Float32Array {
  const values = new Float32Array(count);
  const end = count * coordinateSpan;
  const step = count > 1 ? end / (count - 1) : 0;
  for (let index = 0; index < count; index += 1) values[index] = index * step;
  return values;
}

interface Planes {
  fieldRow: Float32Array;
  fieldColumn: Float32Array;
  sigmaRow: Float32Array;
  sigmaColumn: Float32Array;
  seedMap: Float32Array;
}

function planes(maps: InstanSegMaps, height: number, width: number): Planes {
  const plane = maps.height * maps.width;
  const size = height * width;
  const fieldRow = new Float32Array(size);
  const fieldColumn = new Float32Array(size);
  const sigmaRow = new Float32Array(size);
  const sigmaColumn = new Float32Array(size);
  const seedMap = new Float32Array(size);
  const xs = coordinates(width);
  const ys = coordinates(height);
  const half = Math.fround(0.5);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const source = row * maps.width + column;
      const target = row * width + column;
      const x = Math.fround(Math.fround(sigmoid(maps.data[source] ?? 0) - half) * fieldScale);
      const y = Math.fround(
        Math.fround(sigmoid(maps.data[plane + source] ?? 0) - half) * fieldScale,
      );
      fieldRow[target] = Math.fround(x + (xs[column] ?? 0));
      fieldColumn[target] = Math.fround(y + (ys[row] ?? 0));
      sigmaRow[target] = maps.data[2 * plane + source] ?? 0;
      sigmaColumn[target] = maps.data[3 * plane + source] ?? 0;
      seedMap[target] = Math.fround(
        Math.fround((maps.data[4 * plane + source] ?? 0) / seedScale) + half,
      );
    }
  }
  return { fieldRow, fieldColumn, sigmaRow, sigmaColumn, seedMap };
}

export function seedPeaks(
  seedMap: Float32Array,
  height: number,
  width: number,
  distance: number,
  threshold: number,
): number[] {
  const floor = Math.fround(threshold);
  const peaks: number[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const value = seedMap[index] ?? 0;
      if (!(value > floor)) continue;
      let peak = true;
      const top = Math.max(0, row - distance);
      const bottom = Math.min(height - 1, row + distance);
      const left = Math.max(0, column - distance);
      const right = Math.min(width - 1, column + distance);
      for (let r = top; r <= bottom && peak; r += 1) {
        for (let c = left; c <= right; c += 1) {
          const other = r * width + c;
          if (other === index) continue;
          const neighbour = seedMap[other] ?? 0;
          if (other < index ? neighbour >= value : neighbour > value) {
            peak = false;
            break;
          }
        }
      }
      if (peak) peaks.push(index);
    }
  }
  return peaks;
}

function classify(
  layers: readonly DenseLayer[],
  features: Float64Array,
  buffers: readonly [Float64Array, Float64Array],
): number {
  let input = features;
  for (let layer = 0; layer < layers.length; layer += 1) {
    const dense = layers[layer];
    if (!dense) continue;
    const output = layer % 2 === 0 ? buffers[0] : buffers[1];
    const last = layer === layers.length - 1;
    for (let out = 0; out < dense.outputs; out += 1) {
      let sum = dense.bias[out] ?? 0;
      const offset = out * dense.inputs;
      for (let index = 0; index < dense.inputs; index += 1) {
        sum += (dense.weights[offset + index] ?? 0) * (input[index] ?? 0);
      }
      const value = Math.fround(sum);
      output[out] = last || value > 0 ? value : 0;
    }
    input = output;
  }
  return sigmoid(input[0] ?? 0);
}

export interface WindowBox {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function floodFill(
  inside: (index: number) => boolean,
  sources: readonly number[],
  side: number,
  maxLevels: number,
  box: WindowBox = { top: 0, left: 0, bottom: side - 1, right: side - 1 },
): number[] {
  const reached = new Uint8Array(side * side);
  const found: number[] = [];
  let frontier: number[] = [];
  const visit = (row: number, column: number, next: number[]) => {
    if (row < box.top || row > box.bottom || column < box.left || column > box.right) return;
    const index = row * side + column;
    if (reached[index] || !inside(index)) return;
    reached[index] = 1;
    next.push(index);
    found.push(index);
  };
  for (const source of sources) {
    const row = Math.floor(source / side);
    const column = source % side;
    visit(row, column, frontier);
    for (const [dr, dc] of neighbours) visit(row + dr, column + dc, frontier);
  }
  for (let level = 1; level < maxLevels && frontier.length > 0; level += 1) {
    const next: number[] = [];
    for (const index of frontier) {
      const row = Math.floor(index / side);
      const column = index % side;
      for (const [dr, dc] of neighbours) visit(row + dr, column + dc, next);
    }
    frontier = next;
  }
  return found;
}

const holeReach = 3;

export function holesOf(filled: readonly number[], side: number, maxLevels: number): number[] {
  if (filled.length === 0) return [];
  const isFilled = new Uint8Array(side * side);
  let top = side;
  let left = side;
  let bottom = -1;
  let right = -1;
  for (const index of filled) {
    isFilled[index] = 1;
    const row = Math.floor(index / side);
    const column = index % side;
    top = Math.min(top, row);
    bottom = Math.max(bottom, row);
    left = Math.min(left, column);
    right = Math.max(right, column);
  }
  const margin = holeReach + 1;
  const box = {
    top: Math.max(0, top - margin),
    left: Math.max(0, left - margin),
    bottom: Math.min(side - 1, bottom + margin),
    right: Math.min(side - 1, right + margin),
  };
  const near = new Uint8Array(side * side);
  for (const index of filled) {
    const row = Math.floor(index / side);
    const column = index % side;
    for (let r = Math.max(0, row - holeReach); r <= Math.min(side - 1, row + holeReach); r += 1) {
      const start = r * side;
      for (
        let c = Math.max(0, column - holeReach);
        c <= Math.min(side - 1, column + holeReach);
        c += 1
      ) {
        near[start + c] = 1;
      }
    }
  }
  const sources: number[] = [];
  for (let row = box.top; row <= box.bottom; row += 1) {
    for (let column = box.left; column <= box.right; column += 1) {
      if (!near[row * side + column]) sources.push(row * side + column);
    }
  }
  const outside = new Uint8Array(side * side);
  for (const index of floodFill((index) => !isFilled[index], sources, side, maxLevels, box)) {
    outside[index] = 1;
  }
  const holes: number[] = [];
  for (let row = box.top; row <= box.bottom; row += 1) {
    for (let column = box.left; column <= box.right; column += 1) {
      const index = row * side + column;
      if (!isFilled[index] && !outside[index]) holes.push(index);
    }
  }
  return holes;
}

export function connectedComponents(
  adjacency: readonly (readonly number[])[],
  maxIterations: number,
): Int32Array {
  const count = adjacency.length;
  let labels = Int32Array.from({ length: count }, (_, index) => index + 1);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const next = new Int32Array(count);
    let changed = false;
    for (let node = 0; node < count; node += 1) {
      let smallest = labels[node] ?? 0;
      for (const other of adjacency[node] ?? []) {
        smallest = Math.min(smallest, labels[other] ?? smallest);
      }
      next[node] = smallest;
      if (smallest !== labels[node]) changed = true;
    }
    labels = next;
    if (!changed) break;
  }
  return labels;
}

interface SeedMasks {
  pixels: number[];
  probabilities: number[];
  starts: Int32Array;
}

function seedMasks(
  planes: Planes,
  seeds: readonly number[],
  height: number,
  width: number,
  post: InstanSegPostProcess,
): SeedMasks {
  const { fieldRow, fieldColumn, sigmaRow, sigmaColumn } = planes;
  const half = Math.min(post.windowSize, height, width);
  const side = 2 * half;
  const threshold = Math.fround(post.maskThreshold);
  const cache = new Float32Array(side * side);
  const stamp = new Int32Array(side * side);
  const features = new Float64Array(4);
  const widest = Math.max(4, ...post.classifier.map((layer) => layer.outputs));
  const scratch = [new Float64Array(widest), new Float64Array(widest)] as const;
  const pixels: number[] = [];
  const probabilities: number[] = [];
  const starts = new Int32Array(seeds.length + 1);

  seeds.forEach((centre, seed) => {
    const row = Math.floor(centre / width);
    const column = centre % width;
    const top = Math.min(Math.max(row, half), height - half) - half;
    const left = Math.min(Math.max(column, half), width - half) - half;
    const centreRow = fieldRow[centre] ?? 0;
    const centreColumn = fieldColumn[centre] ?? 0;
    const mark = seed + 1;
    const probability = (index: number): number => {
      if (stamp[index] !== mark) {
        const pixel = (top + Math.floor(index / side)) * width + left + (index % side);
        features[0] = Math.fround((fieldRow[pixel] ?? 0) - centreRow);
        features[1] = Math.fround((fieldColumn[pixel] ?? 0) - centreColumn);
        features[2] = sigmaRow[pixel] ?? 0;
        features[3] = sigmaColumn[pixel] ?? 0;
        cache[index] = classify(post.classifier, features, scratch);
        stamp[index] = mark;
      }
      return cache[index] ?? 0;
    };
    const filled = floodFill(
      (index) => probability(index) >= threshold,
      [(row - top) * side + (column - left)],
      side,
      side,
    );
    const toImage = (index: number) =>
      (top + Math.floor(index / side)) * width + left + (index % side);
    for (const index of filled) {
      pixels.push(toImage(index));
      probabilities.push(cache[index] ?? 0);
    }
    for (const index of holesOf(filled, side, side)) {
      pixels.push(toImage(index));
      probabilities.push(threshold);
    }
    starts[seed + 1] = pixels.length;
  });
  return { pixels, probabilities, starts };
}

function overlapAdjacency(masks: SeedMasks, count: number, size: number, overlap: number) {
  const covers = new Int32Array(size + 1);
  for (const pixel of masks.pixels) covers[pixel + 1] = (covers[pixel + 1] ?? 0) + 1;
  for (let pixel = 0; pixel < size; pixel += 1) {
    covers[pixel + 1] = (covers[pixel + 1] ?? 0) + (covers[pixel] ?? 0);
  }
  const filledUpTo = covers.slice(0, size);
  const owners = new Int32Array(masks.pixels.length);
  for (let seed = 0; seed < count; seed += 1) {
    for (let entry = masks.starts[seed] ?? 0; entry < (masks.starts[seed + 1] ?? 0); entry += 1) {
      const pixel = masks.pixels[entry] ?? 0;
      const slot = filledUpTo[pixel] ?? 0;
      owners[slot] = seed;
      filledUpTo[pixel] = slot + 1;
    }
  }
  const shared = new Map<number, number>();
  for (let pixel = 0; pixel < size; pixel += 1) {
    const start = covers[pixel] ?? 0;
    const end = covers[pixel + 1] ?? 0;
    for (let a = start; a < end; a += 1) {
      for (let b = a + 1; b < end; b += 1) {
        const key = (owners[a] ?? 0) * count + (owners[b] ?? 0);
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }
  const adjacency: number[][] = Array.from({ length: count }, () => []);
  const floor = Math.fround(overlap);
  for (const [key, intersection] of shared) {
    const first = Math.floor(key / count);
    const second = key % count;
    const areaOf = (seed: number) => (masks.starts[seed + 1] ?? 0) - (masks.starts[seed] ?? 0);
    if (Math.fround(intersection / Math.min(areaOf(first), areaOf(second))) > floor) {
      adjacency[first]?.push(second);
      adjacency[second]?.push(first);
    }
  }
  return adjacency;
}

export function instansegLabels(
  maps: InstanSegMaps,
  height: number,
  width: number,
  post: InstanSegPostProcess,
): InstanSegLabels {
  if (maps.data.length < mapChannels * maps.height * maps.width) {
    throw new Error("InstanSeg maps must hold five channels");
  }
  const labels = new Int32Array(height * width);
  const cropped = planes(maps, height, width);
  const seeds = seedPeaks(cropped.seedMap, height, width, post.peakDistance, post.seedThreshold);
  const count = seeds.length;
  if (count === 0) return { labels, height, width, seeds: 0 };

  const masks = seedMasks(cropped, seeds, height, width, post);
  const best = new Float32Array(height * width).fill(-1);
  for (let seed = 0; seed < count; seed += 1) {
    for (let entry = masks.starts[seed] ?? 0; entry < (masks.starts[seed + 1] ?? 0); entry += 1) {
      const pixel = masks.pixels[entry] ?? 0;
      const probability = masks.probabilities[entry] ?? 0;
      if (probability > (best[pixel] ?? 0)) {
        best[pixel] = probability;
        labels[pixel] = seed + 1;
      }
    }
  }
  const adjacency = overlapAdjacency(masks, count, height * width, post.overlapThreshold);
  const components = connectedComponents(adjacency, componentIterations);
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const label = labels[pixel] ?? 0;
    if (label > 0) labels[pixel] = components[label - 1] ?? label;
  }
  return { labels, height, width, seeds: count };
}
