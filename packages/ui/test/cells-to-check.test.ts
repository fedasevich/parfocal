import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CheckCell,
  type CheckZone,
  cellsToCheck,
  cellsToCheckGroups,
} from "../src/lib/cells-to-check.ts";

const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

const contested = (cell: CheckCell) => Math.min(cell.tumorProbability, 1 - cell.tumorProbability);

const seededResult = () => {
  const random = seeded(929);
  const cells: CheckCell[] = Array.from({ length: 120 }, (_, index) => ({
    id: `cell-${index}`,
    tumorProbability: random(),
    reviewed: random() < 0.15,
  }));
  const ids = (from: number, to: number) => cells.slice(from, to).map((cell) => cell.id);
  const zones: CheckZone[] = [
    { id: "small", cellIds: ids(0, 20), unsureCellIds: ids(0, 6) },
    { id: "large", cellIds: ids(20, 60), unsureCellIds: ids(20, 46) },
    { id: "middle", cellIds: ids(60, 90), unsureCellIds: ids(60, 84) },
  ];
  return { cells, zones };
};

test("zones come in order of unsure cells and scattered cells come last", () => {
  const { cells, zones } = seededResult();
  const groups = cellsToCheckGroups(cells, zones);
  assert.deepEqual(
    groups.map((group) => group.zoneId),
    ["large", "middle", "small", null],
  );
});

test("each group is ordered with tumor probability nearest 50% first", () => {
  const { cells, zones } = seededResult();
  for (const group of cellsToCheckGroups(cells, zones)) {
    const scores = group.cells.map(contested);
    assert.deepEqual(
      scores,
      [...scores].sort((a, b) => b - a),
    );
  }
});

test("every unreviewed cell is listed once, sure cells included, reviewed cells left out", () => {
  const { cells, zones } = seededResult();
  const queue = cellsToCheck(cells, zones);
  const unreviewed = cells.filter((cell) => !cell.reviewed);
  assert.equal(queue.length, unreviewed.length);
  assert.equal(new Set(queue.map((cell) => cell.id)).size, queue.length);
  assert.ok(queue.every((cell) => !cell.reviewed));
  const zoneIds = new Set(zones.flatMap((zone) => zone.cellIds));
  const scattered = queue.filter((cell) => !zoneIds.has(cell.id));
  assert.equal(scattered.length, unreviewed.filter((cell) => !zoneIds.has(cell.id)).length);
  assert.ok(queue.slice(-scattered.length).every((cell) => !zoneIds.has(cell.id)));
});

test("a contested scattered cell still waits behind a sure cell in a zone", () => {
  const cells: CheckCell[] = [
    { id: "zone-sure", tumorProbability: 0.98 },
    { id: "zone-close", tumorProbability: 0.6 },
    { id: "scattered-close", tumorProbability: 0.5 },
  ];
  const zones: CheckZone[] = [
    { id: "zone", cellIds: ["zone-sure", "zone-close"], unsureCellIds: ["zone-close"] },
  ];
  assert.deepEqual(
    cellsToCheck(cells, zones).map((cell) => cell.id),
    ["zone-close", "zone-sure", "scattered-close"],
  );
});

test("a zone whose cells are all reviewed drops out and ties keep zone order", () => {
  const cells: CheckCell[] = [
    { id: "a", tumorProbability: 0.5, reviewed: true },
    { id: "b", tumorProbability: 0.4 },
    { id: "c", tumorProbability: 0.3 },
    { id: "d", tumorProbability: 0.45 },
  ];
  const zones: CheckZone[] = [
    { id: "done", cellIds: ["a"], unsureCellIds: ["a"] },
    { id: "first", cellIds: ["b"], unsureCellIds: ["b"] },
    { id: "second", cellIds: ["c"], unsureCellIds: ["c"] },
  ];
  assert.deepEqual(
    cellsToCheckGroups(cells, zones).map((group) => [
      group.zoneId,
      group.cells.map((cell) => cell.id),
    ]),
    [
      ["first", ["b"]],
      ["second", ["c"]],
      [null, ["d"]],
    ],
  );
});

test("no cells gives no groups", () => {
  assert.deepEqual(cellsToCheckGroups([], []), []);
});
