import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confidenceTints,
  createObjectDrawing,
  type DrawnObject,
  drawSettingsFromChoices,
  type OverlayLayer,
  type OverlayRegistration,
} from "../../src/index.ts";

const square = (x: number, size = 10) => [x, 0, x + size, 0, x + size, size, x, size];

const objects: DrawnObject[] = [
  { id: "A", kind: "cell", ring: square(0), className: "tumor", score: 0.9 },
  { id: "B", kind: "cell", ring: square(20), className: "stroma", score: 0.1 },
];

function fakeHost() {
  const layers = new Map<string, OverlayLayer>();
  return {
    layers,
    host: {
      registerOverlay: (layer: OverlayLayer): OverlayRegistration => {
        layers.set(layer.id, layer);
        return {
          update: (next) => layers.set(next.id, next),
          invalidate: () => {},
          unregister: () => layers.delete(layer.id),
        };
      },
    },
  };
}

test("display choices become draw settings and ignore unknown words", () => {
  const settings = drawSettingsFromChoices({
    draw: "fill",
    width: "3",
    opacity: 5,
    colorBy: "score",
    cutoff: 2,
  });
  assert.equal(settings.draw, "fill");
  assert.equal(settings.widthPx, 3);
  assert.equal(settings.opacity, 20);
  assert.equal(settings.colourBy, "score");
  assert.equal(settings.cutoff, 1);
  assert.equal(drawSettingsFromChoices({ draw: "weird", width: "9" }).draw, "outline");
  assert.equal(drawSettingsFromChoices({ width: "9" }).widthPx, 2);
});

test("the live drawing registers the main and dimmed overlays and drops stale ones", () => {
  const { host, layers } = fakeHost();
  const drawing = createObjectDrawing({ id: "live", host });
  drawing.setObjects(objects);
  drawing.setChoices({ cutoff: 0.5 });
  assert.deepEqual([...layers.keys()].sort(), ["live:below", "live:main"]);
  assert.deepEqual(drawing.result()?.belowCutoff, ["B"]);
  drawing.setChoices({ cutoff: 0 });
  assert.deepEqual([...layers.keys()], ["live:main"]);
  drawing.clear();
  assert.equal(layers.size, 0);
});

test("the confidence colour choice tints the current ring and other choices keep it white", () => {
  const { host, layers } = fakeHost();
  const drawing = createObjectDrawing({ id: "live", host });
  drawing.setObjects(objects);
  drawing.setChoices({ confidence: "color", cutoff: 0 });
  drawing.setCurrent("B");
  assert.ok(layers.has("live:current"));
  const tinted = JSON.stringify(layers.get("live:current"));
  drawing.setChoices({ confidence: "number", cutoff: 0 });
  assert.notEqual(JSON.stringify(layers.get("live:current")), tinted);
  assert.deepEqual(confidenceTints.doubtful, [248, 113, 113, 255]);
  drawing.setCurrent(null);
  assert.ok(!layers.has("live:current"));
});

test("hidden classes leave the live drawing but stay in scope", () => {
  const { host } = fakeHost();
  const drawing = createObjectDrawing({ id: "live", host });
  drawing.setObjects(objects);
  drawing.setChoices({ cutoff: 0 });
  drawing.setHiddenClasses(new Set(["stroma"]));
  assert.deepEqual(drawing.result()?.hiddenByClass, ["B"]);
  assert.deepEqual(drawing.result()?.scope, ["A", "B"]);
});
