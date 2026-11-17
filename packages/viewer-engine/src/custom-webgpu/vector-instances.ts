import type { PolygonBatch } from "../overlay/batch-types.ts";
import type { ShapeData } from "../overlay/types.ts";
import {
  pointInstanceBytes,
  type SetCounts,
  segmentInstanceBytes,
  triangleInstanceBytes,
} from "./protocol.ts";

export { pointInstanceBytes, segmentInstanceBytes, triangleInstanceBytes } from "./protocol.ts";

export interface VectorInstances {
  readonly data: ArrayBuffer;
  readonly counts: SetCounts;
}

export interface VectorInstanceOptions {
  readonly ringsFromMidFirstEdge?: boolean;
}

const smallestRing = 3;

const repeatSegments = 2;

function ringEnds(starts: Uint32Array, holeStarts: Uint32Array): number[] {
  const ends = new Set<number>();
  for (let index = 1; index < starts.length; index++) ends.add(starts[index] ?? 0);
  for (const start of holeStarts) ends.add(start);
  return [...ends].sort((a, b) => a - b);
}

function ringSegments(vertices: number, fromMiddle: boolean): number {
  if (vertices < 2) return 0;
  return fromMiddle && vertices >= smallestRing ? vertices + 1 : vertices;
}

export interface ShapeInstanceStarts {
  readonly triangles: Uint32Array;
  readonly segments: Uint32Array;
  readonly repeats: Uint32Array;
}

export function shapeInstanceStarts(
  polygons: PolygonBatch,
  options: VectorInstanceOptions = {},
): ShapeInstanceStarts {
  const fromMiddle = options.ringsFromMidFirstEdge === true;
  const { count, starts, holeStarts, indices } = polygons;
  const triangles = new Uint32Array(count + 1);
  const segments = new Uint32Array(count + 1);
  const repeats = new Uint32Array(count + 1);
  let index = 0;
  let from = 0;
  const ends = ringEnds(starts, holeStarts);
  let ring = 0;
  for (let shape = 0; shape < count; shape++) {
    const end = starts[shape + 1] ?? 0;
    let triangleCount = 0;
    while (index < indices.length && (indices[index] ?? 0) < end) {
      index += 3;
      triangleCount += 1;
    }
    let segmentTotal = 0;
    let repeatTotal = 0;
    while (ring < ends.length && (ends[ring] ?? 0) <= end) {
      const to = ends[ring] ?? 0;
      segmentTotal += ringSegments(to - from, fromMiddle);
      if (!fromMiddle && to - from >= smallestRing) repeatTotal += repeatSegments;
      from = to;
      ring += 1;
    }
    triangles[shape + 1] = (triangles[shape] ?? 0) + triangleCount;
    segments[shape + 1] = (segments[shape] ?? 0) + segmentTotal;
    repeats[shape + 1] = (repeats[shape] ?? 0) + repeatTotal;
  }
  return { triangles, segments, repeats };
}

function repeatCount(shapes: ShapeData, fromMiddle: boolean): number {
  if (fromMiddle || !shapes.polygons) return 0;
  let count = 0;
  let from = 0;
  for (const to of ringEnds(shapes.polygons.starts, shapes.polygons.holeStarts)) {
    if (to - from >= smallestRing) count += repeatSegments;
    from = to;
  }
  return count;
}

function segmentCount(shapes: ShapeData, fromMiddle: boolean): number {
  let count = 0;
  if (shapes.polygons) {
    let from = 0;
    for (const to of ringEnds(shapes.polygons.starts, shapes.polygons.holeStarts)) {
      count += ringSegments(to - from, fromMiddle);
      from = to;
    }
  }
  if (shapes.paths) {
    const { starts } = shapes.paths;
    for (let path = 0; path + 1 < starts.length; path++) {
      const vertices = (starts[path + 1] ?? 0) - (starts[path] ?? 0);
      if (vertices >= 2) count += vertices;
    }
  }
  return count;
}

function ownerOfVertex(starts: Uint32Array): Uint32Array {
  const owners = new Uint32Array(starts[starts.length - 1] ?? 0);
  for (let item = 0; item + 1 < starts.length; item++) {
    owners.fill(item, starts[item] ?? 0, starts[item + 1] ?? 0);
  }
  return owners;
}

