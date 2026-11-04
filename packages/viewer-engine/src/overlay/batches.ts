import { earcut } from "@math.gl/polygon";
import type { PathBatch, PointBatch, PolygonBatch, Rgba } from "./batch-types.ts";

export interface PolygonInput {
  readonly ring: ArrayLike<number>;
  readonly holes?: readonly ArrayLike<number>[];
  readonly color: Rgba;
}

export interface LineInput {
  readonly line: ArrayLike<number>;
  readonly color: Rgba;
}

export interface PointInput {
  readonly x: number;
  readonly y: number;
  readonly color: Rgba;
}

export interface FlatBatch {
  readonly positions: Float32Array;
  readonly starts: Uint32Array;
  readonly colors: Uint8Array;
  readonly holeStarts?: Uint32Array;
}

const minimumPolygonVertices = 3;

function checkFlatBatch(batch: FlatBatch): number {
  const { positions, starts, colors } = batch;
  if (starts.length < 1) throw new RangeError("A batch needs one start for each item and an end");
  const count = starts.length - 1;
  const vertices = positions.length / 2;
  if (!Number.isInteger(vertices)) throw new RangeError("Batch positions must be x and y pairs");
  if (starts[0] !== 0 || starts[count] !== vertices) {
    throw new RangeError("Batch starts must begin at 0 and end at the vertex count");
  }
  for (let item = 0; item < count; item++) {
    if ((starts[item + 1] ?? 0) < (starts[item] ?? 0)) {
      throw new RangeError("Batch starts must not decrease");
    }
  }
  if (colors.length !== count * 4) {
    throw new RangeError("A batch needs one RGBA colour for each item");
  }
  return count;
}

export function triangulatePolygons(
  positions: Float32Array,
  starts: Uint32Array,
  holeStarts: Uint32Array = new Uint32Array(0),
): Uint32Array {
  const count = starts.length - 1;
  const triangles: number[][] = [];
  let total = 0;
  let hole = 0;
  for (let polygon = 0; polygon < count; polygon++) {
    const from = starts[polygon] ?? 0;
    const to = starts[polygon + 1] ?? 0;
    while (hole < holeStarts.length && (holeStarts[hole] ?? 0) <= from) hole++;
    const localHoles: number[] = [];
    while (hole < holeStarts.length && (holeStarts[hole] ?? 0) < to) {
      localHoles.push((holeStarts[hole] ?? 0) - from);
      hole++;
    }
    if (to - from < minimumPolygonVertices) continue;
    const local = earcut(
      positions.subarray(from * 2, to * 2),
      localHoles.length > 0 ? localHoles : undefined,
      2,
    );
    for (let index = 0; index < local.length; index++) local[index] = (local[index] ?? 0) + from;
    triangles.push(local);
    total += local.length;
  }
  const indices = new Uint32Array(total);
  let cursor = 0;
  for (const local of triangles) {
    indices.set(local, cursor);
    cursor += local.length;
  }
  return indices;
}

function checkHoleStarts(batch: FlatBatch): Uint32Array {
  const holeStarts = batch.holeStarts ?? new Uint32Array(0);
  let polygon = 0;
  let previous = -1;
  for (const start of holeStarts) {
    if (start <= previous) throw new RangeError("Hole starts must increase");
    previous = start;
    while (polygon < batch.starts.length - 1 && (batch.starts[polygon + 1] ?? 0) <= start) {
      polygon++;
    }
    const from = batch.starts[polygon] ?? 0;
    const to = batch.starts[polygon + 1] ?? 0;
    if (start <= from || start >= to) {
      throw new RangeError("Each hole must start inside a polygon after its outer ring");
    }
  }
  return holeStarts;
}

export function createPolygonBatch(batch: FlatBatch): PolygonBatch {
  const count = checkFlatBatch(batch);
  const holeStarts = checkHoleStarts(batch);
  return {
    count,
    positions: batch.positions,
    starts: batch.starts,
    colors: batch.colors,
    holeStarts,
    indices: triangulatePolygons(batch.positions, batch.starts, holeStarts),
  };
}

