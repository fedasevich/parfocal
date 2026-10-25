import type { PathBatch, PinBatch, PointBatch, PolygonBatch } from "../types.ts";

interface BinaryAttribute {
  readonly value: Float32Array | Uint8Array | Uint32Array;
  readonly size: number;
  readonly normalized?: boolean;
}

export interface BinaryData {
  readonly length: number;
  readonly startIndices?: Uint32Array;
  readonly attributes: Readonly<Record<string, BinaryAttribute | Uint32Array>>;
}

export function colorsPerVertex(
  starts: Uint32Array,
  colors: Uint8Array,
  extraVertices: number,
): Uint8Array {
  const count = starts.length - 1;
  const expanded = new Uint8Array(((starts[count] ?? 0) + extraVertices * count) * 4);
  let cursor = 0;
  for (let item = 0; item < count; item++) {
    const vertices = (starts[item + 1] ?? 0) - (starts[item] ?? 0) + extraVertices;
    const color = colors.subarray(item * 4, item * 4 + 4);
    for (let vertex = 0; vertex < vertices; vertex++) {
      expanded.set(color, cursor);
      cursor += 4;
    }
  }
  return expanded;
}

export function polygonFillData(batch: PolygonBatch): BinaryData {
  return {
    length: batch.count,
    startIndices: batch.starts,
    attributes: {
      indices: batch.indices,
      getPolygon: { value: batch.positions, size: 2 },
      getFillColor: {
        value: colorsPerVertex(batch.starts, batch.colors, 0),
        size: 4,
        normalized: true,
      },
    },
  };
}

const loopClosingVertices = 2;

export function polygonOutlineData(batch: PolygonBatch): BinaryData {
  const starts = new Uint32Array(batch.count + 1);
  const rings: { from: number; to: number; closes: boolean }[] = [];
  let total = 0;
  for (let polygon = 0; polygon < batch.count; polygon++) {
    const from = batch.starts[polygon] ?? 0;
    const to = batch.starts[polygon + 1] ?? 0;
    const closes = to - from >= 3;
    rings.push({ from, to, closes });
    total += to - from + (closes ? loopClosingVertices : 0);
    starts[polygon + 1] = total;
  }
  const positions = new Float32Array(total * 2);
  const colors = new Uint8Array(total * 4);
  rings.forEach(({ from, to, closes }, polygon) => {
    const at = starts[polygon] ?? 0;
    const color = batch.colors.subarray(polygon * 4, polygon * 4 + 4);
    const vertices = to - from;
    positions.set(batch.positions.subarray(from * 2, to * 2), at * 2);
    if (closes) {
      positions.set(
        batch.positions.subarray(from * 2, from * 2 + loopClosingVertices * 2),
        (at + vertices) * 2,
      );
    }
    const written = vertices + (closes ? loopClosingVertices : 0);
    for (let vertex = 0; vertex < written; vertex++) colors.set(color, (at + vertex) * 4);
  });
  return {
    length: batch.count,
    startIndices: starts,
    attributes: {
      getPath: { value: positions, size: 2 },
      getColor: { value: colors, size: 4, normalized: true },
    },
  };
}

export function pathData(batch: PathBatch): BinaryData {
  return {
    length: batch.count,
    startIndices: batch.starts,
    attributes: {
      getPath: { value: batch.positions, size: 2 },
      getColor: {
        value: colorsPerVertex(batch.starts, batch.colors, 0),
        size: 4,
        normalized: true,
      },
    },
  };
}

export function pointData(batch: PointBatch): BinaryData {
  return {
    length: batch.count,
    attributes: {
      getPosition: { value: batch.positions, size: 2 },
      getFillColor: { value: batch.colors, size: 4, normalized: true },
    },
  };
}

export function pinData(batch: PinBatch, resolved: boolean): BinaryData | null {
  let matching = 0;
  for (let pin = 0; pin < batch.count; pin++) {
    if ((batch.resolved[pin] === 1) === resolved) matching++;
  }
  if (matching === 0) return null;
  const positions = new Float32Array(matching * 2);
  let cursor = 0;
  for (let pin = 0; pin < batch.count; pin++) {
    if ((batch.resolved[pin] === 1) !== resolved) continue;
    positions[cursor++] = batch.positions[pin * 2] ?? 0;
    positions[cursor++] = batch.positions[pin * 2 + 1] ?? 0;
  }
  return { length: matching, attributes: { getPosition: { value: positions, size: 2 } } };
}
