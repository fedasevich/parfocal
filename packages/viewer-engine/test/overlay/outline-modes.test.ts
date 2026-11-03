import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classColors,
  confidenceBand,
  fadeAlpha,
  fadeStrength,
  isUnsureCall,
  nearBlack,
  outlineModeOverlays,
  type TypedOutline,
  white,
} from "../../src/index.ts";

const square = [0, 0, 10, 0, 10, 10, 0, 10];

const outlines: TypedOutline[] = [
  { ring: square, className: "tumor", top: 0.95, second: 0.03 },
  { ring: square, className: "stroma", top: 0.7, second: 0.2 },
  { ring: square, className: "immune", top: 0.45, second: 0.4 },
  { ring: square, className: "other", top: 0.3, second: 0.28 },
];

function alphas(colors: Uint8Array): number[] {
  return Array.from({ length: colors.length / 4 }, (_, item) => colors[item * 4 + 3] ?? 0);
}

test("fade grows from 0.12 at a uniform guess to full at certainty", () => {
  assert.equal(fadeStrength(0.25), 0);
  assert.equal(fadeStrength(1), 1);
  assert.equal(fadeStrength(0.1), 0);
  assert.equal(fadeAlpha(0.25), 0.12);
  assert.equal(fadeAlpha(1), 1);
  assert.ok(Math.abs(fadeAlpha(0.625) - 0.56) < 1e-9);
});

test("the four bands cut at 80, 55 and 40 percent", () => {
  assert.equal(confidenceBand(0.8), "confident");
  assert.equal(confidenceBand(0.79), "likely");
  assert.equal(confidenceBand(0.55), "likely");
  assert.equal(confidenceBand(0.5), "unsure");
  assert.equal(confidenceBand(0.39), "doubtful");
});

test("a call is unsure under 40 percent or within 10 points of the runner up", () => {
  assert.equal(isUnsureCall(0.39, 0.2), true);
  assert.equal(isUnsureCall(0.6, 0.55), true);
  assert.equal(isUnsureCall(0.6, 0.3), false);
});

test("fade keeps every outline in its class colour with alpha from the probability", () => {
  const [overlay, extra] = outlineModeOverlays({ id: "n", mode: "fade", outlines });
  assert.equal(extra, undefined);
  const colors = overlay?.shapes.polygons?.colors;
  assert.ok(colors);
  assert.deepEqual(Array.from(colors.subarray(0, 3)), classColors.tumor.slice(0, 3));
  assert.deepEqual(alphas(colors), [240, 165, 90, 46]);
});

test("bands step the alpha by band and draw a different picture from fade", () => {
  const [overlay] = outlineModeOverlays({ id: "n", mode: "bands", outlines });
  const colors = overlay?.shapes.polygons?.colors;
  assert.ok(colors);
  assert.deepEqual(alphas(colors), [255, 140, 56, 31]);
});

test("mark unsure draws unsure calls as white dashes on a dark casing above the rest", () => {
  const [plain, marked] = outlineModeOverlays({ id: "n", mode: "mark-unsure", outlines });
  assert.ok(plain && marked);
  assert.equal(plain.shapes.polygons?.count, 2);
  assert.equal(marked.shapes.polygons?.count, 2);
  assert.equal(marked.id, "n:unsure");
  assert.equal(marked.kind, plain.kind);
  assert.equal(marked.order, plain.order + 1);
  assert.deepEqual(marked.style.lineColor, white);
  assert.deepEqual(marked.style.casing?.color, nearBlack);
  assert.ok(marked.style.dash);
  assert.equal(plain.style.lineColor, null);
  assert.equal(plain.style.dash, null);
  assert.deepEqual(alphas(plain.shapes.polygons?.colors ?? new Uint8Array()), [255, 255]);
});

test("mark unsure with no unsure call gives one overlay", () => {
  const sure = outlines.slice(0, 2);
  assert.equal(outlineModeOverlays({ id: "n", mode: "mark-unsure", outlines: sure }).length, 1);
});

test("in fade and bands the casing fades with its outline, in mark unsure the dashes do not", () => {
  for (const mode of ["fade", "bands"] as const) {
    const [overlay] = outlineModeOverlays({ id: "n", mode, outlines });
    assert.equal(overlay?.style.casing?.followsAlpha, true);
  }
  const [, marked] = outlineModeOverlays({ id: "n", mode: "mark-unsure", outlines });
  assert.notEqual(marked?.style.casing?.followsAlpha, true);
});