export function createPathBatch(batch: FlatBatch): PathBatch {
  const count = checkFlatBatch(batch);
  return { count, positions: batch.positions, starts: batch.starts, colors: batch.colors };
}

export function createPointBatch(batch: {
  readonly positions: Float32Array;
  readonly colors: Uint8Array;
}): PointBatch {
  const count = batch.positions.length / 2;
  if (!Number.isInteger(count)) throw new RangeError("Point positions must be x and y pairs");
  if (batch.colors.length !== count * 4) {
    throw new RangeError("A point batch needs one RGBA colour for each point");
  }
  return { count, positions: batch.positions, colors: batch.colors };
}

function openRingLength(ring: ArrayLike<number>): number {
  const vertices = ring.length / 2;
  if (vertices <= minimumPolygonVertices) return vertices;
  const last = (vertices - 1) * 2;
  const closed = ring[0] === ring[last] && ring[1] === ring[last + 1];
  return closed ? vertices - 1 : vertices;
}

function flatten(
  items: readonly { readonly points: ArrayLike<number>; readonly color: Rgba }[],
  vertexCount: (points: ArrayLike<number>) => number,
): FlatBatch {
  const counts = items.map((item) => vertexCount(item.points));
  const starts = new Uint32Array(items.length + 1);
  for (let item = 0; item < items.length; item++) {
    starts[item + 1] = (starts[item] ?? 0) + (counts[item] ?? 0);
  }
  const positions = new Float32Array((starts[items.length] ?? 0) * 2);
  const colors = new Uint8Array(items.length * 4);
  items.forEach((item, index) => {
    const length = (counts[index] ?? 0) * 2;
    for (let value = 0; value < length; value++) {
      positions[(starts[index] ?? 0) * 2 + value] = item.points[value] ?? 0;
    }
    colors.set(item.color, index * 4);
  });
  return { positions, starts, colors };
}

export function polygonBatchFromRings(polygons: readonly PolygonInput[]): PolygonBatch {
  const groups = polygons.map(({ ring, holes }) => [
    ring,
    ...(holes ?? []).filter((hole) => openRingLength(hole) >= minimumPolygonVertices),
  ]);
  const lengths = groups.map((group) => group.map(openRingLength));
  const starts = new Uint32Array(polygons.length + 1);
  const holeStarts: number[] = [];
  let vertex = 0;
  lengths.forEach((group, polygon) => {
    group.forEach((length, member) => {
      if (member > 0) holeStarts.push(vertex);
      vertex += length;
    });
    starts[polygon + 1] = vertex;
  });
  const positions = new Float32Array(vertex * 2);
  const colors = new Uint8Array(polygons.length * 4);
  let cursor = 0;
  groups.forEach((group, polygon) => {
    group.forEach((ring, member) => {
      const length = (lengths[polygon]?.[member] ?? 0) * 2;
      for (let value = 0; value < length; value++) positions[cursor + value] = ring[value] ?? 0;
      cursor += length;
    });
    colors.set(polygons[polygon]?.color ?? [0, 0, 0, 0], polygon * 4);
  });
  return createPolygonBatch({
    positions,
    starts,
    colors,
    holeStarts: Uint32Array.from(holeStarts),
  });
}

export function pathBatchFromLines(lines: readonly LineInput[]): PathBatch {
  return createPathBatch(
    flatten(
      lines.map(({ line, color }) => ({ points: line, color })),
      (points) => points.length / 2,
    ),
  );
}

export function pointBatchFromPoints(points: readonly PointInput[]): PointBatch {
  const positions = new Float32Array(points.length * 2);
  const colors = new Uint8Array(points.length * 4);
  points.forEach((point, index) => {
    positions[index * 2] = point.x;
    positions[index * 2 + 1] = point.y;
    colors.set(point.color, index * 4);
  });
  return createPointBatch({ positions, colors });
}
