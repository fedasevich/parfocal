import assert from "node:assert/strict";
import { test } from "node:test";
import type { LayerObject, ProjectClass } from "@parfocal/api-client";
import {
  type AiState,
  cellsInExtent,
  cellsInLasso,
  cellsOf,
  changeOf,
  chipsOf,
  emptyAiHistory,
  hitCell,
  maxBatchCells,
  narrow,
  originalOf,
  pick,
  readingOrder,
  recordAi,
  redoAi,
  retypedLine,
  ringOf,
  sameState,
  simplifyRing,
  stateOf,
  stepFrom,
  tagOf,
  undoAi,
} from "../src/annotations/ai-edit.ts";
import { aiWithChecks } from "../src/annotations/annotate-task.ts";
import type { SharedAiObject } from "../src/annotations/annotate-task-api.ts";

const classes: ProjectClass[] = [
  { id: "tumor", key: 1, name: "Tumor", colour: "#f00" },
  { id: "immune", key: 2, name: "Immune", colour: "#0f0" },
];

const square = (x: number, y: number, size = 10) => ({
  type: "Polygon" as const,
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ] as [number, number][],
  ],
});

const ai = (number: number, x: number, y: number, classId: string): SharedAiObject => ({
  object: `C${number}`,
  kind: "cell",
  number,
  class_id: classId,
  score: 0.61,
  probabilities: null,
  geometry: square(x, y),
  check: "unchecked",
});

const copy = (source: string, fields: Partial<LayerObject>): LayerObject => ({
  id: `copy-${source}`,
  slide_id: "slide",
  kind: "cell",
  number: 1,
  code: source,
  origin: "ai-edited",
  source,
  geometry: square(0, 0),
  class_id: null,
  text: null,
  version: 3,
  created_by_user_id: "anna",
  changed_by_user_id: "anna",
  created_at: "2026-11-18T10:00:00Z",
  updated_at: "2026-11-18T10:00:00Z",
  deleted_at: null,
  ...fields,
});

const objects = [
  ai(1, 0, 0, "tumor"),
  ai(2, 40, 2, "immune"),
  ai(3, 0, 40, "tumor"),
  ai(4, 40, 42, "immune"),
];

const plain = cellsOf(aiWithChecks(objects, []), new Map());

test("a cell shows its copy, a pending change wins and the AI original stays", () => {
  const layer = [
    copy("C1", { class_id: "immune", geometry: square(5, 5, 20) }),
    copy("C2", { deleted_at: "2026-11-18T11:00:00Z" }),
    copy("C3", { origin: "ai-confirmed" }),
  ];
  const cells = cellsOf(aiWithChecks(objects, layer), new Map());
  const [one, two, three, four] = cells;
  assert.equal(one?.classId, "immune");
  assert.deepEqual(one?.bounds, [5, 5, 25, 25]);
  assert.equal(one?.edited, true);
  assert.equal(one?.version, 3);
  assert.deepEqual(one?.original, { classId: "tumor", ring: ringOf(square(0, 0)) });
  assert.equal(two?.deleted, true);
  assert.equal(three?.edited, false);
  assert.equal(three?.classId, "tumor");
  assert.equal(four?.version, null);
  assert.ok(one !== undefined && four !== undefined);
  const waiting: AiState = { ...stateOf(four), classId: "tumor" };
  const pending = cellsOf(aiWithChecks(objects, layer), new Map([["C4", waiting]]));
  assert.equal(pending[3]?.classId, "tumor");
  assert.equal(pending[3]?.edited, true);
  assert.deepEqual(originalOf(one), {
    object: "C1",
    classId: "tumor",
    ring: ringOf(square(0, 0)),
    deleted: false,
  });
});

test("a click hits the cell under it and skips deleted cells", () => {
  assert.equal(hitCell(plain, { x: 5, y: 5 }, 1)?.object, "C1");
  assert.equal(hitCell(plain, { x: 25, y: 25 }, 1), null);
  const gone = plain.map((cell) => (cell.object === "C1" ? { ...cell, deleted: true } : cell));
  assert.equal(hitCell(gone, { x: 5, y: 5 }, 1), null);
  assert.equal(hitCell(plain, { x: -3, y: 5 }, 8)?.object, "C1");
});

test("a marquee and a lasso pick cells by their centre", () => {
  assert.deepEqual(cellsInExtent(plain, [50, 50, 4, 4]), ["C1", "C2", "C3", "C4"]);
  assert.deepEqual(cellsInExtent(plain, [6, 0, 46, 20]), ["C2"]);
  const lasso = [
    { x: -5, y: -5 },
    { x: 20, y: -5 },
    { x: 20, y: 60 },
    { x: -5, y: 60 },
  ];
  assert.deepEqual(cellsInLasso(plain, lasso), ["C1", "C3"]);
  assert.deepEqual(cellsInLasso(plain, lasso.slice(0, 2)), []);
});