export function buildVectorInstances(
  shapes: ShapeData,
  options: VectorInstanceOptions = {},
): VectorInstances {
  const fromMiddle = options.ringsFromMidFirstEdge === true;
  const triangles = shapes.polygons ? Math.floor(shapes.polygons.indices.length / 3) : 0;
  const segments = segmentCount(shapes, fromMiddle);
  const points = shapes.points?.count ?? 0;
  const repeats = repeatCount(shapes, fromMiddle);
  const data = new ArrayBuffer(
    triangles * triangleInstanceBytes +
      (segments + repeats) * segmentInstanceBytes +
      points * pointInstanceBytes,
  );
  const floats = new Float32Array(data);
  const words = new Uint32Array(data);
  const bytes = new Uint8Array(data);
  let cursor = 0;

  const putFloat = (value: number) => {
    floats[cursor / 4] = value;
    cursor += 4;
  };
  const putColor = (colors: Uint8Array, item: number) => {
    bytes.set(colors.subarray(item * 4, item * 4 + 4), cursor);
    cursor += 4;
  };

  let travelled = 0;
  let ring = 0;
  const putSegment = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    colors: Uint8Array,
    item: number,
  ) => {
    putFloat(ax);
    putFloat(ay);
    putFloat(bx);
    putFloat(by);
    putFloat(travelled);
    putColor(colors, item);
    words[cursor / 4] = ring;
    cursor += 4;
    travelled += Math.hypot(bx - ax, by - ay);
  };

  if (shapes.polygons) {
    const { positions, starts, holeStarts, indices, colors } = shapes.polygons;
    const x = (vertex: number) => positions[vertex * 2] ?? 0;
    const y = (vertex: number) => positions[vertex * 2 + 1] ?? 0;
    const owners = ownerOfVertex(starts);
    for (let triangle = 0; triangle < triangles; triangle++) {
      const first = indices[triangle * 3] ?? 0;
      for (let corner = 0; corner < 3; corner++) {
        const vertex = indices[triangle * 3 + corner] ?? 0;
        putFloat(x(vertex));
        putFloat(y(vertex));
      }
      putColor(colors, owners[first] ?? 0);
    }
    let from = 0;
    for (const to of ringEnds(starts, holeStarts)) {
      const vertices = to - from;
      const owner = owners[from] ?? 0;
      travelled = 0;
      if (vertices >= 2) {
        const split = fromMiddle && vertices >= smallestRing;
        const middleX = (x(from) + x(from + 1)) / 2;
        const middleY = (y(from) + y(from + 1)) / 2;
        if (split) putSegment(middleX, middleY, x(from + 1), y(from + 1), colors, owner);
        for (let vertex = split ? from + 1 : from; vertex < to; vertex++) {
          const next = vertex + 1 < to ? vertex + 1 : from;
          putSegment(x(vertex), y(vertex), x(next), y(next), colors, owner);
        }
        if (split) putSegment(x(from), y(from), middleX, middleY, colors, owner);
        ring += 1;
      }
      from = to;
    }
  }

  if (shapes.paths) {
    const { positions, starts, colors } = shapes.paths;
    for (let path = 0; path + 1 < starts.length; path++) {
      const from = starts[path] ?? 0;
      const to = starts[path + 1] ?? 0;
      if (to - from < 2) continue;
      const x = (vertex: number) => positions[vertex * 2] ?? 0;
      const y = (vertex: number) => positions[vertex * 2 + 1] ?? 0;
      travelled = 0;
      for (let vertex = from; vertex + 1 < to; vertex++) {
        putSegment(x(vertex), y(vertex), x(vertex + 1), y(vertex + 1), colors, path);
      }
      putSegment(x(to - 1), y(to - 1), x(to - 1), y(to - 1), colors, path);
      ring += 1;
    }
  }

  if (repeats > 0 && shapes.polygons) {
    const { positions, starts, holeStarts, colors } = shapes.polygons;
    const owners = ownerOfVertex(starts);
    let from = 0;
    for (const to of ringEnds(starts, holeStarts)) {
      if (to - from >= smallestRing) {
        travelled = 0;
        putSegment(
          positions[from * 2] ?? 0,
          positions[from * 2 + 1] ?? 0,
          positions[from * 2 + 2] ?? 0,
          positions[from * 2 + 3] ?? 0,
          colors,
          owners[from] ?? 0,
        );
        putSegment(
          positions[from * 2 + 2] ?? 0,
          positions[from * 2 + 3] ?? 0,
          positions[from * 2 + 2] ?? 0,
          positions[from * 2 + 3] ?? 0,
          colors,
          owners[from] ?? 0,
        );
        ring += 1;
      }
      from = to;
    }
  }

  if (shapes.points) {
    const { positions, colors } = shapes.points;
    for (let point = 0; point < points; point++) {
      putFloat(positions[point * 2] ?? 0);
      putFloat(positions[point * 2 + 1] ?? 0);
      putColor(colors, point);
    }
  }

  return { data, counts: { triangles, segments, repeats, points } };
}
