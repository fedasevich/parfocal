import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AgreementKind,
  agreementColours,
  agreementCueOf,
  agreementKinds,
  agreementOverlays,
  comparisonKinds,
  comparisonLabels,
} from "../../src/index.ts";

const square = (x: number) => [x, 0, x + 10, 0, x + 10, 10, x, 10];

const objects = [
  { id: "A", ring: square(0), agreement: "both" as const },
  { id: "B", ring: square(20), agreement: "only-a" as const },
  { id: "C", ring: square(40), agreement: "only-b" as const },
  { id: "D", ring: square(60), agreement: "only-b" as const },
];

test("every agreement kind has its own non-colour cue", () => {
  const cues = agreementKinds.map(agreementCueOf);
  assert.equal(new Set(cues).size, agreementKinds.length);
  assert.equal(agreementCueOf("only-a"), "dashed");
  assert.equal(agreementCueOf("only-b"), "double");
});

test("the three kinds draw with different line styles even when the colours are the same", () => {
  const grey = [128, 128, 128, 255] as const;
  const colours = { both: grey, "only-a": grey, "only-b": grey };
  const style = (agreement: AgreementKind) =>
    agreementOverlays({
      id: "x",
      colours,
      objects: objects.filter((object) => object.agreement === agreement),
    }).overlays.map(({ style }) => [style.dash, style.lineWidthPx, style.lineColor]);
  const solid = JSON.stringify(style("both"));
  const dashed = JSON.stringify(style("only-a"));
  const double = JSON.stringify(style("only-b"));
  assert.notEqual(solid, dashed);
  assert.notEqual(solid, double);
  assert.notEqual(dashed, double);
});

test("a dashed kind sets a dash and a double kind draws two lines", () => {
  const only = (agreement: AgreementKind) =>
    agreementOverlays({
      id: "x",
      objects: objects.filter((object) => object.agreement === agreement),
    }).overlays;
  assert.equal(only("both").length, 1);
  assert.equal(only("both")[0]?.style.dash, null);
  assert.equal(only("only-a").length, 1);
  assert.notEqual(only("only-a")[0]?.style.dash, null);
  const double = only("only-b");
  assert.equal(double.length, 2);
  assert.ok((double[0]?.style.lineWidthPx ?? 0) > (double[1]?.style.lineWidthPx ?? 0));
  assert.ok((double[1]?.order ?? 0) > (double[0]?.order ?? 0));
});

test("counts and cues follow the objects", () => {
  const drawn = agreementOverlays({ id: "x", objects });
  assert.deepEqual(drawn.counts, { both: 1, "only-a": 1, "only-b": 2 });
  assert.equal(drawn.cues.B, "dashed");
  assert.equal(drawn.cues.D, "double");
});

test("colours differ between kinds and every comparison labels every kind", () => {
  const colours = agreementKinds.map((kind) => agreementColours[kind].join(","));
  assert.equal(new Set(colours).size, 3);
  for (const comparison of comparisonKinds) {
    for (const kind of agreementKinds) {
      assert.ok(comparisonLabels[comparison][kind].length > 0);
    }
  }
});
