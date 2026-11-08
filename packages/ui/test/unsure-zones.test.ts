import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cellsToCheckGroups } from "../src/lib/cells-to-check.ts";
import {
  DEFAULT_UNSURE_ZONE_SETTINGS,
  type Extent,
  isUnsureCall,
  MODELS_DISAGREE,
  POSSIBLY_NOT_CELLS,
  softOutline,
  unsureZonesFor,
  type ZoneCell,
} from "../src/lib/unsure-zones.ts";

const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

const SQUARE = DEFAULT_UNSURE_ZONE_SETTINGS.unsure_zone_square_px;
const EXTENT: Extent = [0, 0, SQUARE * 10, SQUARE * 10];

type SquareFill = {
  column: number;
  row: number;
  nuclei: number;
  unsure: number;
  topTypes?: readonly [string, string];
  disagree?: number;
  notCells?: number;
};

const seededGrid = (fills: readonly SquareFill[], seed = 18) => {
  const random = seeded(seed);
  const cells: ZoneCell[] = [];
  for (const fill of fills) {
    for (let index = 0; index < fill.nuclei; index++) {
      const unsure = index < fill.unsure;
      cells.push({
        id: `c${fill.column}-${fill.row}-${index}`,
        x: (fill.column + 0.05 + random() * 0.9) * SQUARE,
        y: (fill.row + 0.05 + random() * 0.9) * SQUARE,
        unsure,
        topTypes: fill.topTypes ?? ["tumor", "immune"],
        modelsDisagree: unsure && index < (fill.disagree ?? 0),
        mayNotBeCell: unsure && index < (fill.notCells ?? 0),
      });
    }
  }
  return cells;
};

const unsureCounts = (cells: readonly ZoneCell[]) =>
  unsureZonesFor(cells, EXTENT).zones.map((zone) => zone.unsureCellIds.length);

test("an unsure call is a top under 40% or a top two within 10 points", () => {
  assert.equal(isUnsureCall(0.39, 0.3), true);
  assert.equal(isUnsureCall(0.52, 0.45), true);
  assert.equal(isUnsureCall(0.55, 0.3), false);
  assert.equal(isUnsureCall(0.95, 0.03), false);
});

test("squares that touch edge to edge join into one zone", () => {
  const cells = seededGrid([
    { column: 2, row: 2, nuclei: 6, unsure: 3 },
    { column: 3, row: 2, nuclei: 5, unsure: 2 },
    { column: 3, row: 3, nuclei: 4, unsure: 2 },
  ]);
  const { zones } = unsureZonesFor(cells, EXTENT);
  assert.equal(zones.length, 1);
  assert.equal(zones[0]?.cellIds.length, 15);
  assert.equal(zones[0]?.unsureCellIds.length, 7);
});

test("squares that only touch at a corner stay apart", () => {
  const cells = seededGrid([
    { column: 2, row: 2, nuclei: 5, unsure: 4 },
    { column: 3, row: 3, nuclei: 5, unsure: 4 },
  ]);
  assert.deepEqual(unsureCounts(cells), [4, 4]);
});

test("a square needs at least 3 nuclei and 3 in 10 of them unsure", () => {
  const cells = seededGrid([
    { column: 1, row: 1, nuclei: 2, unsure: 2 },
    { column: 2, row: 1, nuclei: 10, unsure: 2 },
    { column: 3, row: 1, nuclei: 10, unsure: 3 },
    { column: 4, row: 1, nuclei: 3, unsure: 1 },
  ]);
  const { zones } = unsureZonesFor(cells, EXTENT);
  assert.equal(zones.length, 1);
  assert.equal(zones[0]?.cellIds.length, 13);
  assert.equal(zones[0]?.unsureCellIds.length, 4);
  assert.ok(zones[0]?.cellIds.every((id) => !id.startsWith("c1-") && !id.startsWith("c2-")));
});

test("a zone with fewer than 4 unsure cells is dropped and its cells are scattered", () => {
  const cells = seededGrid([
    { column: 1, row: 1, nuclei: 8, unsure: 3 },
    { column: 6, row: 6, nuclei: 8, unsure: 5 },
    { column: 9, row: 0, nuclei: 20, unsure: 2 },
  ]);
  const { zones, scatteredUnsureCellIds } = unsureZonesFor(cells, EXTENT);
  assert.deepEqual(
    zones.map((zone) => zone.unsureCellIds.length),
    [5],
  );
  assert.equal(scatteredUnsureCellIds.length, 5);
  assert.ok(scatteredUnsureCellIds.every((id) => !id.startsWith("c6-6")));
});

test("zones rank by unsure cells, then by all cells, then by reading order", () => {
  const cells = seededGrid([
    { column: 0, row: 0, nuclei: 6, unsure: 4 },
    { column: 5, row: 0, nuclei: 12, unsure: 4 },
    { column: 0, row: 5, nuclei: 10, unsure: 7 },
    { column: 5, row: 5, nuclei: 6, unsure: 4 },
  ]);
  const { zones } = unsureZonesFor(cells, EXTENT);
  assert.deepEqual(
    zones.map((zone) => [zone.id, zone.unsureCellIds.length, zone.cellIds.length]),
    [
      ["zone-1", 7, 10],
      ["zone-2", 4, 12],
      ["zone-3", 4, 6],
      ["zone-4", 4, 6],
    ],
  );
  assert.ok(zones[2]?.cellIds[0]?.startsWith("c0-0"));
});

