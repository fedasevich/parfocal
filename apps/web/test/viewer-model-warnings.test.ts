import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResultSetTyper, ReviewObject } from "@parfocal/api-client";
import { viewerModelWarnings } from "../src/screens/viewer/viewer-model-warnings.ts";

const typer: ResultSetTyper = {
  result_set_id: "set-1",
  name: "HoVer-NeXt",
  calibrated: true,
  checked_on_held_out: true,
  band_accuracy: { confident: 0.94 },
  test_set_accuracy: 0.9,
  test_set_confident_share: 0.5,
  test_set_unsure_share: 0.1,
  validated_sites: [],
};

const cell = (number: number, score: number): ReviewObject => ({
  object: `T1·C${number}`,
  kind: "cell",
  number,
  class_name: "Tumor",
  score,
  size_mm: null,
  other_class: null,
});

const confidentCells = Array.from({ length: 120 }, (_, index) => cell(index, 0.95));

test("a typer under the accuracy floor warns on the viewer", () => {
  const warnings = viewerModelWarnings({ ...typer, test_set_accuracy: 0.66 }, confidentCells, true);
  assert.deepEqual(
    warnings.map((warning) => warning.kind),
    ["low-accuracy"],
  );
});

test("an uncalibrated typer warns on the viewer", () => {
  const warnings = viewerModelWarnings({ ...typer, calibrated: false }, confidentCells, true);
  assert.deepEqual(
    warnings.map((warning) => warning.kind),
    ["uncalibrated"],
  );
});

test("a slide that looks unlike the test set warns about the difference", () => {
  const unsureCells = Array.from({ length: 120 }, (_, index) => cell(index, 0.3));
  const kinds = viewerModelWarnings(typer, unsureCells, true).map((warning) => warning.kind);
  assert.deepEqual(kinds, ["out-of-distribution", "many-unsure"]);
});

test("a sound typer on a familiar slide shows nothing", () => {
  assert.deepEqual(viewerModelWarnings(typer, confidentCells, true), []);
});

test("turning the model warnings setting off hides every warning", () => {
  assert.deepEqual(viewerModelWarnings({ ...typer, calibrated: false }, confidentCells, false), []);
});

test("a result set with no typer record shows nothing", () => {
  assert.deepEqual(viewerModelWarnings(undefined, confidentCells, true), []);
});