test("shift adds, a second pick toggles and a selection is capped", () => {
  assert.deepEqual(pick(["C1"], ["C2"], "replace"), ["C2"]);
  assert.deepEqual(pick(["C1"], ["C2", "C1"], "add"), ["C1", "C2"]);
  assert.deepEqual(pick(["C1", "C2"], ["C1"], "toggle"), ["C2"]);
  const many = Array.from({ length: maxBatchCells + 5 }, (_, index) => `C${index}`);
  assert.equal(pick([], many, "replace").length, maxBatchCells);
});

test("type chips count the selection, and a chip keeps or drops its type", () => {
  const selection = ["C1", "C2", "C3"];
  assert.deepEqual(chipsOf(plain, selection, classes), [
    { classId: "tumor", name: "Tumor", count: 2 },
    { classId: "immune", name: "Immune", count: 1 },
  ]);
  assert.deepEqual(narrow(plain, selection, "tumor", true, classes), ["C1", "C3"]);
  assert.deepEqual(narrow(plain, selection, "tumor", false, classes), ["C2"]);
  const unknown = chipsOf(plain, selection, [classes[0] as ProjectClass]);
  assert.deepEqual(unknown[1], { classId: null, name: "No type", count: 1 });
});

test("J walks the cells in reading order and wraps", () => {
  const order = readingOrder(plain);
  assert.deepEqual(order, ["C1", "C2", "C3", "C4"]);
  assert.equal(stepFrom(order, null, 1), "C1");
  assert.equal(stepFrom(order, "C2", 1), "C3");
  assert.equal(stepFrom(order, "C1", -1), "C4");
  assert.equal(stepFrom([], null, 1), null);
});

test("a long AI outline is cut to at most 32 handles and keeps its extent", () => {
  const circle = Array.from({ length: 300 }, (_, index) => {
    const angle = (index / 300) * Math.PI * 2;
    return [Math.cos(angle) * 100, Math.sin(angle) * 100] as const;
  });
  const simple = simplifyRing(circle);
  assert.equal(simple.length, 32);
  const reach = Math.max(...simple.map(([x]) => x));
  assert.ok(reach > 97);
  assert.equal(simplifyRing(ringOf(square(0, 0))).length, 4);
});

test("a change carries the whole state and the version of an existing copy", () => {
  const cell = plain[0] as (typeof plain)[number];
  const retyped = { ...stateOf(cell), classId: "immune" };
  assert.equal(sameState(cell, retyped), false);
  assert.equal(sameState(cell, stateOf(cell)), true);
  assert.deepEqual(changeOf(retyped, null), {
    object: "C1",
    geometry: square(0, 0),
    class_id: "immune",
    deleted: false,
  });
  assert.equal(changeOf(retyped, 4).version, 4);
});

test("one batch is one undo step, and a new change drops the redo tail", () => {
  const before = [stateOf(plain[0] as AiState), stateOf(plain[1] as AiState)];
  const after = before.map((state) => ({ ...state, classId: "tumor" }));
  const one = recordAi(emptyAiHistory, { label: "Retype", before, after });
  assert.equal(one.entries.length, 1);
  const undone = undoAi(one);
  assert.deepEqual(undone?.entry.before, before);
  assert.equal(undoAi(undone?.history ?? one), null);
  const redone = redoAi(undone?.history ?? one);
  assert.deepEqual(redone?.entry.after, after);
  const branched = recordAi(undone?.history ?? one, { label: "Delete", before, after });
  assert.equal(branched.entries.length, 1);
  assert.equal(redoAi(branched), null);
});

test("the tag names the type, the score and who edited, and the notice counts cells", () => {
  const nameOf = (id: string | null) => classes.find((item) => item.id === id)?.name ?? "No type";
  const cell = plain[0] as (typeof plain)[number];
  assert.equal(tagOf(cell, nameOf, null), "Tumor 0.61 · AI");
  const edited = { ...cell, classId: "immune", edited: true };
  assert.equal(tagOf(edited, nameOf, "AK"), "Immune · AI, edited by AK · was Tumor 0.61");
  assert.equal(retypedLine(1, "Tumor"), "1 cell is now Tumor");
  assert.equal(retypedLine(252, "Tumor"), "252 cells are now Tumor");
});
