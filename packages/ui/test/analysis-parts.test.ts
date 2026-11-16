import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  likelySizeAbove,
  likelySizeBelow,
  likelySizeHigh,
  likelySizeLow,
  showsStaging,
  stagingCategory,
  type ViewerPartName,
} from "../src/lib/analysis-parts.ts";

const base: ViewerPartName[] = ["objects", "layers", "decisions", "opinion"];

test("only the parts of the sentinel node template show the staging cards", () => {
  assert.equal(showsStaging([...base, "staging-hero", "area-list", "measure-step"]), true);
  assert.equal(showsStaging([...base, "unsure-zones", "cell-typing"]), false);
  assert.equal(showsStaging(base), false);
});

test("an area is macro over 2 mm, micro over 0.2 mm and ITC at or under 0.2 mm", () => {
  assert.equal(stagingCategory(7.7), "macro");
  assert.equal(stagingCategory(2.01), "macro");
  assert.equal(stagingCategory(2), "micro");
  assert.equal(stagingCategory(0.21), "micro");
  assert.equal(stagingCategory(0.2), "ITC");
  assert.equal(stagingCategory(0.05), "ITC");
});

test("the likely size range matches the evaluated range of the tumor areas", () => {
  const toml = readFileSync(
    new URL("../../../workers/ml/src/parfocal_ml/tumor_areas.toml", import.meta.url),
    "utf8",
  );
  const value = (key: string) => Number(toml.match(new RegExp(`^${key} = ([0-9.]+)$`, "m"))?.[1]);
  assert.equal(likelySizeBelow, value("below"));
  assert.equal(likelySizeAbove, value("above"));
  assert.equal(likelySizeLow(8), 7.2);
  assert.equal(likelySizeHigh(8), 9.2);
});
