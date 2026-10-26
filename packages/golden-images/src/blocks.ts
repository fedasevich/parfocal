import type { Frame } from "./frame.ts";

export interface BlockReport {
  readonly blocks: number;
  readonly mixedBlocks: number;
  readonly neighbourPairs: number;
  readonly differingPairs: number;
}

function pixelAt(frame: Frame, x: number, y: number): number {
  const offset = (y * frame.width + x) * 4;
  return (
    (frame.data[offset] ?? 0) * 65_536 +
    (frame.data[offset + 1] ?? 0) * 256 +
    (frame.data[offset + 2] ?? 0)
  );
}

function isUniform(frame: Frame, left: number, top: number, size: number): boolean {
  const first = pixelAt(frame, left, top);
  for (let y = top; y < top + size; y++) {
    for (let x = left; x < left + size; x++) {
      if (pixelAt(frame, x, y) !== first) return false;
    }
  }
  return true;
}

export function blockReport(frame: Frame, size: number): BlockReport {
  if (!Number.isInteger(size) || size < 1) throw new Error(`A block needs a size, got ${size}`);
  const columns = Math.floor(frame.width / size);
  const rows = Math.floor(frame.height / size);
  const colours = new Int32Array(columns * rows).fill(-1);
  let mixedBlocks = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const left = column * size;
      const top = row * size;
      if (isUniform(frame, left, top, size))
        colours[row * columns + column] = pixelAt(frame, left, top);
      else mixedBlocks += 1;
    }
  }
  let neighbourPairs = 0;
  let differingPairs = 0;
  const compare = (a: number, b: number) => {
    if (a < 0 || b < 0) return;
    neighbourPairs += 1;
    if (a !== b) differingPairs += 1;
  };
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const here = colours[row * columns + column] ?? -1;
      if (column + 1 < columns) compare(here, colours[row * columns + column + 1] ?? -1);
      if (row + 1 < rows) compare(here, colours[(row + 1) * columns + column] ?? -1);
    }
  }
  return { blocks: columns * rows, mixedBlocks, neighbourPairs, differingPairs };
}
