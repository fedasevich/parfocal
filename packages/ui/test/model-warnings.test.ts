import assert from "node:assert/strict";
import { test } from "node:test";
import type { TypeCall } from "../src/lib/confidence-words.ts";
import {
  modelWarnings,
  type SlideStatistics,
  slideStatistics,
  type TyperMetadata,
} from "../src/lib/model-warnings.ts";

const hoverNext: TyperMetadata = {
  name: "HoVer-NeXt",
  calibrated: true,
  testSetAccuracy: 0.83,
  testSetConfidentShare: 0.59,
  testSetUnsureShare: 0.075,
  validatedSites: ["Breast", "Colon", "Lung"],
};

const typical: SlideStatistics = {
  typedCells: 500,
  confidentShare: 0.55,
  unsureShare: 0.08,
  site: "breast",
};

const kinds = (typer: TyperMetadata, slide?: SlideStatistics) =>
  modelWarnings(typer, slide).map((warning) => warning.kind);

test("a well measured typer on a familiar slide gets no warnings", () => {
  assert.deepEqual(kinds(hoverNext, typical), []);
});

test("a typer under 70% on its own test set is warned about", () => {
  const warnings = modelWarnings({
    ...hoverNext,
    name: "CoNSeP classifier",
    testSetAccuracy: 0.49,
  });
  assert.deepEqual(
    warnings.map((warning) => warning.kind),
    ["low-accuracy"],
  );
  assert.match(warnings[0]?.text ?? "", /49%/);
  assert.deepEqual(kinds({ ...hoverNext, testSetAccuracy: 0.7 }), []);
});

test("an uncalibrated typer is warned about", () => {
  assert.deepEqual(kinds({ ...hoverNext, calibrated: false }, typical), ["uncalibrated"]);
});

test("a confident share far below the test set's warns out of distribution", () => {
  const cmu1 = { ...typical, confidentShare: 0.23 };
  const warnings = modelWarnings(hoverNext, cmu1);
  assert.deepEqual(
    warnings.map((warning) => warning.kind),
    ["out-of-distribution"],
  );
  assert.match(warnings[0]?.text ?? "", /23% of cells here against 59%/);
  assert.deepEqual(kinds(hoverNext, { ...typical, confidentShare: 0.36 }), []);
});

test("the confident share rule needs a reference share of at least 20%", () => {
  const timid = { ...hoverNext, testSetConfidentShare: 0.15 };
  assert.deepEqual(kinds(timid, { ...typical, confidentShare: 0.01 }), []);
});

test("an unsure share 15 points over the test set's is warned about", () => {
  assert.deepEqual(kinds(hoverNext, { ...typical, unsureShare: 0.3 }), ["many-unsure"]);
  assert.deepEqual(kinds(hoverNext, { ...typical, unsureShare: 0.2 }), []);
});

test("slide share warnings wait for at least 100 typed cells", () => {
  const small = {
    ...typical,
    typedCells: 99,
    confidentShare: 0.1,
    unsureShare: 0.6,
  };
  assert.deepEqual(kinds(hoverNext, small), []);
  assert.deepEqual(kinds(hoverNext, { ...small, typedCells: 100 }), [
    "out-of-distribution",
    "many-unsure",
  ]);
});

test("a site outside the validated list is warned about", () => {
  const warnings = modelWarnings(hoverNext, { ...typical, site: "Lymph node" });
  assert.deepEqual(
    warnings.map((warning) => warning.kind),
    ["site-not-validated"],
  );
  assert.match(warnings[0]?.text ?? "", /not validated on Lymph node tissue/);
  assert.deepEqual(kinds(hoverNext, { ...typical, site: " COLON " }), []);
  assert.deepEqual(
    kinds({ name: "HoVer-NeXt", calibrated: true }, { ...typical, site: "Lymph node" }),
    [],
  );
});

test("missing metadata raises no warning it cannot back", () => {
  const bare: TyperMetadata = { name: "New typer", calibrated: true };
  assert.deepEqual(
    kinds(bare, {
      typedCells: 1000,
      confidentShare: 0,
      unsureShare: 1,
      site: "Skin",
    }),
    [],
  );
});

test("slide statistics count confident and unsure cells from type calls", () => {
  const cell = (...probabilities: number[]): TypeCall[] =>
    probabilities.map((probability, index) => ({
      label: `class ${index}`,
      probability,
    }));
  const stats = slideStatistics(
    [cell(0.9, 0.1), cell(0.85, 0.15), cell(0.6, 0.4), cell(0.45, 0.4), cell(0.3, 0.3), []],
    undefined,
    "Breast",
  );
  assert.equal(stats.typedCells, 5);
  assert.equal(stats.confidentShare, 0.4);
  assert.equal(stats.unsureShare, 0.4);
  assert.equal(stats.site, "Breast");
  assert.deepEqual(slideStatistics([]), {
    typedCells: 0,
    confidentShare: 0,
    unsureShare: 0,
    site: undefined,
  });
});

test("statistics from many unsure cells drive the warnings end to end", () => {
  const cells = Array.from({ length: 120 }, (_, index): TypeCall[] =>
    index < 20
      ? [{ label: "tumor", probability: 0.9 }]
      : [
          { label: "tumor", probability: 0.5 },
          { label: "immune", probability: 0.45 },
        ],
  );
  assert.deepEqual(kinds(hoverNext, slideStatistics(cells, undefined, "Breast")), [
    "out-of-distribution",
    "many-unsure",
  ]);
});
