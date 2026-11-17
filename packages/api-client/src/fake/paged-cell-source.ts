export interface PagedCellSource {
  summary(): Promise<Uint8Array<ArrayBuffer>>;
  chunk(index: number): Promise<Uint8Array<ArrayBuffer>>;
}

export interface PagedCellSourceOptions {
  readonly cells: number;
  readonly classes?: number;
  readonly sides?: number;
  readonly spacing?: number;
  readonly tileCells?: number;
}

type Typed = Uint8Array | Uint16Array | Uint32Array | Float32Array;

type Field = { name: string; type: "u1" | "u2" | "u4" | "f4"; data: Typed };

const ALIGN = 8;

const pad = (length: number) => (ALIGN - (length % ALIGN)) % ALIGN;

function encode(
  header: Record<string, unknown>,
  fields: readonly Field[],
): Uint8Array<ArrayBuffer> {
  const described: unknown[] = [];
  let size = 0;
  for (const field of fields) {
    size += pad(size);
    described.push({ name: field.name, type: field.type, offset: size, length: field.data.length });
    size += field.data.byteLength;
  }
  const json = JSON.stringify({ ...header, fields: described });
  const head = new TextEncoder().encode(json + " ".repeat(pad(json.length + 8)));
  const out = new Uint8Array(8 + head.length + size);
  out.set([0x50, 0x46, 0x43, 0x31]);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  let cursor = 8 + head.length;
  let written = 0;
  for (const field of fields) {
    const gap = pad(written);
    cursor += gap;
    written += gap;
    const bytes = new Uint8Array(field.data.buffer, field.data.byteOffset, field.data.byteLength);
    out.set(bytes, cursor);
    cursor += bytes.length;
    written += bytes.length;
  }
  return out;
}

function hash(cell: number, salt: number): number {
  let mixed = Math.imul(cell + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x2c1b3c6d);
  mixed = Math.imul(mixed ^ (mixed >>> 12), 0x297a2d39);
  return ((mixed ^ (mixed >>> 15)) >>> 0) / 4294967296;
}

