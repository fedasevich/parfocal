export type Ring = Float32Array;

export const MASK_LEVEL = 0.45;

type Point = readonly [number, number];

function at(array: ArrayLike<number>, index: number): number {
  return array[index] ?? 0;
}

export function ringArea(ring: Ring): number {
  const count = ring.length / 2;
  let twice = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    twice += at(ring, i * 2) * at(ring, j * 2 + 1) - at(ring, j * 2) * at(ring, i * 2 + 1);
  }
  return Math.abs(twice) / 2;
}

export function blurMask(mask: Uint8Array, width: number, height: number): Float32Array {
  const horizontal = new Float32Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? at(mask, y * width + x - 1) : 0;
      const right = x < width - 1 ? at(mask, y * width + x + 1) : 0;
      horizontal[y * width + x] = (left + 2 * at(mask, y * width + x) + right) / 4;
    }
  }
  const out = new Float32Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const up = y > 0 ? at(horizontal, (y - 1) * width + x) : 0;
      const down = y < height - 1 ? at(horizontal, (y + 1) * width + x) : 0;
      out[y * width + x] = (up + 2 * at(horizontal, y * width + x) + down) / 4;
    }
  }
  return out;
}

export function traceContours(
  field: Float32Array,
  width: number,
  height: number,
  level = 0.5,
): Ring[] {
  const outside = level - 1;
  const value = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? outside : at(field, y * width + x);
  const stride = width + 2;
  const edgeKey = (x: number, y: number, vertical: boolean) =>
    ((y + 1) * stride + (x + 1)) * 2 + (vertical ? 1 : 0);
  const points = new Map<number, Point>();
  const links = new Map<number, number[]>();

  const crossing = (x: number, y: number, vertical: boolean): number => {
    const key = edgeKey(x, y, vertical);
    if (!points.has(key)) {
      const a = value(x, y);
      const b = vertical ? value(x, y + 1) : value(x + 1, y);
      const t = a === b ? 0.5 : Math.min(1, Math.max(0, (level - a) / (b - a)));
      points.set(key, vertical ? [x + 0.5, y + t + 0.5] : [x + t + 0.5, y + 0.5]);
    }
    return key;
  };
  const link = (a: number, b: number) => {
    const fromA = links.get(a);
    if (fromA) fromA.push(b);
    else links.set(a, [b]);
    const fromB = links.get(b);
    if (fromB) fromB.push(a);
    else links.set(b, [a]);
  };

  for (let y = -1; y < height; y++) {
    for (let x = -1; x < width; x++) {
      const topLeft = value(x, y) > level ? 1 : 0;
      const topRight = value(x + 1, y) > level ? 1 : 0;
      const bottomRight = value(x + 1, y + 1) > level ? 1 : 0;
      const bottomLeft = value(x, y + 1) > level ? 1 : 0;
      const code = (topLeft << 3) | (topRight << 2) | (bottomRight << 1) | bottomLeft;
      if (code === 0 || code === 15) continue;
      const top = () => crossing(x, y, false);
      const bottom = () => crossing(x, y + 1, false);
      const left = () => crossing(x, y, true);
      const right = () => crossing(x + 1, y, true);
      switch (code) {
        case 1:
        case 14:
          link(left(), bottom());
          break;
        case 2:
        case 13:
          link(bottom(), right());
          break;
        case 3:
        case 12:
          link(left(), right());
          break;
        case 4:
        case 11:
          link(top(), right());
          break;
        case 6:
        case 9:
          link(top(), bottom());
          break;
        case 7:
        case 8:
          link(left(), top());
          break;
        default: {
          const centre =
            (value(x, y) + value(x + 1, y) + value(x + 1, y + 1) + value(x, y + 1)) / 4 > level;
          if ((code === 5) === centre) {
            link(left(), top());
            link(bottom(), right());
          } else {
            link(left(), bottom());
            link(top(), right());
          }
        }
      }
    }
  }

  const visited = new Set<number>();
  const rings: Ring[] = [];
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let previous = -1;
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      loop.push(current);
      const next = (links.get(current) ?? []).find((key) => key !== previous && !visited.has(key));
      if (next === undefined) break;
      previous = current;
      current = next;
    }
    if (loop.length < 3) continue;
    const ring = new Float32Array(loop.length * 2);
    loop.forEach((key, index) => {
      const [x, y] = points.get(key) ?? [0, 0];
      ring[index * 2] = x;
      ring[index * 2 + 1] = y;
    });
    rings.push(ring);
  }
  return rings.sort((a, b) => ringArea(b) - ringArea(a));
}

export function traceContour(
  field: Float32Array,
  width: number,
  height: number,
  level = 0.5,
): Ring | null {
  return traceContours(field, width, height, level)[0] ?? null;
}

export function traceMask(mask: Uint8Array, width: number, height: number): Ring | null {
  return traceContour(blurMask(mask, width, height), width, height, MASK_LEVEL);
}

export function simplifyRing(ring: Ring, tolerance = 0.2): Ring {
  const count = ring.length / 2;
  if (count <= 4) return ring;
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < count; i++) {
    const distance = Math.hypot(at(ring, i * 2) - at(ring, 0), at(ring, i * 2 + 1) - at(ring, 1));
    if (distance > farDistance) {
      farDistance = distance;
      far = i;
    }
  }
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[far] = 1;

  const reduce = (from: number, to: number) => {
    const ax = at(ring, (from % count) * 2);
    const ay = at(ring, (from % count) * 2 + 1);
    const dx = at(ring, (to % count) * 2) - ax;
    const dy = at(ring, (to % count) * 2 + 1) - ay;
    const length = Math.hypot(dx, dy);
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = from + 1; i < to; i++) {
      const px = at(ring, i * 2);
      const py = at(ring, i * 2 + 1);
      const distance =
        length === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs(dy * (px - ax) - dx * (py - ay)) / length;
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = i;
      }
    }
    if (worst < 0) return;
    keep[worst] = 1;
    reduce(from, worst);
    reduce(worst, to);
  };
  reduce(0, far);
  reduce(far, count);

  const kept: number[] = [];
  for (let i = 0; i < count; i++) {
    if (keep[i]) kept.push(at(ring, i * 2), at(ring, i * 2 + 1));
  }
  return kept.length >= 6 ? new Float32Array(kept) : ring;
}
