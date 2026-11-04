export type NumberLineClass = {
  name: string;
  color: string;
  sure: number;
  unsure: number;
  checked: number;
};

export type NumberLineTotals = {
  total: number;
  checked: number;
  sure: number;
  unsure: number;
};

export function numberLineTotals(classes: readonly NumberLineClass[]): NumberLineTotals {
  let total = 0;
  let checked = 0;
  let unsure = 0;
  for (const row of classes) {
    total += row.sure + row.unsure;
    checked += Math.min(row.checked, row.sure);
    unsure += row.unsure;
  }
  return { total, checked, sure: total - checked - unsure, unsure };
}

export function classCount(row: NumberLineClass): number {
  return row.sure + row.unsure;
}

export function answerCells(
  classes: readonly NumberLineClass[],
  className: string,
  cells = 1,
): NumberLineClass[] {
  return classes.map((row) => {
    if (row.name !== className) return row;
    const moved = Math.max(0, Math.min(cells, row.unsure));
    return {
      ...row,
      unsure: row.unsure - moved,
      sure: row.sure + moved,
      checked: row.checked + moved,
    };
  });
}

export function numberLineLabel(totals: NumberLineTotals): string {
  return `${totals.total} cells: ${totals.checked} checked by you, ${totals.sure} sure, ${totals.unsure} unsure`;
}
