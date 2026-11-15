export interface EmbeddingPlanes {
  readonly data: Float32Array;
  readonly channels: number;
  readonly grid: number;
}

export const coverageSamples = 8;
export const contextRingCells = 2;
export const typerProbabilityFloor = 1e-4;

function pointInRing(ring: Float32Array, x: number, y: number): boolean {
  let hit = false;
  const count = ring.length >> 1;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = ring[i * 2] ?? 0;
    const yi = ring[i * 2 + 1] ?? 0;
    const xj = ring[j * 2] ?? 0;
    const yj = ring[j * 2 + 1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export function cellCoverage(ring: Float32Array, patchSize: number, grid: number): Float32Array {
  const cell = patchSize / grid;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const x = ring[i] ?? 0;
    const y = ring[i + 1] ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const out = new Float32Array(grid * grid);
  if (ring.length < 6) return out;
  const firstColumn = Math.max(0, Math.floor(minX / cell));
  const lastColumn = Math.min(grid - 1, Math.floor(maxX / cell));
  const firstRow = Math.max(0, Math.floor(minY / cell));
  const lastRow = Math.min(grid - 1, Math.floor(maxY / cell));
  const total = coverageSamples * coverageSamples;
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      let hits = 0;
      for (let sy = 0; sy < coverageSamples; sy++) {
        const y = (row + (sy + 0.5) / coverageSamples) * cell;
        for (let sx = 0; sx < coverageSamples; sx++) {
          if (pointInRing(ring, (column + (sx + 0.5) / coverageSamples) * cell, y)) hits++;
        }
      }
      out[row * grid + column] = hits / total;
    }
  }
  return out;
}

function centreCell(ring: Float32Array, patchSize: number, grid: number): number {
  const count = ring.length >> 1;
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    x += (ring[i] ?? 0) / Math.max(1, count);
    y += (ring[i + 1] ?? 0) / Math.max(1, count);
  }
  const cell = patchSize / grid;
  const column = Math.min(grid - 1, Math.max(0, Math.floor(x / cell)));
  const row = Math.min(grid - 1, Math.max(0, Math.floor(y / cell)));
  return row * grid + column;
}

function grow(mask: Uint8Array, grid: number): Uint8Array {
  const out = Uint8Array.from(mask);
  for (let row = 0; row < grid; row++) {
    for (let column = 0; column < grid; column++) {
      if (mask[row * grid + column] !== 1) continue;
      if (column > 0) out[row * grid + column - 1] = 1;
      if (column < grid - 1) out[row * grid + column + 1] = 1;
      if (row > 0) out[(row - 1) * grid + column] = 1;
      if (row < grid - 1) out[(row + 1) * grid + column] = 1;
    }
  }
  return out;
}

export function pooledFeatureDims(channels: number): number {
  return channels * 2;
}

export function poolNucleusFeature(
  planes: EmbeddingPlanes,
  ring: Float32Array,
  patchSize: number,
): Float32Array {
  const { data, channels, grid } = planes;
  const plane = grid * grid;
  if (data.length < channels * plane) {
    throw new RangeError(`The embedding must hold ${channels} x ${grid} x ${grid} values`);
  }
  let weights = cellCoverage(ring, patchSize, grid);
  let total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) {
    weights = new Float32Array(plane);
    weights[centreCell(ring, patchSize, grid)] = 1;
    total = 1;
  }
  const inside: number[] = [];
  const footprint = new Uint8Array(plane);
  for (let i = 0; i < plane; i++) {
    if ((weights[i] ?? 0) > 0) {
      footprint[i] = 1;
      inside.push(i);
    }
  }
  let grown: Uint8Array = footprint;
  for (let step = 0; step < contextRingCells; step++) grown = grow(grown, grid);
  const context: number[] = [];
  for (let i = 0; i < plane; i++) if (grown[i] === 1 && footprint[i] === 0) context.push(i);

  const out = new Float32Array(pooledFeatureDims(channels));
  for (let channel = 0; channel < channels; channel++) {
    const base = channel * plane;
    let sum = 0;
    for (const cell of inside) sum += (weights[cell] ?? 0) * (data[base + cell] ?? 0);
    const mean = sum / total;
    out[channel] = mean;
    if (context.length === 0) {
      out[channels + channel] = mean;
      continue;
    }
    let around = 0;
    for (const cell of context) around += data[base + cell] ?? 0;
    out[channels + channel] = around / context.length;
  }
  return out;
}

export function typerLogProbabilities(
  probabilities: Readonly<Record<string, number>> | null,
  classKeys: readonly string[],
): Float32Array {
  const uniform = 1 / Math.max(1, classKeys.length);
  return Float32Array.from(classKeys, (key) => {
    const value = probabilities === null ? uniform : (probabilities[key] ?? 0);
    return Math.log(Math.max(typerProbabilityFloor, value));
  });
}

export function learnerInput(pooled: Float32Array, typerLogs: Float32Array): Float32Array {
  const out = new Float32Array(pooled.length + typerLogs.length);
  out.set(pooled);
  out.set(typerLogs, pooled.length);
  return out;
}
