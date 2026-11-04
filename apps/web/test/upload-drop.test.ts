import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveModel, freshLiveState } from "../src/screens/upload/live-model.ts";
import { kindOf, pairResult, readDropped, sortDrop } from "../src/upload/drop.ts";

const at = (path: string, size = 10) => ({ path, size });

const folder = [
  at("P07-upload/S26-04812/A1_HE.svs"),
  at("P07-upload/S26-04812/A1_HE.geojson"),
  at("P07-upload/S26-04812/A2_HE.svs"),
  at("P07-upload/S26-04812/A2_HE/cells.csv"),
  at("P07-upload/tumor_031.tif"),
  at("P07-upload/results/tumor_031_prob.png"),
  at("P07-upload/notes.txt"),
];

test("files are told apart by extension", () => {
  assert.equal(kindOf("a/B.SVS"), "slide");
  assert.equal(kindOf("a/b.geojson"), "result");
  assert.equal(kindOf("a/b.txt"), "other");
  assert.equal(kindOf("noextension"), "other");
});

test("a folder is a case and slides beside the case folders stay loose", () => {
  const sorted = sortDrop(folder);
  assert.equal(sorted.slides.length, 3);
  assert.deepEqual(sorted.caseOf, ["S26-04812", "S26-04812", null]);
  assert.equal(sorted.results.length, 3);
  assert.deepEqual(
    sorted.others.map((item) => item.path),
    ["P07-upload/notes.txt"],
  );
});

test("a single folder of slides is one case", () => {
  const sorted = sortDrop([at("S26-1/a.svs"), at("S26-1/b.svs")]);
  assert.deepEqual(sorted.caseOf, ["S26-1", "S26-1"]);
});

test("a result pairs beside its slide, in a folder named like the slide, or by name only", () => {
  const slides = sortDrop(folder).slides;
  assert.deepEqual(pairResult(at("P07-upload/S26-04812/A1_HE.geojson"), slides, "auto"), {
    slide: 0,
    how: "Same folder, same name",
  });
  assert.deepEqual(pairResult(at("P07-upload/S26-04812/A2_HE/cells.csv"), slides, "auto"), {
    slide: 1,
    how: "In a folder named like the slide",
  });
  assert.deepEqual(pairResult(at("P07-upload/results/tumor_031_prob.png"), slides, "auto"), {
    slide: 2,
    how: "Same name, other folder",
  });
  assert.equal(pairResult(at("P07-upload/results/other.png"), slides, "auto").slide, null);
  assert.equal(pairResult(at("P07-upload/S26-04812/A2_HE/cells.csv"), slides, "name").slide, null);
  assert.equal(pairResult(at("P07-upload/S26-04812/A1_HE.geojson"), slides, "id").slide, null);
});

test("the longest slide name wins and a longer word does not match", () => {
  const slides = [at("A1.svs"), at("A1_HE.svs"), at("A10.svs")];
  assert.equal(pairResult(at("A1_HE_cells.csv"), slides, "auto").slide, 1);
  assert.equal(pairResult(at("A10.csv"), slides, "auto").slide, 2);
  assert.equal(pairResult(at("A11.csv"), slides, "auto").slide, null);
});

test("the live model groups by case, lists results under slides and counts what uploads", () => {
  const model = createLiveModel(folder, freshLiveState());
  assert.deepEqual(
    model.groups.map((group) => group.label),
    ["S26-04812", null],
  );
  assert.equal(model.resultsOf(0).length, 1);
  assert.equal(model.unplaced.length, 0);
  assert.equal(model.fileCount, 6);
  assert.equal(model.caseCount, 1);
  assert.equal(model.looseCount, 1);
});

test("a result with no slide waits, a pick places it, leaving it out removes it from the upload", () => {
  const files = [...folder, at("P07-upload/results/mystery.png")];
  const waiting = createLiveModel(files, freshLiveState());
  assert.deepEqual(
    waiting.unplaced.map((result) => result.item.path),
    ["P07-upload/results/mystery.png"],
  );
  assert.equal(waiting.problems, 1);
  const placed = createLiveModel(files, {
    ...freshLiveState(),
    placed: { "P07-upload/results/mystery.png": "P07-upload/tumor_031.tif" },
  });
  assert.equal(placed.unplaced.length, 0);
  assert.equal(placed.resultsOf(2).length, 2);
  assert.equal(placed.results.at(-1)?.how, "Picked by you");
  const left = createLiveModel(files, {
    ...freshLiveState(),
    left: { "P07-upload/results/mystery.png": true },
  });
  assert.equal(left.unplaced.length, 0);
  assert.equal(left.leftOut.length, 1);
  assert.equal(left.uploadResults.length, 3);
});

test("removing a slide sends its results back to Not matched yet", () => {
  const model = createLiveModel(folder, {
    ...freshLiveState(),
    removed: { "P07-upload/S26-04812/A1_HE.svs": true },
  });
  assert.equal(model.slides.length, 2);
  assert.equal(model.unplaced.length, 1);
});

test("an empty file is a problem and does not upload", () => {
  const model = createLiveModel([at("a.svs", 0), at("b.svs")], freshLiveState());
  assert.equal(model.empty.length, 1);
  assert.equal(model.uploadSlides.length, 1);
  assert.equal(model.problems, 1);
});

test("keeping all slides loose drops the case groups", () => {
  const model = createLiveModel(folder, { ...freshLiveState(), cases: "loose" });
  assert.deepEqual(
    model.groups.map((group) => group.label),
    [null],
  );
});

type FakeEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (done: (file: File) => void) => void;
  createReader?: () => { readEntries: (done: (entries: FakeEntry[]) => void) => void };
};

const fileEntry = (name: string, text: string): FakeEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (done) => done(new File([text], name)),
});

const dirEntry = (name: string, children: FakeEntry[]): FakeEntry => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let given = false;
    return {
      readEntries: (done) => {
        done(given ? [] : children);
        given = true;
      },
    };
  },
});

test("a dropped folder is read through all its levels", async () => {
  const tree = dirEntry("batch", [
    fileEntry("a.svs", "1234"),
    dirEntry("a", [fileEntry("cells.csv", "x")]),
  ]);
  const transfer = {
    items: [{ kind: "file", webkitGetAsEntry: () => tree, getAsFile: () => null }],
    files: [],
  } as unknown as DataTransfer;
  const items = await readDropped(transfer);
  assert.deepEqual(
    items.map((item) => [item.path, item.size]),
    [
      ["batch/a.svs", 4],
      ["batch/a/cells.csv", 1],
    ],
  );
});
