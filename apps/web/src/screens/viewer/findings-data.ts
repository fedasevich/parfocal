import type { ReviewObject } from "@parfocal/api-client";
import type { FindingsCell, FindingsPanelZone } from "@parfocal/ui/components/findings-panel";
import { aiSizeError, scaleMax, scaleMin } from "@parfocal/ui/lib/analysis-parts";
import { type AreaCount, callOf } from "@parfocal/ui/lib/area-call";
import {
  CHANGED_ZONE_ID,
  CHANGED_ZONE_NAME,
  type FindingsLayout,
  type FindingsSelection,
  findingsLayoutFor,
  type StagingPanelArea,
} from "@parfocal/ui/lib/findings-layout";
import type { NumberLineClass } from "@parfocal/ui/lib/number-line";
import { type CellZone, isUnsureCell } from "./zone-cells.ts";

type Decided = (object: string) => boolean;
type ColorOf = (className: string) => string;
type TileOf = (cell: ReviewObject) => FindingsCell;

export function numberLineOf(
  cells: readonly ReviewObject[],
  decided: Decided,
  colorOf: ColorOf,
  unsure: (cell: ReviewObject) => boolean = isUnsureCell,
): NumberLineClass[] {
  const rows = new Map<string, NumberLineClass>();
  for (const cell of cells) {
    const row = rows.get(cell.class_name) ?? {
      name: cell.class_name,
      color: colorOf(cell.class_name),
      sure: 0,
      unsure: 0,
      checked: 0,
    };
    const done = decided(cell.object);
    rows.set(cell.class_name, {
      ...row,
      sure: row.sure + (done || !unsure(cell) ? 1 : 0),
      unsure: row.unsure + (!done && unsure(cell) ? 1 : 0),
      checked: row.checked + (done ? 1 : 0),
    });
  }
  return [...rows.values()];
}

function panelZone(
  id: string,
  name: string,
  total: readonly ReviewObject[],
  unsureCells: readonly ReviewObject[],
  decided: Decided,
  colorOf: ColorOf,
  tileOf: TileOf,
): FindingsPanelZone {
  const unsureIds = new Set(unsureCells.map((cell) => cell.object));
  return {
    id,
    name,
    cells: total.length,
    unsure: unsureCells.length,
    open: unsureCells.filter((cell) => !decided(cell.object)).length,
    classes: numberLineOf(total, decided, colorOf, (cell) => unsureIds.has(cell.object)),
    tiles: unsureCells.map(tileOf),
  };
}

export function findingsZones(
  zones: readonly CellZone[],
  decided: Decided,
  colorOf: ColorOf,
  tileOf: TileOf,
): FindingsPanelZone[] {
  return zones.map((zone) =>
    panelZone(zone.id, zone.name, zone.total, zone.cells, decided, colorOf, tileOf),
  );
}

export function changedZone(
  cells: readonly ReviewObject[],
  decided: Decided,
  colorOf: ColorOf,
  tileOf: TileOf,
): FindingsPanelZone | undefined {
  return cells.length === 0
    ? undefined
    : panelZone(CHANGED_ZONE_ID, CHANGED_ZONE_NAME, cells, cells, decided, colorOf, tileOf);
}

export function scatteredCells(
  cells: readonly ReviewObject[],
  zones: readonly CellZone[],
): ReviewObject[] {
  const zoned = new Set(zones.flatMap((zone) => zone.cells.map((cell) => cell.object)));
  return cells.filter((cell) => isUnsureCell(cell) && !zoned.has(cell.object));
}

export function findingsSelection(
  zones: readonly CellZone[],
  openZoneId: string | null,
  selected: string | null | undefined,
): FindingsSelection {
  const zone = zones.find((item) => item.id === openZoneId);
  if (zone === undefined) return { kind: "none" };
  return selected && zone.cells.some((cell) => cell.object === selected)
    ? { kind: "cell", id: selected, zoneId: zone.id }
    : { kind: "zone", id: zone.id };
}

export function viewerFindingsLayout(
  template: Parameters<typeof findingsLayoutFor>[0],
  zoneCount: number,
  areaCount: number,
): FindingsLayout | null {
  if (zoneCount > 0) return "cell-findings";
  return findingsLayoutFor(template) === "node-staging" && areaCount > 0 ? "node-staging" : null;
}

const clampToScale = (mm: number) => Math.min(scaleMax, Math.max(scaleMin, mm));

export type ViewerArea = {
  object: string;
  size: number;
  call: AreaCount | null;
  measured: number | null;
};

export function stagingPanelAreas(areas: readonly ViewerArea[]): StagingPanelArea[] {
  return areas.map((area) => ({
    id: area.object,
    size: area.size,
    low: clampToScale(area.size * (1 - aiSizeError)),
    high: clampToScale(area.size * (1 + aiSizeError)),
    call: callOf(area.call ?? undefined),
    measured: area.measured,
  }));
}
