import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { sampleOutline, sampleProject } from "../src/fake/scenario.ts";

const root = new URL("../../../", import.meta.url).pathname;

interface BundledSlide {
  label: string;
  reviewed: boolean;
  regions?: unknown[];
  cells?: unknown[];
}

const bundled = (
  JSON.parse(readFileSync(join(root, "apps/api/src/parfocal_api/sample_results.json"), "utf8")) as {
    slides: BundledSlide[];
  }
).slides;

test("the fake sample outline counts what the API seeds", () => {
  const regions = (slide: BundledSlide) => (slide.regions ?? []).length > 0;
  const cells = (slide: BundledSlide) => (slide.cells ?? []).length > 0;
  assert.deepEqual(sampleOutline, {
    slides: bundled.length,
    review_slides: bundled.filter((slide) => slide.reviewed).length,
    cell_review_slides: bundled.filter((slide) => slide.reviewed && cells(slide)).length,
    result_sets: bundled.filter(regions).length + bundled.filter(cells).length,
    cells: bundled.reduce((sum, slide) => sum + (slide.cells ?? []).length, 0),
    run_slide: bundled.find((slide) => !regions(slide) && !cells(slide))?.label ?? null,
  });
  assert.equal(sampleProject.counts.slides, sampleOutline.slides);
});
