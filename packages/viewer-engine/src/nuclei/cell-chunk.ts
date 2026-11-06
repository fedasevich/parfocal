import { column, optionalColumn, PfcError, type PfcFile } from "./pfc.ts";

export interface CellChunk {
  readonly index: number;
  readonly count: number;
  readonly vertices: number;
  readonly number: Uint32Array;
  readonly offsets: Uint32Array;
  readonly points: Float32Array;
  readonly classIndex: Uint8Array;
  readonly score: Uint8Array;
  readonly flags: Uint8Array;
  readonly probs: Uint8Array | null;
  readonly altClass: Uint8Array | null;
  readonly byteLength: number;
}

export function readCellChunk(file: PfcFile, fallbackIndex: number): CellChunk {
  const { header } = file;
  if (header.kind !== "cells") throw new PfcError(`This is a ${header.kind} file`);
  const count = header.count;
  const offsets = column(file, "offsets", Uint32Array, 0);
  if (offsets.length !== count + 1) {
    throw new PfcError(`offsets has ${offsets.length} values for ${count} cells`);
  }
  const vertices = offsets[count] ?? 0;
  const points = column(file, "points", Float32Array, 0);
  if (points.length !== vertices * 2) throw new PfcError("offsets do not end at the last point");
  const classes = Number(header.classes ?? 0);
  const chunk: CellChunk = {
    index: typeof header.chunk === "number" ? header.chunk : fallbackIndex,
    count,
    vertices,
    number: column(file, "number", Uint32Array).slice(),
    offsets: offsets.slice(),
    points: points.slice(),
    classIndex: column(file, "class", Uint8Array).slice(),
    score: column(file, "score", Uint8Array).slice(),
    flags: column(file, "flags", Uint8Array).slice(),
    probs: optionalColumn(file, "probs", Uint8Array, classes)?.slice() ?? null,
    altClass: optionalColumn(file, "alt_class", Uint8Array)?.slice() ?? null,
    byteLength: 0,
  };
  return { ...chunk, byteLength: heldBytes(chunk) };
}

function heldBytes(chunk: CellChunk): number {
  return [
    chunk.number,
    chunk.offsets,
    chunk.points,
    chunk.classIndex,
    chunk.score,
    chunk.flags,
    chunk.probs,
    chunk.altClass,
  ].reduce((sum, array) => sum + (array?.byteLength ?? 0), 0);
}
