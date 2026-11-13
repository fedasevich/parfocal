import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asksCellCount,
  backLabel,
  type FindingsContent,
  type FindingsZone,
  findingsLayoutFor,
  findingsSections,
  nextStagingStep,
  nothingSelected,
  type StagingPanelArea,
  stagingSteps,
  stepBack,
  zoneNumbers,
  zonesMostUnsureFirst,
} from "../src/lib/findings-layout.ts";

const content: FindingsContent = {
  warnings: 0,
  zones: 2,
  scattered: 31,
  outline: false,
  changed: 0,
  extras: 2,
};

const zone = (id: string, cells: number, unsure: number, open = unsure): FindingsZone => ({
  id,
  name: "Tumor or immune",
  cells,
  unsure,
  open,
});

const area = (patch: Partial<StagingPanelArea> = {}): StagingPanelArea => ({
  id: "T1",
  size: 6.2,
  low: 4.8,
  high: 7.1,
  call: null,
  ...patch,
});

test("the specimen picks the layout: node staging for sentinel nodes, cell findings otherwise", () => {
  assert.equal(findingsLayoutFor("sentinel-node"), "node-staging");
  assert.equal(findingsLayoutFor("cell-review"), "cell-findings");
  assert.equal(findingsLayoutFor("none"), "cell-findings");
});

test("with nothing selected the panel lists the number line, zones, scattered cells and extras", () => {
  assert.deepEqual(findingsSections(nothingSelected, content), [
    "number-line",
    "zones",
    "scattered",
    "extras",
  ]);
});

test("a drawn outline and the changed zone join the list only when they exist", () => {
  assert.deepEqual(findingsSections(nothingSelected, { ...content, outline: true, changed: 6 }), [
    "number-line",
    "zones",
    "scattered",
    "outline",
    "changed",
    "extras",
  ]);
  assert.deepEqual(
    findingsSections(nothingSelected, { ...content, zones: 0, scattered: 0, extras: 0 }),
    ["number-line"],
  );
});

test("an open zone shows only its number line and gallery", () => {
  assert.deepEqual(findingsSections({ kind: "zone", id: "zone-1" }, content), [
    "back",
    "number-line",
    "gallery",
  ]);
});

test("a selected outline shows only its number line", () => {
  assert.deepEqual(findingsSections({ kind: "outline", id: "R1" }, content), [
    "back",
    "number-line",
  ]);
});

test("a selected cell shows the cell and its zone's tiles, and no tiles for a scattered cell", () => {
  assert.deepEqual(findingsSections({ kind: "cell", id: "C1", zoneId: "zone-1" }, content), [
    "back",
    "cell",
    "siblings",
  ]);
  assert.deepEqual(findingsSections({ kind: "cell", id: "C9", zoneId: null }, content), [
    "back",
    "cell",
  ]);
});

test("the model warning leads every situation when there is one", () => {
  const warned = { ...content, warnings: 1 };
  assert.equal(findingsSections(nothingSelected, warned)[0], "warnings");
  assert.equal(findingsSections({ kind: "zone", id: "zone-1" }, warned)[0], "warnings");
  assert.equal(findingsSections({ kind: "cell", id: "C1", zoneId: null }, warned)[0], "warnings");
  assert.equal(findingsSections({ kind: "outline", id: "R1" }, warned)[0], "warnings");
});

test("zones are ordered by the share of unsure cells, then by how many, then as given", () => {
  const ordered = zonesMostUnsureFirst([
    zone("a", 100, 30),
    zone("b", 40, 24),
    zone("c", 80, 24),
    zone("d", 200, 60),
  ]);
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["b", "d", "a", "c"],
  );
});

test("a zone's numbers read as unsure of all cells with the share and what is open", () => {
  assert.equal(zoneNumbers(zone("a", 80, 26, 20)), "26 unsure of 80 cells (33%), 20 open");
  assert.equal(zoneNumbers(zone("a", 1, 1, 0)), "1 unsure of 1 cell (100%), 0 open");
});

test("Esc steps from a cell to its zone, then to the list", () => {
  const cell = { kind: "cell", id: "C1", zoneId: "zone-1" } as const;
  assert.deepEqual(stepBack(cell), { kind: "zone", id: "zone-1" });
  assert.deepEqual(stepBack({ kind: "zone", id: "zone-1" }), nothingSelected);
  assert.deepEqual(stepBack({ kind: "cell", id: "C9", zoneId: null }), nothingSelected);
  assert.deepEqual(stepBack({ kind: "outline", id: "R1" }), nothingSelected);
  assert.equal(backLabel(cell, "Zone 1"), "Back to Zone 1");
  assert.equal(backLabel({ kind: "zone", id: "zone-1" }), "Back to the list");
});

test("a large area asks two steps, a cluster at or under 0.2 mm asks for the cell count too", () => {
  assert.deepEqual(
    stagingSteps(area()).map((step) => `${step.index} ${step.name}`),
    ["1 tumor", "2 size"],
  );
  assert.deepEqual(
    stagingSteps(area({ size: 0.18, low: 0.14, high: 0.22 })).map(
      (step) => `${step.index} ${step.name}`,
    ),
    ["1 tumor", "2 size", "3 count"],
  );
  assert.equal(asksCellCount(area({ size: 0.18, measured: 0.31 })), false);
  assert.equal(asksCellCount(area({ size: 0.4, measured: 0.19 })), true);
});

test("an area called not tumor is dropped and asks nothing more", () => {
  const dropped = area({ size: 0.18, call: "not" });
  assert.deepEqual(
    stagingSteps(dropped).map((step) => step.name),
    ["tumor"],
  );
  assert.equal(nextStagingStep(dropped), null);
});

test("the steps are worked in order and carry their answers", () => {
  const small = area({ size: 0.18 });
  assert.equal(nextStagingStep(small), "tumor");
  assert.equal(nextStagingStep({ ...small, call: "unsure" }), "tumor");
  assert.equal(nextStagingStep({ ...small, call: "tumor" }), "size");
  assert.equal(nextStagingStep({ ...small, call: "tumor", measured: 0.19 }), "count");
  const done = { ...small, call: "tumor" as const, measured: 0.19, counted: 164 };
  assert.equal(nextStagingStep(done), null);
  assert.deepEqual(
    stagingSteps(done).map((step) => step.answer),
    ["Tumor", "0.19 mm", "164 tumor cells"],
  );
});
