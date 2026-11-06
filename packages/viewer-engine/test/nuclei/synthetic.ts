import { gzipSync } from "node:zlib";

type Typed = Uint8Array | Uint16Array | Uint32Array | Float32Array;

export interface EncodedField {
  readonly name: string;
  readonly type: "u1" | "u2" | "u4" | "f4";
  readonly data: Typed;
}

const ALIGN = 8;

function padding(length: number): number {
  return (ALIGN - (length % ALIGN)) % ALIGN;
}

export function encodePfc(
  header: Readonly<Record<string, unknown>>,
  fields: readonly EncodedField[],
): Uint8Array {
  const parts: Uint8Array[] = [];
  const described: unknown[] = [];
  let size = 0;
  for (const field of fields) {
    const gap = padding(size);
    parts.push(new Uint8Array(gap));
    size += gap;
    const bytes = new Uint8Array(field.data.buffer, field.data.byteOffset, field.data.byteLength);
    described.push({
      name: field.name,
      type: field.type,
      offset: size,
      length: field.data.length,
    });
    parts.push(bytes);
    size += bytes.length;
  }
  const json = JSON.stringify({ ...header, fields: described });
  const head = new TextEncoder().encode(json + " ".repeat(padding(json.length + 8)));
  const out = new Uint8Array(8 + head.length + size);
  out.set([0x50, 0x46, 0x43, 0x31]);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  let cursor = 8 + head.length;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

export function gzipped(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(gzipSync(bytes, { level: 6 }));
}

export interface SyntheticOptions {
  readonly cells: number;
  readonly classes?: number;
  readonly verticesPerCell?: number;
  readonly grid?: number;
  readonly spacing?: number;
  readonly withProbs?: boolean;
}

export interface SyntheticSlide {
  readonly cells: number;
  readonly width: number;
  readonly height: number;
  readonly chunks: number;
  readonly vertices: number;
  readonly summary: Uint8Array<ArrayBuffer>;
  chunk(index: number): Uint8Array<ArrayBuffer>;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticSlide(options: SyntheticOptions): SyntheticSlide {
  const count = options.cells;
  const classes = options.classes ?? 5;
  const sides = options.verticesPerCell ?? 19;
  const grid = options.grid ?? 2048;
  const spacing = options.spacing ?? 30;
  const withProbs = options.withProbs ?? true;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const width = columns * spacing;
  const height = rows * spacing;
  const tileColumns = Math.ceil(width / grid);
  const next = random(7);

  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const radius = new Float32Array(count);
  const classIndex = new Uint8Array(count);
  const score = new Uint8Array(count);
  const flags = new Uint8Array(count);
  const probs = new Uint8Array(withProbs ? count * classes : 0);
  const tileOf = new Uint32Array(count);
  const tileCounts = new Map<number, number>();
  for (let cell = 0; cell < count; cell++) {
    const cellX = (cell % columns) * spacing + spacing / 2 + (next() - 0.5) * 16;
    const cellY = Math.floor(cell / columns) * spacing + spacing / 2 + (next() - 0.5) * 16;
    x[cell] = cellX;
    y[cell] = cellY;
    radius[cell] = 2 + next() * 2.5;
    classIndex[cell] = Math.floor(next() * classes);
    score[cell] = Math.floor(next() * 256);
    flags[cell] = next() < 0.1 ? 1 : 0;
    if (withProbs) {
      for (let k = 0; k < classes; k++) probs[cell * classes + k] = Math.floor(next() * 256);
    }
    const tile = Math.floor(cellY / grid) * tileColumns + Math.floor(cellX / grid);
    tileOf[cell] = tile;
    tileCounts.set(tile, (tileCounts.get(tile) ?? 0) + 1);
  }

  const tileIds = [...tileCounts.keys()].sort((a, b) => a - b);
  const chunkOfTile = new Map(tileIds.map((tile, index) => [tile, index]));
  const members: number[][] = tileIds.map(() => []);
  const chunkOf = new Uint16Array(count);
  const indexOf = new Uint16Array(count);
  for (let cell = 0; cell < count; cell++) {
    const chunk = chunkOfTile.get(tileOf[cell] ?? 0) ?? 0;
    const list = members[chunk] ?? [];
    chunkOf[cell] = chunk;
    indexOf[cell] = list.length;
    list.push(cell);
  }

  const entries = tileIds.map((tile, index) => {
    const list = members[index] ?? [];
    const counts = new Array<number>(classes).fill(0);
    let unsure = 0;
    for (const cell of list) {
      counts[classIndex[cell] ?? 0] = (counts[classIndex[cell] ?? 0] ?? 0) + 1;
      unsure += (flags[cell] ?? 0) & 1;
    }
    return {
      chunk: index,
      tile: [(tile % tileColumns) * grid, Math.floor(tile / tileColumns) * grid, grid, grid],
      count: list.length,
      vertices: list.length * sides,
      numbers: [(list[0] ?? 0) + 1, (list[list.length - 1] ?? 0) + 1],
      class_counts: counts,
      unclassified: 0,
      unsure,
    };
  });

  const diagonal = new Uint16Array(count);
  const numbers = new Uint32Array(count);
  for (let cell = 0; cell < count; cell++) {
    diagonal[cell] = Math.round((radius[cell] ?? 0) * 2.83);
    numbers[cell] = cell + 1;
  }
  const summaryFields: EncodedField[] = [
    { name: "x", type: "f4", data: x },
    { name: "y", type: "f4", data: y },
    { name: "diagonal", type: "u2", data: diagonal },
    { name: "class", type: "u1", data: classIndex },
    { name: "score", type: "u1", data: score },
    { name: "flags", type: "u1", data: flags },
    { name: "chunk", type: "u2", data: chunkOf },
    { name: "index", type: "u2", data: indexOf },
    { name: "number", type: "u4", data: numbers },
  ];
  if (withProbs) summaryFields.push({ name: "probs", type: "u1", data: probs });
  const summary = gzipped(
    encodePfc(
      { version: 1, kind: "cell-summary", count, classes, grid, chunks: entries },
      summaryFields,
    ),
  );

  function chunk(index: number): Uint8Array<ArrayBuffer> {
    const list = members[index] ?? [];
    const size = list.length;
    const number = new Uint32Array(size);
    const offsets = new Uint32Array(size + 1);
    const points = new Float32Array(size * sides * 2);
    const chunkClass = new Uint8Array(size);
    const chunkScore = new Uint8Array(size);
    const chunkFlags = new Uint8Array(size);
    const region = new Uint32Array(size);
    const chunkProbs = new Uint8Array(withProbs ? size * classes : 0);
    list.forEach((cell, local) => {
      number[local] = cell + 1;
      offsets[local + 1] = (local + 1) * sides;
      chunkClass[local] = classIndex[cell] ?? 0;
      chunkScore[local] = score[cell] ?? 0;
      chunkFlags[local] = flags[cell] ?? 0;
      for (let side = 0; side < sides; side++) {
        const angle = (side / sides) * Math.PI * 2;
        points[(local * sides + side) * 2] = (x[cell] ?? 0) + Math.cos(angle) * (radius[cell] ?? 0);
        points[(local * sides + side) * 2 + 1] =
          (y[cell] ?? 0) + Math.sin(angle) * (radius[cell] ?? 0);
      }
      if (withProbs) {
        chunkProbs.set(probs.subarray(cell * classes, (cell + 1) * classes), local * classes);
      }
    });
    const fields: EncodedField[] = [
      { name: "number", type: "u4", data: number },
      { name: "offsets", type: "u4", data: offsets },
      { name: "points", type: "f4", data: points },
      { name: "class", type: "u1", data: chunkClass },
      { name: "score", type: "u1", data: chunkScore },
      { name: "flags", type: "u1", data: chunkFlags },
      { name: "region", type: "u4", data: region },
    ];
    if (withProbs) fields.push({ name: "probs", type: "u1", data: chunkProbs });
    return gzipped(
      encodePfc(
        {
          version: 1,
          kind: "cells",
          count: size,
          classes,
          chunk: index,
          tile: entries[index]?.tile,
        },
        fields,
      ),
    );
  }

  return {
    cells: count,
    width,
    height,
    chunks: entries.length,
    vertices: count * sides,
    summary,
    chunk,
  };
}