test("a zone is named by its most common pair of top two types, the more common first", () => {
  const cells = [
    ...seededGrid([{ column: 2, row: 2, nuclei: 6, unsure: 4, topTypes: ["immune", "tumor"] }]),
    ...seededGrid([{ column: 3, row: 2, nuclei: 6, unsure: 3, topTypes: ["tumor", "immune"] }], 7),
    ...seededGrid([{ column: 2, row: 3, nuclei: 6, unsure: 2, topTypes: ["stroma", "other"] }], 9),
  ];
  assert.deepEqual(
    unsureZonesFor(cells, EXTENT).zones.map((zone) => zone.name),
    ["Immune or tumor"],
  );
});

test("a zone is named for the models disagreeing or doubtful detections when more than half carry that flag", () => {
  const disagreeing = seededGrid([
    { column: 1, row: 1, nuclei: 8, unsure: 6, disagree: 4, topTypes: ["tumor", "stroma"] },
  ]);
  const doubtful = seededGrid([
    { column: 6, row: 6, nuclei: 8, unsure: 6, notCells: 5, disagree: 5 },
  ]);
  const mixed = seededGrid([{ column: 1, row: 6, nuclei: 8, unsure: 6, disagree: 3 }]);
  const names = unsureZonesFor([...disagreeing, ...doubtful, ...mixed], EXTENT).zones.map(
    (zone) => zone.name,
  );
  assert.deepEqual(names, [MODELS_DISAGREE, "Tumor or immune", POSSIBLY_NOT_CELLS]);
});

test("each zone keeps a soft outline around its unsure cells", () => {
  const cells = seededGrid([{ column: 4, row: 4, nuclei: 9, unsure: 6 }]);
  const [zone] = unsureZonesFor(cells, EXTENT).zones;
  const unsure = cells.filter((cell) => cell.unsure);
  const xs = zone?.outline.map(([x]) => x) ?? [];
  assert.ok(xs.length >= 3);
  assert.ok(Math.min(...xs) < Math.min(...unsure.map((cell) => cell.x)));
  assert.ok(Math.max(...xs) > Math.max(...unsure.map((cell) => cell.x)));
  assert.deepEqual(softOutline([]), []);
});

test("zones are recomputed from corrected cells", () => {
  const cells = seededGrid([{ column: 3, row: 3, nuclei: 10, unsure: 5 }]);
  assert.deepEqual(unsureCounts(cells), [5]);
  const corrected = cells.map((cell, index) => (index < 2 ? { ...cell, unsure: false } : cell));
  const { zones, scatteredUnsureCellIds } = unsureZonesFor(corrected, EXTENT);
  assert.equal(zones.length, 0);
  assert.equal(scatteredUnsureCellIds.length, 3);
});

test("the thresholds come from the lab settings", () => {
  const cells = seededGrid([{ column: 3, row: 3, nuclei: 10, unsure: 3 }]);
  assert.equal(unsureZonesFor(cells, EXTENT).zones.length, 0);
  const looser = { ...DEFAULT_UNSURE_ZONE_SETTINGS, unsure_zone_min_unsure_cells: 3 };
  assert.equal(unsureZonesFor(cells, EXTENT, looser).zones.length, 1);
  const stricter = { ...looser, unsure_zone_min_unsure_percent: 40 };
  assert.equal(unsureZonesFor(cells, EXTENT, stricter).zones.length, 0);
});

test("zones feed the cells to check, zone by zone", () => {
  const cells = seededGrid([
    { column: 1, row: 1, nuclei: 6, unsure: 4 },
    { column: 7, row: 7, nuclei: 8, unsure: 6 },
  ]);
  const { zones } = unsureZonesFor(cells, EXTENT);
  const groups = cellsToCheckGroups(
    cells.map((cell) => ({ id: cell.id, tumorProbability: cell.unsure ? 0.5 : 0.9 })),
    zones,
  );
  assert.deepEqual(
    groups.map((group) => [group.zoneId, group.cells.length]),
    [
      ["zone-1", 8],
      ["zone-2", 6],
    ],
  );
});

type MockNucleus = [string, number, number, number];

const mock = JSON.parse(
  readFileSync(new URL("./fixtures/mock-nuclei.json", import.meta.url), "utf8"),
) as { w: number; h: number; cells: MockNucleus[] };

const MOCK_TYPES: Record<string, string> = {
  t: "tumor",
  i: "immune",
  s: "stroma",
  o: "other",
};
const MOCK_SECOND: Record<string, string> = { t: "i", i: "t", s: "t", o: "t" };
const MOCK_UNSURE_BELOW = 0.62;

const mockCells = (unsure: (score: number) => boolean): ZoneCell[] =>
  mock.cells.map(([type, score, x, y], index) => ({
    id: `n${index}`,
    x,
    y,
    unsure: unsure(score),
    topTypes: [MOCK_TYPES[type] ?? type, MOCK_TYPES[MOCK_SECOND[type] ?? "t"] ?? "tumor"],
  }));

test("the mock's 929 nuclei give two zones of 26 and 24 unsure cells and 31 scattered ones", () => {
  assert.equal(mock.cells.length, 929);
  const { zones, scatteredUnsureCellIds } = unsureZonesFor(
    mockCells((score) => score < MOCK_UNSURE_BELOW),
    [0, 0, mock.w, mock.h],
  );
  assert.deepEqual(
    zones.map((zone) => zone.unsureCellIds.length),
    [26, 24],
  );
  assert.equal(scatteredUnsureCellIds.length, 31);
  assert.ok(zones.every((zone) => / or /.test(zone.name)));
});

test("on the mock's single score the 40% unsure cutoff alone finds no zone", () => {
  const { zones, scatteredUnsureCellIds } = unsureZonesFor(
    mockCells((score) => score < 0.4),
    [0, 0, mock.w, mock.h],
  );
  assert.equal(zones.length, 0);
  assert.equal(scatteredUnsureCellIds.length, 4);
});
