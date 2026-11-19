import type { ClassPaint } from "./class-paint.ts";

type PickChunk = {
  readonly number: ArrayLike<number>;
  readonly offsets: ArrayLike<number>;
  readonly points: Float32Array;
  readonly score: ArrayLike<number>;
};

export type PickSource = {
  forEachLive(visit: (chunk: PickChunk, local: number, classIndex: number) => void): void;
};

export type PickedCell = {
  readonly id: string;
  readonly number: number;
  readonly typeName: string | null;
  readonly score: number;
  readonly ring: readonly number[];
};

export const pickSlopScreenPixels = 10;

function inside(ring: Float32Array, x: number, y: number): boolean {
  let hit = false;
  const count = ring.length / 2;
  for (let at = 0, back = count - 1; at < count; back = at, at += 1) {
    const ax = ring[at * 2] ?? 0;
    const ay = ring[at * 2 + 1] ?? 0;
    const bx = ring[back * 2] ?? 0;
    const by = ring[back * 2 + 1] ?? 0;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}

function centreDistance(ring: Float32Array, x: number, y: number): number {
  const count = ring.length / 2;
  let sumX = 0;
  let sumY = 0;
  for (let at = 0; at < count; at += 1) {
    sumX += ring[at * 2] ?? 0;
    sumY += ring[at * 2 + 1] ?? 0;
  }
  return Math.hypot(sumX / count - x, sumY / count - y);
}

export function cellAt(
  setId: string,
  cells: PickSource,
  paints: readonly (ClassPaint | undefined)[],
  at: { readonly x: number; readonly y: number },
  reach: number,
): PickedCell | null {
  let best = null as PickedCell | null;
  let bestDistance = Number.POSITIVE_INFINITY;
  cells.forEachLive((chunk, local, classIndex) => {
    const from = (chunk.offsets[local] ?? 0) * 2;
    const to = (chunk.offsets[local + 1] ?? 0) * 2;
    if (to - from < 6) return;
    const ring = chunk.points.subarray(from, to);
    const distance = centreDistance(ring, at.x, at.y);
    const covers = inside(ring, at.x, at.y);
    if (!covers && distance > reach) return;
    const rank = covers ? distance - reach : distance;
    if (rank >= bestDistance) return;
    bestDistance = rank;
    const number = chunk.number[local] ?? local;
    best = {
      id: `${setId}:${number}`,
      number,
      typeName: paints[classIndex]?.name ?? null,
      score: (chunk.score[local] ?? 255) / 255,
      ring: Array.from(ring),
    };
  });
  return best;
}
