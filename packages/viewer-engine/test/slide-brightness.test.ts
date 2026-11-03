import assert from "node:assert/strict";
import { test } from "node:test";
import { slideTint } from "../src/engine/brightness.ts";
import { clampSlideBrightness, createViewerEngine, slideBrightnessFactor } from "../src/index.ts";
import { FakeContainer, FakeFrames, FakeRenderer, FakeResize, FakeSource } from "./engine-fakes.ts";

function setup() {
  const renderer = new FakeRenderer();
  const engine = createViewerEngine({
    createRenderer: renderer.create,
    openSlide: new FakeSource().open,
    frames: new FakeFrames(),
    observeResize: new FakeResize().observe,
  });
  return { engine, renderer, container: new FakeContainer() };
}

test("brightness is clamped to 20 to 140 and rounded to a whole percent", () => {
  assert.equal(clampSlideBrightness(5), 20);
  assert.equal(clampSlideBrightness(400), 140);
  assert.equal(clampSlideBrightness(87.4), 87);
  assert.equal(clampSlideBrightness(Number.NaN), 100);
  assert.equal(slideBrightnessFactor(60), 0.6);
});

test("the slide tint scales every channel alike", () => {
  assert.deepEqual(slideTint(1), [255, 255, 255]);
  assert.deepEqual(slideTint(0.6), [153, 153, 153]);
});

test("a mounted route starts at 100% and gets every later change as a factor", () => {
  const { engine, renderer, container } = setup();
  engine.mount(container);
  const route = renderer.last();
  assert.deepEqual(route.brightness, [1]);
  engine.setSlideBrightness(60);
  engine.setSlideBrightness(60);
  engine.setSlideBrightness(300);
  assert.deepEqual(route.brightness, [1, 0.6, 1.4]);
  assert.equal(engine.getSlideBrightness(), 140);
});

test("brightness set before mounting reaches the route on mount", () => {
  const { engine, renderer, container } = setup();
  engine.setSlideBrightness(40);
  engine.mount(container);
  assert.deepEqual(renderer.last().brightness, [0.4]);
});
