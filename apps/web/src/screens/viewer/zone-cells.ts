import type { ReviewObject } from "@parfocal/api-client";
import { isUnsureCall, type UnsureZone, unsureZonesFor } from "@parfocal/ui/lib/unsure-zones";
import { cellShapes, hpfSize } from "../review/slide-geometry.ts";

export type CellZone = {
  id: string;
  name: string;
  cells: ReviewObject[];
};

export function isUnsureCell(cell: ReviewObject): boolean {
  const top = Math.max(cell.score, 1 - cell.score);
  return isUnsureCall(top, 1 - top);
}

export function zonesOfCells(cells: readonly ReviewObject[]): CellZone[] {
  const placed = cells.flatMap((cell) => {
    const shape = cellShapes[cell.object];
    return shape === undefined
      ? []
      : [
          {
            id: cell.object,
            x: shape.x,
            y: shape.y,
            unsure: isUnsureCell(cell),
            topTypes: [cell.class_name, cell.other_class ?? "Other"] as const,
          },
        ];
  });
  const { zones } = unsureZonesFor(placed, [0, 0, hpfSize.width, hpfSize.height]);
  const byId = new Map(cells.map((cell) => [cell.object, cell]));
  return zones.map((zone: UnsureZone) => ({
    id: zone.id,
    name: zone.name,
    cells: zone.unsureCellIds
      .flatMap((id) => {
        const cell = byId.get(id);
        return cell === undefined ? [] : [cell];
      })
      .sort((a, b) => Math.abs(a.score - 0.5) - Math.abs(b.score - 0.5)),
  }));
}

export function nextUnsureCell(
  zone: CellZone,
  current: string | undefined,
  isOpen: (object: string) => boolean,
): string | undefined {
  const start = zone.cells.findIndex((cell) => cell.object === current);
  const ordered = [...zone.cells.slice(start + 1), ...zone.cells.slice(0, Math.max(start, 0))];
  return ordered.find((cell) => isOpen(cell.object))?.object;
}
