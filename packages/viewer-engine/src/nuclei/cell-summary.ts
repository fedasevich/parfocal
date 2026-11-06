import { column, optionalColumn, PfcError, type PfcFile } from "./pfc.ts";

export const UNCLASSIFIED = 255;
export const NO_ALTERNATIVE = 255;
export const UNSURE_FLAG = 1;

export type Rect = readonly [left: number, top: number, right: number, bottom: number];

export interface ChunkEntry {
  readonly chunk: number;
  readonly tile: Rect;
  readonly count: number;
  readonly vertices: number;
  readonly firstNumber: number;
  readonly lastNumber: number;
  readonly classCounts: readonly number[];
  readonly unclassified: number;
  readonly unsure: number;
}

export interface CellSummary {
  readonly count: number;
  readonly classes: number;
  readonly grid: number;
  readonly chunks: readonly ChunkEntry[];
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly diagonal: Uint16Array;
  readonly classIndex: Uint8Array;
  readonly score: Uint8Array;
  readonly flags: Uint8Array;
  readonly chunk: Uint16Array;
  readonly index: Uint16Array;
  readonly number: Uint32Array | null;
  readonly probs: Uint8Array | null;
  readonly altClass: Uint8Array | null;
  readonly byteLength: number;
}

function entryOf(item: unknown): ChunkEntry {
  const raw = item as {
    chunk?: number;
    tile?: number[];
    count?: number;
    vertices?: number;
    numbers?: number[];
    class_counts?: number[];
    unclassified?: number;
    unsure?: number;
  };
  const { tile, numbers } = raw;
  if (
    typeof raw.chunk !== "number" ||
    tile?.length !== 4 ||
    typeof raw.count !== "number" ||
    typeof raw.vertices !== "number" ||
    numbers?.length !== 2
  ) {
    throw new PfcError("A chunk in the summary index is incomplete");
  }
  const [x = 0, y = 0, width = 0, height = 0] = tile;
  return {
    chunk: raw.chunk,
    tile: [x, y, x + width, y + height],
    count: raw.count,
    vertices: raw.vertices,
    firstNumber: numbers[0] ?? 0,
    lastNumber: numbers[1] ?? 0,
    classCounts: raw.class_counts ?? [],
    unclassified: raw.unclassified ?? 0,
    unsure: raw.unsure ?? 0,
  };
}

export function readCellSummary(file: PfcFile): CellSummary {
  const { header } = file;
  if (header.kind !== "cell-summary") throw new PfcError(`This is a ${header.kind} file`);
  const classes = Number(header.classes ?? 0);
  const entries = Array.isArray(header.chunks) ? header.chunks.map(entryOf) : [];
  return {
    count: header.count,
    classes,
    grid: Number(header.grid ?? 0),
    chunks: entries.sort((a, b) => a.chunk - b.chunk),
    x: column(file, "x", Float32Array),
    y: column(file, "y", Float32Array),
    diagonal: column(file, "diagonal", Uint16Array),
    classIndex: column(file, "class", Uint8Array),
    score: column(file, "score", Uint8Array),
    flags: column(file, "flags", Uint8Array),
    chunk: column(file, "chunk", Uint16Array),
    index: column(file, "index", Uint16Array),
    number: optionalColumn(file, "number", Uint32Array),
    probs: optionalColumn(file, "probs", Uint8Array, classes),
    altClass: optionalColumn(file, "alt_class", Uint8Array),
    byteLength: file.byteLength,
  };
}

export function numberOfRow(summary: CellSummary, row: number): number {
  return summary.number ? (summary.number[row] ?? 0) : row + 1;
}

export function rowOfNumber(summary: CellSummary, cellNumber: number): number {
  if (!summary.number) {
    return cellNumber >= 1 && cellNumber <= summary.count ? cellNumber - 1 : -1;
  }
  let low = 0;
  let high = summary.count - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const found = summary.number[middle] ?? 0;
    if (found === cellNumber) return middle;
    if (found < cellNumber) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}