export function pagedCellSource(options: PagedCellSourceOptions): PagedCellSource {
  const count = options.cells;
  const classes = options.classes ?? 4;
  const sides = options.sides ?? 12;
  const spacing = options.spacing ?? 30;
  const perTile = options.tileCells ?? 68;
  const grid = perTile * spacing;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const tileColumns = Math.ceil(columns / perTile);
  const tileRows = Math.ceil(rows / perTile);

  const position = (cell: number) => ({
    x: (cell % columns) * spacing + spacing / 2 + (hash(cell, 1) - 0.5) * 16,
    y: Math.floor(cell / columns) * spacing + spacing / 2 + (hash(cell, 2) - 0.5) * 16,
  });
  const radius = (cell: number) => 2 + hash(cell, 3) * 2.5;
  const shares = (cell: number) => {
    const weights = Array.from({ length: classes }, (_, k) => hash(cell, 10 + k) ** 3 + 0.02);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight) => Math.round((255 * weight) / total));
  };
  const tileOf = (cell: number) =>
    Math.floor(Math.floor(cell / columns) / perTile) * tileColumns +
    Math.floor((cell % columns) / perTile);
  const cellsOfTile = (tile: number): number[] => {
    const tileColumn = tile % tileColumns;
    const tileRow = Math.floor(tile / tileColumns);
    const found: number[] = [];
    for (let row = tileRow * perTile; row < Math.min(rows, (tileRow + 1) * perTile); row++) {
      for (
        let column = tileColumn * perTile;
        column < Math.min(columns, (tileColumn + 1) * perTile);
        column++
      ) {
        const cell = row * columns + column;
        if (cell < count) found.push(cell);
      }
    }
    return found;
  };
  const tileIds: number[] = [];
  for (let tile = 0; tile < tileColumns * tileRows; tile++) {
    if (Math.floor(tile / tileColumns) * perTile * columns + (tile % tileColumns) * perTile < count)
      tileIds.push(tile);
  }
  const chunkOfTile = new Map(tileIds.map((tile, index) => [tile, index]));

  const topOf = (values: readonly number[]) => values.indexOf(Math.max(...values));

  function summary(): Uint8Array<ArrayBuffer> {
    const x = new Float32Array(count);
    const y = new Float32Array(count);
    const diagonal = new Uint16Array(count);
    const classIndex = new Uint8Array(count);
    const score = new Uint8Array(count);
    const flags = new Uint8Array(count);
    const chunkOf = new Uint16Array(count);
    const indexOf = new Uint16Array(count);
    const numbers = new Uint32Array(count);
    const probs = new Uint8Array(count * classes);
    const seen = new Map<number, number>();
    const classCounts = new Map<number, number[]>();
    const unsure = new Map<number, number>();
    for (let cell = 0; cell < count; cell++) {
      const at = position(cell);
      const values = shares(cell);
      const top = topOf(values);
      const tile = tileOf(cell);
      const local = seen.get(tile) ?? 0;
      seen.set(tile, local + 1);
      x[cell] = at.x;
      y[cell] = at.y;
      diagonal[cell] = Math.round(radius(cell) * 2.83);
      classIndex[cell] = top;
      score[cell] = values[top] ?? 0;
      chunkOf[cell] = chunkOfTile.get(tile) ?? 0;
      indexOf[cell] = local;
      numbers[cell] = cell + 1;
      probs.set(values, cell * classes);
      const perClass = classCounts.get(tile) ?? new Array<number>(classes).fill(0);
      perClass[top] = (perClass[top] ?? 0) + 1;
      classCounts.set(tile, perClass);
    }
    const entries = tileIds.map((tile, index) => {
      const members = cellsOfTile(tile);
      return {
        chunk: index,
        tile: [(tile % tileColumns) * grid, Math.floor(tile / tileColumns) * grid, grid, grid],
        count: members.length,
        vertices: members.length * sides,
        numbers: [(members[0] ?? 0) + 1, (members[members.length - 1] ?? 0) + 1],
        class_counts: classCounts.get(tile) ?? [],
        unclassified: 0,
        unsure: unsure.get(tile) ?? 0,
      };
    });
    return encode({ version: 1, kind: "cell-summary", count, classes, grid, chunks: entries }, [
      { name: "x", type: "f4", data: x },
      { name: "y", type: "f4", data: y },
      { name: "diagonal", type: "u2", data: diagonal },
      { name: "class", type: "u1", data: classIndex },
      { name: "score", type: "u1", data: score },
      { name: "flags", type: "u1", data: flags },
      { name: "chunk", type: "u2", data: chunkOf },
      { name: "index", type: "u2", data: indexOf },
      { name: "number", type: "u4", data: numbers },
      { name: "probs", type: "u1", data: probs },
    ]);
  }

  function chunk(index: number): Uint8Array<ArrayBuffer> {
    const tile = tileIds[index] ?? 0;
    const members = cellsOfTile(tile);
    const size = members.length;
    const number = new Uint32Array(size);
    const offsets = new Uint32Array(size + 1);
    const points = new Float32Array(size * sides * 2);
    const chunkClass = new Uint8Array(size);
    const chunkScore = new Uint8Array(size);
    const chunkProbs = new Uint8Array(size * classes);
    members.forEach((cell, local) => {
      const at = position(cell);
      const reach = radius(cell);
      const values = shares(cell);
      const top = topOf(values);
      number[local] = cell + 1;
      offsets[local + 1] = (local + 1) * sides;
      chunkClass[local] = top;
      chunkScore[local] = values[top] ?? 0;
      chunkProbs.set(values, local * classes);
      for (let side = 0; side < sides; side++) {
        const angle = (side / sides) * Math.PI * 2;
        points[(local * sides + side) * 2] = at.x + Math.cos(angle) * reach;
        points[(local * sides + side) * 2 + 1] = at.y + Math.sin(angle) * reach;
      }
    });
    return encode(
      {
        version: 1,
        kind: "cells",
        count: size,
        classes,
        chunk: index,
        tile: [(tile % tileColumns) * grid, Math.floor(tile / tileColumns) * grid, grid, grid],
      },
      [
        { name: "number", type: "u4", data: number },
        { name: "offsets", type: "u4", data: offsets },
        { name: "points", type: "f4", data: points },
        { name: "class", type: "u1", data: chunkClass },
        { name: "score", type: "u1", data: chunkScore },
        { name: "flags", type: "u1", data: new Uint8Array(size) },
        { name: "region", type: "u4", data: new Uint32Array(size) },
        { name: "probs", type: "u1", data: chunkProbs },
      ],
    );
  }

  return {
    summary: () => Promise.resolve(summary()),
    chunk: (index) => Promise.resolve(chunk(index)),
  };
}
