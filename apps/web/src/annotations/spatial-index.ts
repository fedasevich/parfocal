export interface BoundsIndex {
  readonly size: number;
  query(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    visit: (item: number) => void,
  ): void;
}

const itemsPerCell = 2;
const maxCellsPerAxis = 2048;
const spanLimit = 64;

export function buildBoundsIndex(bounds: Float32Array, active?: Uint8Array): BoundsIndex {
  const size = bounds.length >> 2;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let live = 0;
  for (let i = 0; i < size; i++) {
    if (active && active[i] === 0) continue;
    live++;
    const o = i << 2;
    minX = Math.min(minX, bounds[o] ?? 0);
    minY = Math.min(minY, bounds[o + 1] ?? 0);
    maxX = Math.max(maxX, bounds[o + 2] ?? 0);
    maxY = Math.max(maxY, bounds[o + 3] ?? 0);
  }
  if (live === 0) return { size, query: () => undefined };

  const width = Math.max(maxX - minX, 1e-6);
  const height = Math.max(maxY - minY, 1e-6);
  const cellCount = Math.max(1, live / itemsPerCell);
  const cell = Math.sqrt((width * height) / cellCount) || Math.max(width, height);
  const columns = Math.max(1, Math.min(maxCellsPerAxis, Math.ceil(width / cell)));
  const rows = Math.max(1, Math.min(maxCellsPerAxis, Math.ceil(height / cell)));
  const cellWidth = width / columns;
  const cellHeight = height / rows;

  const column = (x: number) =>
    Math.min(columns - 1, Math.max(0, Math.floor((x - minX) / cellWidth)));
  const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cellHeight)));

  const starts = new Uint32Array(columns * rows + 1);
  const large: number[] = [];
  const spanOf = (o: number) => {
    const c0 = column(bounds[o] ?? 0);
    const c1 = column(bounds[o + 2] ?? 0);
    const r0 = row(bounds[o + 1] ?? 0);
    const r1 = row(bounds[o + 3] ?? 0);
    return { c0, c1, r0, r1, cells: (c1 - c0 + 1) * (r1 - r0 + 1) };
  };

  for (let i = 0; i < size; i++) {
    if (active && active[i] === 0) continue;
    const span = spanOf(i << 2);
    if (span.cells > spanLimit) {
      large.push(i);
      continue;
    }
    for (let r = span.r0; r <= span.r1; r++) {
      for (let c = span.c0; c <= span.c1; c++) starts[r * columns + c + 1]++;
    }
  }
  for (let k = 0; k < columns * rows; k++) starts[k + 1] = (starts[k + 1] ?? 0) + (starts[k] ?? 0);
  const items = new Uint32Array(starts[columns * rows] ?? 0);
  const cursor = starts.slice(0, columns * rows);
  for (let i = 0; i < size; i++) {
    if (active && active[i] === 0) continue;
    const span = spanOf(i << 2);
    if (span.cells > spanLimit) continue;
    for (let r = span.r0; r <= span.r1; r++) {
      for (let c = span.c0; c <= span.c1; c++) {
        const slot = r * columns + c;
        items[cursor[slot] ?? 0] = i;
        cursor[slot] = (cursor[slot] ?? 0) + 1;
      }
    }
  }

  const stamps = new Uint32Array(size);
  let generation = 0;

  return {
    size,
    query(qMinX, qMinY, qMaxX, qMaxY, visit) {
      generation++;
      const offer = (item: number) => {
        if (stamps[item] === generation) return;
        stamps[item] = generation;
        const o = item << 2;
        if (
          (bounds[o] ?? 0) <= qMaxX &&
          (bounds[o + 2] ?? 0) >= qMinX &&
          (bounds[o + 1] ?? 0) <= qMaxY &&
          (bounds[o + 3] ?? 0) >= qMinY
        ) {
          visit(item);
        }
      };
      if (qMaxX >= minX && qMinX <= maxX && qMaxY >= minY && qMinY <= maxY) {
        const r1 = row(qMaxY);
        const c1 = column(qMaxX);
        for (let r = row(qMinY); r <= r1; r++) {
          for (let c = column(qMinX); c <= c1; c++) {
            const slot = r * columns + c;
            const end = starts[slot + 1] ?? 0;
            for (let k = starts[slot] ?? 0; k < end; k++) offer(items[k] ?? 0);
          }
        }
      }
      for (const item of large) offer(item);
    },
  };
}
