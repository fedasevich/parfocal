import type { TypedOutline } from "./viewer-engine.ts";

type Grid = { readonly cell: number; readonly columns: number; readonly rows: number };

type Tissue = { readonly grid: Grid; readonly tissue: Uint8Array };

const classes = ["tumor", "stroma", "immune", "other"] as const;

const probabilities: readonly (readonly [top: number, second: number])[] = [
  [0.97, 0.02],
  [0.86, 0.1],
  [0.72, 0.2],
  [0.6, 0.55],
  [0.48, 0.3],
  [0.42, 0.38],
  [0.33, 0.3],
];

export const sampleOutlineLimit = 400;

const sides = 10;

function ringAt(x: number, y: number, radius: number, seed: number): Float32Array {
  const ring = new Float32Array(sides * 2);
  for (let corner = 0; corner < sides; corner += 1) {
    const angle = (corner / sides) * Math.PI * 2;
    const wobble = 1 + 0.18 * Math.sin(seed * 1.7 + corner * 2.3);
    ring[corner * 2] = x + Math.cos(angle) * radius * wobble;
    ring[corner * 2 + 1] = y + Math.sin(angle) * radius * wobble;
  }
  return ring;
}

const hasBit = (bits: Uint8Array, index: number) =>
  ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;

export function sampleOutlines(grid: Grid, tissue: Tissue | null): TypedOutline[] {
  const cells: number[] = [];
  for (let index = 0; index < grid.columns * grid.rows; index += 1) {
    if (tissue === null || hasBit(tissue.tissue, index)) cells.push(index);
  }
  const step = Math.max(1, Math.ceil(cells.length / sampleOutlineLimit));
  const outlines: TypedOutline[] = [];
  for (let at = 0; at < cells.length; at += step) {
    const index = cells[at] ?? 0;
    const [top, second] = probabilities[outlines.length % probabilities.length] ?? [0.9, 0.05];
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    outlines.push({
      ring: ringAt((column + 0.5) * grid.cell, (row + 0.5) * grid.cell, grid.cell * 0.3, index),
      className: classes[(column + row) % classes.length] ?? "tumor",
      top,
      second,
    });
  }
  return outlines;
}
