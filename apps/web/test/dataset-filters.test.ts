import assert from "node:assert/strict";
import { test } from "node:test";
import {
  className,
  datasetParams,
  freezeFilters,
  narrowed,
  sizeText,
  startingFilters,
  totalOf,
} from "../src/screens/dataset/dataset-filters.ts";

test("the starting filters ask for checked objects only and send no narrowing", () => {
  assert.deepEqual(datasetParams(startingFilters), { include_unchecked: false });
  assert.deepEqual(freezeFilters(startingFilters), {
    origins: ["human", "ai-confirmed", "ai-edited"],
    class_ids: null,
    slide_ids: null,
    include_unchecked: false,
  });
});

test("narrowing origins, classes and slides sends each list", () => {
  const params = datasetParams({
    origins: ["ai-edited"],
    classIds: ["c1"],
    slideIds: ["s2"],
    includeUnchecked: true,
  });
  assert.deepEqual(params, {
    origin: ["ai-edited"],
    class_id: ["c1"],
    slide_id: ["s2"],
    include_unchecked: true,
  });
});

test("a list never empties and choosing everything again means no filter", () => {
  const all = ["a", "b"];
  assert.deepEqual(narrowed(null, all, "a"), ["b"]);
  assert.deepEqual(narrowed(["b"], all, "b"), ["b"]);
  assert.equal(narrowed(["b"], all, "a"), null);
});

test("counts, class names and sizes read plainly", () => {
  assert.equal(totalOf({ human: 2, "ai-edited": 3 }), 5);
  const classes = [{ id: "c1", key: 1, name: "Tumor cell", colour: "#f87171" }];
  assert.equal(className("c1", classes, "No class"), "Tumor cell");
  assert.equal(className("none", classes, "No class"), "No class");
  assert.equal(sizeText(512), "512 B");
  assert.equal(sizeText(2048), "2.0 KB");
  assert.equal(sizeText(3 * 1024 * 1024), "3.0 MB");
});
