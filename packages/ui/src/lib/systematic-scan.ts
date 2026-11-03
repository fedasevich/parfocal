export const scanMagnification = 10;

export type TissueMask = {
  cell: number;
  rows: readonly string[];
};

export type Box = { x: number; y: number; width: number; height: number };

export type ScanField = Box & { index: number; row: number; column: number };

export type Scan = { path: readonly ScanField[]; step: number };

export type ScanSummary = { step: number; fields: number; coverage: number };

export const tissueMark = "#";

export function tissueBoxes(mask: TissueMask): Box[] {
  return mask.rows.flatMap((line, row) =>
    line
      .split("")
      .flatMap((mark, column) =>
        mark === tissueMark
          ? [{ x: column * mask.cell, y: row * mask.cell, width: mask.cell, height: mask.cell }]
          : [],
      ),
  );
}

export function overlap(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

export function tissueExtent(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function scanPath(mask: TissueMask, field: { width: number; height: number }): ScanField[] {
  const tissue = tissueBoxes(mask);
  const extent = tissueExtent(tissue);
  if (extent === null || field.width <= 0 || field.height <= 0) return [];
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
      if (tissue.some((cell) => overlap(cell, box) > 0))
        path.push({ ...box, index: path.length, row, column });
    }
  }
  return path;
}

export function scanCoverage(mask: TissueMask, path: readonly ScanField[], step: number): number {
  const tissue = tissueBoxes(mask);
  const total = tissue.reduce((sum, cell) => sum + cell.width * cell.height, 0);
  if (total === 0) return 0;
  const seen = path.slice(0, Math.max(0, step));
  const covered = tissue.reduce(
    (sum, cell) => sum + seen.reduce((inner, box) => inner + overlap(cell, box), 0),
    0,
  );
  return Math.min(1, covered / total);
}

export const startScan = (path: readonly ScanField[]): Scan => ({
  path,
  step: path.length ? 1 : 0,
});

export const advanceScan = (scan: Scan): Scan => ({
  ...scan,
  step: Math.min(scan.path.length, scan.step + 1),
});

export const currentField = (scan: Scan | null): ScanField | null =>
  scan && scan.step > 0 ? (scan.path[scan.step - 1] ?? null) : null;

export const scanDone = (scan: Scan | null) =>
  scan !== null && scan.path.length > 0 && scan.step >= scan.path.length;

export const fieldCentre = (field: Box): [number, number] => [
  field.x + field.width / 2,
  field.y + field.height / 2,
];

export function scanSummary(mask: TissueMask, scan: Scan | null): ScanSummary | null {
  if (scan === null) return null;
  return {
    step: scan.step,
    fields: scan.path.length,
    coverage: scanCoverage(mask, scan.path, scan.step),
  };
}
