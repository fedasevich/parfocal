import type { Camera, SlideArea, SlideExtent, Viewport } from "../camera/camera.ts";
import { screenScale } from "../camera/camera.ts";
import { effectiveMagnification, type MicronsPerPixel } from "../camera/units.ts";

export const coverageMagnification = 10;
export const coverageBaseCell = 64;
export const coverageMaxSide = 1024;
const magnificationSlack = 1e-6;

export interface CoverageGrid {
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
}

export interface CoverageRaster {
  readonly grid: CoverageGrid;
  readonly seen: Uint8Array;
}

export interface TissueRaster {
  readonly grid: CoverageGrid;
  readonly tissue: Uint8Array;
}

export function coverageGrid(slide: SlideExtent): CoverageGrid {
  const longest = Math.max(1, slide.width, slide.height);
  let cell = coverageBaseCell;
  while (Math.ceil(longest / cell) > coverageMaxSide) cell *= 2;
  return {
    cell,
    columns: Math.max(1, Math.ceil(slide.width / cell)),
    rows: Math.max(1, Math.ceil(slide.height / cell)),
  };
}

export const cellCount = (grid: CoverageGrid) => grid.columns * grid.rows;

export const bitsetBytes = (grid: CoverageGrid) => Math.ceil(cellCount(grid) / 8);

export const sameGrid = (a: CoverageGrid, b: CoverageGrid) =>
  a.cell === b.cell && a.columns === b.columns && a.rows === b.rows;

export function emptyCoverage(grid: CoverageGrid): CoverageRaster {
  return { grid, seen: new Uint8Array(bitsetBytes(grid)) };
}

export const hasBit = (bits: Uint8Array, index: number) =>
  ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;

function setBit(bits: Uint8Array, index: number): boolean {
  const byte = index >> 3;
  const mask = 1 << (index & 7);
  const before = bits[byte] ?? 0;
  if ((before & mask) !== 0) return false;
  bits[byte] = before | mask;
  return true;
}

export const isSeen = (raster: CoverageRaster, column: number, row: number) =>
  column >= 0 &&
  row >= 0 &&
  column < raster.grid.columns &&
  row < raster.grid.rows &&
  hasBit(raster.seen, row * raster.grid.columns + column);

export function viewArea(camera: Camera, viewport: Viewport): SlideArea {
  const scale = screenScale(camera);
  const width = viewport.width / scale;
  const height = viewport.height / scale;
  return { x: camera.x - width / 2, y: camera.y - height / 2, width, height };
}

export function cellsInArea(grid: CoverageGrid, area: SlideArea): number[] {
  if (!(area.width > 0) || !(area.height > 0)) return [];
  const first = (start: number) => Math.max(0, Math.ceil(start / grid.cell - 0.5));
  const last = (end: number, count: number) =>
    Math.min(count - 1, Math.floor(end / grid.cell - 0.5));
  const left = first(area.x);
  const right = last(area.x + area.width, grid.columns);
  const top = first(area.y);
  const bottom = last(area.y + area.height, grid.rows);
  const cells: number[] = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) cells.push(row * grid.columns + column);
  }
  return cells;
}

export function markCells(raster: CoverageRaster, cells: Iterable<number>): number[] {
  const total = cellCount(raster.grid);
  const added: number[] = [];
  for (const index of cells) {
    if (Number.isInteger(index) && index >= 0 && index < total && setBit(raster.seen, index))
      added.push(index);
  }
  return added;
}

export function mergeCoverage(raster: CoverageRaster, other: CoverageRaster): number[] {
  if (!sameGrid(raster.grid, other.grid)) return [];
  const added: number[] = [];
  const total = cellCount(raster.grid);
  for (let byte = 0; byte < other.seen.length; byte += 1) {
    const fresh = (other.seen[byte] ?? 0) & ~(raster.seen[byte] ?? 0);
    if (fresh === 0) continue;
    for (let bit = 0; bit < 8; bit += 1) {
      const index = byte * 8 + bit;
      if ((fresh & (1 << bit)) !== 0 && index < total && setBit(raster.seen, index))
        added.push(index);
    }
  }
  return added;
}

function countBits(bits: Uint8Array, within: Uint8Array | null, total: number): number {
  let count = 0;
  for (let index = 0; index < total; index += 1) {
    if (hasBit(bits, index) && (within === null || hasBit(within, index))) count += 1;
  }
  return count;
}

export interface CoverageShare {
  readonly seen: number;
  readonly of: number;
  readonly share: number;
  readonly basis: "tissue" | "slide";
}

export function coverageShare(
  raster: CoverageRaster,
  tissue: TissueRaster | null = null,
): CoverageShare {
  const total = cellCount(raster.grid);
  const mask = tissue !== null && sameGrid(tissue.grid, raster.grid) ? tissue.tissue : null;
  const of = mask === null ? total : countBits(mask, null, total);
  const seen = countBits(raster.seen, mask, total);
  return {
    seen,
    of,
    share: of === 0 ? 0 : seen / of,
    basis: mask === null ? "slide" : "tissue",
  };
}

export const coveragePercent = (share: CoverageShare) => Math.round(share.share * 100);

export function tissueOnGrid(
  grid: CoverageGrid,
  mask: { readonly cell: number; readonly columns: number; readonly rows: number },
  isTissue: (column: number, row: number) => boolean,
): TissueRaster {
  const tissue = new Uint8Array(bitsetBytes(grid));
  for (let row = 0; row < mask.rows; row += 1) {
    for (let column = 0; column < mask.columns; column += 1) {
      if (!isTissue(column, row)) continue;
      const x = Math.floor(((column + 0.5) * mask.cell) / grid.cell);
      const y = Math.floor(((row + 0.5) * mask.cell) / grid.cell);
      if (x < grid.columns && y < grid.rows) setBit(tissue, y * grid.columns + x);
    }
  }
  return { grid, tissue };
}

export function seesCoverage(camera: Camera, micronsPerPixel: MicronsPerPixel): boolean {
  const magnification = effectiveMagnification(camera.zoom, micronsPerPixel);
  return magnification !== null && magnification >= coverageMagnification - magnificationSlack;
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBits(bits: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bits.length; index += 3) {
    const a = bits[index] ?? 0;
    const b = bits[index + 1] ?? 0;
    const c = bits[index + 2] ?? 0;
    const word = (a << 16) | (b << 8) | c;
    text += alphabet[(word >> 18) & 63];
    text += alphabet[(word >> 12) & 63];
    text += index + 1 < bits.length ? alphabet[(word >> 6) & 63] : "=";
    text += index + 2 < bits.length ? alphabet[word & 63] : "=";
  }
  return text;
}

export function decodeBits(text: string, length: number): Uint8Array {
  const bits = new Uint8Array(length);
  const clean = text.replace(/=+$/, "");
  let byte = 0;
  for (let index = 0; index < clean.length && byte < length; index += 4) {
    const values = [0, 1, 2, 3].map((offset) => {
      const value = alphabet.indexOf(clean[index + offset] ?? "A");
      return value < 0 ? 0 : value;
    });
    const word =
      ((values[0] ?? 0) << 18) |
      ((values[1] ?? 0) << 12) |
      ((values[2] ?? 0) << 6) |
      (values[3] ?? 0);
    for (const shift of [16, 8, 0]) {
      if (byte < length) bits[byte] = (word >> shift) & 255;
      byte += 1;
    }
  }
  return bits;
}
