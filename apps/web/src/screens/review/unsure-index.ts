import type { CellConfidence, PagedCells, UnsureCell } from "../../viewer/viewer-engine.ts";

export const INDEX_SQUARE = 128;
export const INDEX_BLOCK_WIDTH = 1600;
export const INDEX_BLOCK_HEIGHT = 1000;
export const INDEX_SQUARES_PER_BLOCK = 5;
export const INDEX_MIN_UNSURE = 4;
export const INDEX_SLICE = 25_000;

export type UnsureIndexDeps = {
  isUnsureCell: (confidence: CellConfidence | null, flags: number) => boolean;
  numberOfRow: (summary: PagedCells["summary"], row: number) => number;
  slice?: number;
  yieldNow?: () => Promise<void>;
};

type Square = { rows: number[]; topSum: number; block: number };

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function buildUnsureIndex(
  paged: PagedCells,
  deps: UnsureIndexDeps,
  stopped: () => boolean,
): Promise<UnsureCell[]> {
  const { summary } = paged;
  const slice = deps.slice ?? INDEX_SLICE;
  const yieldNow = deps.yieldNow ?? nextTask;
  const squares = new Map<string, Square>();
  for (let start = 0; start < summary.count; start += slice) {
    const end = Math.min(summary.count, start + slice);
    for (let row = start; row < end; row++) {
      if (!paged.rowIsLive(row)) continue;
      const confidence = paged.rowConfidence(row);
      if (!deps.isUnsureCell(confidence, summary.flags[row] ?? 0)) continue;
      const x = summary.x[row] ?? 0;
      const y = summary.y[row] ?? 0;
      const key = `${Math.floor(x / INDEX_SQUARE)}:${Math.floor(y / INDEX_SQUARE)}`;
      let square = squares.get(key);
      if (square === undefined) {
        const blockColumn = Math.floor(x / INDEX_BLOCK_WIDTH);
        const blockRow = Math.floor(y / INDEX_BLOCK_HEIGHT);
        square = { rows: [], topSum: 0, block: blockRow * 100_000 + blockColumn };
        squares.set(key, square);
      }
      square.rows.push(row);
      square.topSum += confidence?.top ?? 1;
    }
    if (stopped()) return [];
    await yieldNow();
  }
  const byBlock = new Map<number, Square[]>();
  for (const square of squares.values()) {
    if (square.rows.length < INDEX_MIN_UNSURE) continue;
    const list = byBlock.get(square.block) ?? [];
    list.push(square);
    byBlock.set(square.block, list);
  }
  const found: UnsureCell[] = [];
  for (const list of byBlock.values()) {
    list.sort(
      (a, b) =>
        b.rows.length - a.rows.length || a.topSum / a.rows.length - b.topSum / b.rows.length,
    );
    for (const square of list.slice(0, INDEX_SQUARES_PER_BLOCK)) {
      for (const row of square.rows) {
        found.push({
          number: deps.numberOfRow(summary, row),
          row,
          x: summary.x[row] ?? 0,
          y: summary.y[row] ?? 0,
          classIndex: paged.rowClass(row),
          confidence: paged.rowConfidence(row),
        });
      }
    }
  }
  return found;
}
