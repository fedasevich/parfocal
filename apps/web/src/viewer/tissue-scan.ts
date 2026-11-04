import {
  advanceScan,
  type Box,
  currentField,
  fieldCentre,
  type Scan,
  type ScanField,
  startScan,
} from "@parfocal/ui/lib/systematic-scan";

export type ScanGrid = { readonly cell: number; readonly columns: number; readonly rows: number };

export type ScanTissue = { readonly grid: ScanGrid; readonly tissue: Uint8Array };

export type ScanCamera = { readonly x: number; readonly y: number; readonly zoom: number };

export const scanOverlapShare = 0.05;

const hasBit = (bits: Uint8Array, index: number) =>
  ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;

function tissueSums({ grid, tissue }: ScanTissue): Int32Array {
  const width = grid.columns + 1;
  const sums = new Int32Array(width * (grid.rows + 1));
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const here = hasBit(tissue, row * grid.columns + column) ? 1 : 0;
      sums[(row + 1) * width + column + 1] =
        here +
        (sums[row * width + column + 1] ?? 0) +
        (sums[(row + 1) * width + column] ?? 0) -
        (sums[row * width + column] ?? 0);
    }
  }
  return sums;
}

function tissueExtentOf({ grid, tissue }: ScanTissue): Box | null {
  let left = grid.columns;
  let right = -1;
  let top = grid.rows;
  let bottom = -1;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      if (!hasBit(tissue, row * grid.columns + column)) continue;
      left = Math.min(left, column);
      right = Math.max(right, column);
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
    }
  }
  if (right < 0) return null;
  return {
    x: left * grid.cell,
    y: top * grid.cell,
    width: (right - left + 1) * grid.cell,
    height: (bottom - top + 1) * grid.cell,
  };
}

export function tissueCentresIn(tissue: ScanTissue, sums: Int32Array, box: Box): number {
  const { cell, columns, rows } = tissue.grid;
  const left = Math.max(0, Math.ceil(box.x / cell - 0.5));
  const right = Math.min(columns - 1, Math.floor((box.x + box.width) / cell - 0.5));
  const top = Math.max(0, Math.ceil(box.y / cell - 0.5));
  const bottom = Math.min(rows - 1, Math.floor((box.y + box.height) / cell - 0.5));
  if (right < left || bottom < top) return 0;
  const width = columns + 1;
  const at = (row: number, column: number) => sums[row * width + column] ?? 0;
  return at(bottom + 1, right + 1) - at(top, right + 1) - at(bottom + 1, left) + at(top, left);
}

export function tissueScanPath(
  tissue: ScanTissue,
  field: { readonly width: number; readonly height: number },
): ScanField[] {
  const extent = tissueExtentOf(tissue);
  if (extent === null || !(field.width > 0) || !(field.height > 0)) return [];
  const sums = tissueSums(tissue);
  const columns = Math.ceil(extent.width / field.width);
  const rows = Math.ceil(extent.height / field.height);
  const path: ScanField[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const box = {
        x: extent.x + column * field.width,
        y: extent.y + row * field.height,
        width: field.width,
        height: field.height,
      };
      if (tissueCentresIn(tissue, sums, box) > 0)
        path.push({ ...box, index: path.length, row, column });
    }
  }
  return path;
}

export function scanFieldAt(
  viewport: { readonly width: number; readonly height: number },
  zoom: number,
): { width: number; height: number } {
  const scale = 2 ** zoom;
  const keep = 1 - scanOverlapShare;
  return { width: (viewport.width / scale) * keep, height: (viewport.height / scale) * keep };
}

export function nextScan(
  scan: Scan | null,
  tissue: ScanTissue,
  viewport: { readonly width: number; readonly height: number },
  zoom: number,
): { scan: Scan; camera: ScanCamera | null } {
  const next = scan
    ? advanceScan(scan)
    : startScan(tissueScanPath(tissue, scanFieldAt(viewport, zoom)));
  const field = currentField(next);
  if (field === null) return { scan: next, camera: null };
  const [x, y] = fieldCentre(field);
  return { scan: next, camera: { x, y, zoom } };
}
