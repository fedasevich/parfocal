import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import { CHANGED_ZONE_ID } from "@parfocal/ui/lib/findings-layout";
import { numberLineTotals } from "@parfocal/ui/lib/number-line";
import {
  changedZone,
  findingsSelection,
  findingsZones,
  numberLineOf,
  scatteredCells,
  stagingPanelAreas,
  viewerFindingsLayout,
} from "../src/screens/viewer/findings-data.ts";
import type { CellZone } from "../src/screens/viewer/zone-cells.ts";

const cell = (object: string, className: string, score: number): ReviewObject => ({
  object,
  kind: "cell",
  number: 1,
  class_name: className,
  score,
  size_mm: null,
  other_class: "Immune",
});

const sureTumor = cell("C1", "Tumor", 0.95);
const unsureTumor = cell("C2", "Tumor", 0.52);
const unsureImmune = cell("C3", "Immune", 0.49);
const loneUnsure = cell("C4", "Tumor", 0.5);
const zone: CellZone = {
  id: "zone-1",
  name: "Tumor or immune",
  total: [sureTumor, unsureTumor, unsureImmune],
  cells: [unsureTumor, unsureImmune],
};
const colorOf = (name: string) => `var(--${name.toLowerCase()})`;
const tileOf = (item: ReviewObject) => ({ id: item.object, label: item.class_name });
const nobody = () => false;

test("a number line counts sure, unsure and checked cells per class", () => {
  const rows = numberLineOf(zone.total, nobody, colorOf);
  assert.deepEqual(rows, [
    { name: "Tumor", color: "var(--tumor)", sure: 1, unsure: 1, checked: 0 },
    { name: "Immune", color: "var(--immune)", sure: 0, unsure: 1, checked: 0 },
  ]);
});

test("a decided cell moves from unsure to sure and counts as checked", () => {
  const rows = numberLineOf(zone.total, (object) => object === "C2", colorOf);
  assert.deepEqual(rows[0], {
    name: "Tumor",
    color: "var(--tumor)",
    sure: 2,
    unsure: 0,
    checked: 1,
  });
  assert.deepEqual(numberLineTotals(rows), { total: 3, checked: 1, sure: 1, unsure: 1 });
});

test("a zone carries its own totals, open count, number line and tiles", () => {
  const [first] = findingsZones([zone], (object) => object === "C3", colorOf, tileOf);
  assert.equal(first?.cells, 3);
  assert.equal(first?.unsure, 2);
  assert.equal(first?.open, 1);
  assert.deepEqual(
    first?.tiles.map((tile) => tile.id),
    ["C2", "C3"],
  );
  assert.equal(numberLineTotals(first?.classes ?? []).total, 3);
});

test("the changed zone exists only when cells changed", () => {
  assert.equal(changedZone([], nobody, colorOf, tileOf), undefined);
  const changed = changedZone([unsureTumor], nobody, colorOf, tileOf);
  assert.equal(changed?.id, CHANGED_ZONE_ID);
  assert.equal(changed?.cells, 1);
  assert.equal(changed?.open, 1);
});

test("scattered cells are unsure cells outside every zone", () => {
  const all = [...zone.total, loneUnsure];
  assert.deepEqual(
    scatteredCells(all, [zone]).map((item) => item.object),
    ["C4"],
  );
});

test("the selection follows the open zone and a selected cell inside it", () => {
  assert.deepEqual(findingsSelection([zone], null, "C2"), { kind: "none" });
  assert.deepEqual(findingsSelection([zone], "zone-1", null), { kind: "zone", id: "zone-1" });
  assert.deepEqual(findingsSelection([zone], "zone-1", "C1"), { kind: "zone", id: "zone-1" });
  assert.deepEqual(findingsSelection([zone], "zone-1", "C2"), {
    kind: "cell",
    id: "C2",
    zoneId: "zone-1",
  });
});

test("unsure zones show cell findings and a sentinel node without them shows staging", () => {
  assert.equal(viewerFindingsLayout("sentinel-node", 2, 3), "cell-findings");
  assert.equal(viewerFindingsLayout("sentinel-node", 0, 3), "node-staging");
  assert.equal(viewerFindingsLayout("sentinel-node", 0, 0), null);
  assert.equal(viewerFindingsLayout("cell-review", 0, 3), null);
});

test("staging areas carry the AI size range and the reader's call", () => {
  const [area, tiny] = stagingPanelAreas([
    { object: "A1", size: 2, call: "agree", measured: 2.1 },
    { object: "A2", size: 0.05, call: null, measured: null },
  ]);
  assert.equal(area?.call, "tumor");
  assert.equal(area?.measured, 2.1);
  assert.ok(Math.abs((area?.low ?? 0) - 1.8) < 1e-9);
  assert.ok(Math.abs((area?.high ?? 0) - 2.2) < 1e-9);
  assert.equal(tiny?.call, null);
  assert.equal(tiny?.low, 0.05);
});
