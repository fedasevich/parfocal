import assert from "node:assert/strict";
import { test } from "node:test";
import {
  belowCutoffAlpha,
  belowCutoffDash,
  clampOpacity,
  classColors,
  confidenceTint,
  confidenceTints,
  type DrawnObject,
  type DrawSettings,
  decisionColours,
  defaultDrawSettings,
  drawObjectOverlays,
  scoreColour,
} from "../../src/index.ts";

const square = (x: number, y: number, size = 10) => [
  x,
  y,
  x + size,
  y,
  x + size,
  y + size,
  x,
  y + size,
];

const objects: DrawnObject[] = [
  { id: "T1", kind: "region", ring: square(0, 0, 40), className: "tumor", score: 0.9 },
  {
    id: "C1",
    kind: "cell",
    ring: square(50, 0),
    className: "immune",
    score: 0.8,
    decision: "agree",
  },
  {
    id: "C2",
    kind: "cell",
    ring: square(70, 0),
    className: "stroma",
    score: 0.3,
    decision: "unsure",
  },
  { id: "C3", kind: "cell", ring: square(90, 0), className: "other", score: 0.1 },
];

function draw(change: Partial<DrawSettings> = {}, current?: { id: string; tint: null }) {
  return drawObjectOverlays({
    id: "objects",
    objects,
    settings: { ...defaultDrawSettings, ...change },
    ...(current ? { current } : {}),
  });
}

function overlay(result: ReturnType<typeof draw>, part: string) {
  const found = result.overlays.find((item) => item.id === `objects:${part}`);
  assert.ok(found, `no ${part} overlay`);
  return found;
}

function alphas(colors: Uint8Array): number[] {
  return Array.from({ length: colors.length / 4 }, (_, item) => colors[item * 4 + 3] ?? 0);
}

test("outline draws no fill and fill draws a translucent one at the chosen width", () => {
  assert.equal(overlay(draw(), "main").style.fillOpacity, 0);
  assert.ok(overlay(draw({ draw: "fill" }), "main").style.fillOpacity > 0.3);
  for (const widthPx of [1, 2, 3] as const) {
    assert.equal(overlay(draw({ widthPx }), "main").style.lineWidthPx, widthPx);
  }
});

test("dots draw cells as points at their centre and keep regions as outlines", () => {
  const main = overlay(draw({ draw: "dots", cutoff: 0 }), "main");
  assert.equal(main.shapes.points?.count, 3);
  assert.equal(main.shapes.polygons?.count, 1);
  assert.deepEqual(Array.from(main.shapes.points?.positions ?? []).slice(0, 2), [55, 5]);
  assert.equal(overlay(draw(), "main").shapes.points, undefined);
});

test("opacity is clamped between 20 and 100 and sets the overlay opacity", () => {
  assert.equal(clampOpacity(5), 20);
  assert.equal(clampOpacity(250), 100);
  assert.equal(overlay(draw({ opacity: 40 }), "main").opacity, 0.4);
  assert.equal(overlay(draw({ opacity: 0 }), "main").opacity, 0.2);
  assert.equal(overlay(draw(), "main").opacity, 1);
});

test("colour by class, score and decision pick different colours", () => {
  const colourOf = (change: Partial<DrawSettings>, index: number) => {
    const batch = overlay(draw({ cutoff: 0, ...change }), "main").shapes.polygons;
    return Array.from(batch?.colors.subarray(index * 4, index * 4 + 3) ?? []);
  };
  assert.deepEqual(colourOf({ colourBy: "class" }, 0), [...classColors.tumor.slice(0, 3)]);
  assert.deepEqual(colourOf({ colourBy: "score" }, 0), [...scoreColour(0.9).slice(0, 3)]);
  assert.deepEqual(colourOf({ colourBy: "decision" }, 1), [...decisionColours.agree.slice(0, 3)]);
  assert.deepEqual(colourOf({ colourBy: "decision" }, 3), [...decisionColours.open.slice(0, 3)]);
  assert.notDeepEqual(scoreColour(0.1), scoreColour(0.9));
});

test("objects under the score cutoff draw dashed at half opacity", () => {
  const result = draw({ cutoff: 0.5 });
  assert.deepEqual(result.belowCutoff, ["C2", "C3"]);
  const below = overlay(result, "below");
  assert.deepEqual(below.style.dash, belowCutoffDash);
  assert.deepEqual(alphas(below.shapes.polygons?.colors ?? new Uint8Array()), [
    Math.round(255 * belowCutoffAlpha),
    Math.round(255 * belowCutoffAlpha),
  ]);
  const main = overlay(result, "main");
  assert.equal(main.style.dash, null);
  assert.deepEqual(alphas(main.shapes.polygons?.colors ?? new Uint8Array()), [255, 255]);
});

test("moving the cutoff dims more objects but never changes the scope", () => {
  const none = draw({ cutoff: 0 });
  const some = draw({ cutoff: 0.5 });
  const all = draw({ cutoff: 1 });
  assert.deepEqual(none.belowCutoff, []);
  assert.deepEqual(all.belowCutoff, ["T1", "C1", "C2", "C3"]);
  assert.ok(none.belowCutoff.length < some.belowCutoff.length);
  assert.ok(some.belowCutoff.length < all.belowCutoff.length);
  assert.deepEqual(none.scope, ["T1", "C1", "C2", "C3"]);
  assert.deepEqual(some.scope, none.scope);
  assert.deepEqual(all.scope, none.scope);
  assert.equal(
    none.overlays.some((item) => item.id === "objects:below"),
    false,
  );
  assert.equal(
    all.overlays.some((item) => item.id === "objects:main"),
    false,
  );
});

test("a hidden class stops drawing but stays in the scope", () => {
  const result = draw({ cutoff: 0, hiddenClasses: new Set(["immune"]) });
  assert.deepEqual(result.hiddenByClass, ["C1"]);
  assert.equal(overlay(result, "main").shapes.polygons?.count, 3);
  assert.deepEqual(result.scope, ["T1", "C1", "C2", "C3"]);
});

test("the current object gets its own outline, tinted by confidence when asked", () => {
  const tint = confidenceTint(0.3);
  assert.deepEqual(tint, confidenceTints.doubtful);
  const result = drawObjectOverlays({
    id: "objects",
    objects,
    settings: defaultDrawSettings,
    current: { id: "C2", tint },
  });
  const current = overlay(result, "current");
  assert.deepEqual(Array.from(current.shapes.polygons?.colors ?? []), [...tint]);
  assert.ok(current.order > overlay(result, "main").order);
  assert.equal(current.style.lineWidthPx, defaultDrawSettings.widthPx + 1);
  assert.equal(
    draw().overlays.some((item) => item.id === "objects:current"),
    false,
  );
});
