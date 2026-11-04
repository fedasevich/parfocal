import type { CoverageRaster } from "./viewer-engine.ts";

export type SeenRun = { row: number; start: number; length: number };

export function seenRuns(raster: CoverageRaster): SeenRun[] {
  const { columns, rows } = raster.grid;
  const runs: SeenRun[] = [];
  for (let row = 0; row < rows; row += 1) {
    let start = -1;
    for (let column = 0; column <= columns; column += 1) {
      const index = row * columns + column;
      const seen = column < columns && ((raster.seen[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
      if (seen && start < 0) start = column;
      if (!seen && start >= 0) {
        runs.push({ row, start, length: column - start });
        start = -1;
      }
    }
  }
  return runs;
}

export const runCells = (runs: readonly SeenRun[]) =>
  runs.reduce((total, run) => total + run.length, 0);
