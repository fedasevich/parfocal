import { contestedness } from "./tumor-share.ts";

export type CheckCell = {
  id: string;
  tumorProbability: number;
  reviewed?: boolean;
};

export type CheckZone = {
  id: string;
  cellIds: readonly string[];
  unsureCellIds: readonly string[];
};

export type CheckGroup = {
  zoneId: string | null;
  cells: CheckCell[];
};

const byContestedFirst = (a: CheckCell, b: CheckCell) =>
  contestedness(b.tumorProbability) - contestedness(a.tumorProbability);

export function cellsToCheckGroups(
  cells: readonly CheckCell[],
  zones: readonly CheckZone[],
): CheckGroup[] {
  const cellsById = new Map(cells.map((cell) => [cell.id, cell]));
  const ranked = zones
    .map((zone, index) => ({ zone, index }))
    .sort(
      (a, b) =>
        b.zone.unsureCellIds.length - a.zone.unsureCellIds.length ||
        b.zone.cellIds.length - a.zone.cellIds.length ||
        a.index - b.index,
    );
  const placed = new Set<string>();
  const groups: CheckGroup[] = [];
  for (const { zone } of ranked) {
    const zoneCells: CheckCell[] = [];
    for (const id of zone.cellIds) {
      const cell = cellsById.get(id);
      if (!cell || placed.has(id)) continue;
      placed.add(id);
      if (!cell.reviewed) zoneCells.push(cell);
    }
    if (zoneCells.length === 0) continue;
    groups.push({
      zoneId: zone.id,
      cells: zoneCells.sort(byContestedFirst),
    });
  }
  const scattered = cells
    .filter((cell) => !placed.has(cell.id) && !cell.reviewed)
    .sort(byContestedFirst);
  if (scattered.length > 0) {
    groups.push({ zoneId: null, cells: scattered });
  }
  return groups;
}

export function cellsToCheck(
  cells: readonly CheckCell[],
  zones: readonly CheckZone[],
): CheckCell[] {
  return cellsToCheckGroups(cells, zones).flatMap((group) => group.cells);
}
