import assert from "node:assert/strict";
import { test } from "node:test";
import {
  camelyonSlides,
  chipFor,
  countOf,
  fieldChipFor,
  generateField,
  generateNuclei,
  nucleiChipFor,
  sampleCatalogue,
  syntheticChipLabel,
  syntheticCounts,
} from "../src/lab/synthetic-data.ts";
import { bigSlides, sampleSlides } from "../src/screens/developer/developer-data.ts";

const extent = { width: 4096, height: 2048 };

test("the counts are off, 10k, 100k, 500k and 1M", () => {
  assert.deepEqual(
    syntheticCounts.map((entry) => entry.count),
    [0, 10_000, 100_000, 500_000, 1_000_000],
  );
  assert.equal(countOf("1M"), 1_000_000);
  assert.equal(countOf("Off"), 0);
  assert.equal(countOf("nonsense"), 0);
});

test("every synthetic nuclei layer is labelled, at every count", () => {
  for (const entry of syntheticCounts) {
    const layer = generateNuclei(entry.count, 7, extent);
    assert.equal(layer.synthetic, true);
    assert.equal(layer.chip, syntheticChipLabel);
    assert.equal(layer.x.length, entry.count);
    const chip = chipFor(layer);
    if (entry.count === 0) {
      assert.equal(chip, `${syntheticChipLabel} · 0 nuclei`);
    } else {
      assert.ok(chip?.startsWith(syntheticChipLabel));
      assert.ok(chip?.includes(entry.count.toLocaleString("en-US")));
    }
  }
});

test("every synthetic heatmap field is labelled", () => {
  for (const grid of [128, 256, 512]) {
    const field = generateField(grid, 3);
    assert.equal(field.synthetic, true);
    assert.equal(field.values.length, grid * grid);
    assert.equal(chipFor(field), fieldChipFor(String(grid)));
    assert.ok(chipFor(field)?.startsWith(syntheticChipLabel));
  }
});

test("a layer that is not synthetic gets no chip, and Off shows none in the drawer", () => {
  assert.equal(chipFor({ synthetic: false, kind: "camelyon" }), null);
  assert.equal(nucleiChipFor(0), null);
  assert.ok(nucleiChipFor(10_000)?.startsWith(syntheticChipLabel));
});

test("the same seed gives the same nuclei, inside the extent", () => {
  const first = generateNuclei(10_000, 11, extent);
  const second = generateNuclei(10_000, 11, extent);
  const other = generateNuclei(10_000, 12, extent);
  assert.deepEqual(first.x, second.x);
  assert.notDeepEqual(first.x, other.x);
  for (let index = 0; index < first.count; index += 1) {
    assert.ok((first.x[index] ?? -1) >= 0 && (first.x[index] ?? Infinity) <= extent.width);
    assert.ok((first.y[index] ?? -1) >= 0 && (first.y[index] ?? Infinity) <= extent.height);
  }
});

test("the catalogue has 15 format samples and 5 big files, and the drawer lists them", () => {
  assert.equal(sampleCatalogue.filter((slide) => slide.group === "format").length, 15);
  assert.equal(sampleCatalogue.filter((slide) => slide.group === "big").length, 5);
  assert.equal(sampleSlides.length, 15);
  assert.equal(bigSlides.length, 5);
  assert.equal(new Set(sampleCatalogue.map((slide) => slide.name)).size, 20);
  assert.ok(sampleCatalogue.some((slide) => slide.source === "local"));
});

test("four CAMELYON16 slides are loadable", () => {
  assert.deepEqual([...camelyonSlides], ["T016", "T009", "T001", "T002"]);
});
