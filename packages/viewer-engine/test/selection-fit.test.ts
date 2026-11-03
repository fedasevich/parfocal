import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Camera,
  type CameraBounds,
  createViewerEngine,
  type SlideArea,
  selectionCamera,
  selectionMarginPx,
  slideToScreen,
  type Viewport,
} from "../src/index.ts";
import {
  FakeClock,
  FakeContainer,
  FakeFrames,
  FakeRenderer,
  FakeResize,
  FakeSource,
  runFrames,
} from "./engine-fakes.ts";

const viewport: Viewport = { width: 800, height: 600 };
const limits: CameraBounds = { minZoom: -10, maxZoom: 2 };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function onScreen(area: SlideArea, camera: Camera, size: Viewport = viewport) {
  const rect = { left: 0, top: 0, width: size.width, height: size.height };
  const topLeft = slideToScreen(camera, rect, { x: area.x, y: area.y });
  const bottomRight = slideToScreen(camera, rect, {
    x: area.x + area.width,
    y: area.y + area.height,
  });
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: size.width - bottomRight.x,
    bottom: size.height - bottomRight.y,
  };
}

test("a wide selection is centred and fills the width less the margin on each side", () => {
  const area = { x: 10_000, y: 20_000, width: 1400, height: 200 };
  const camera = selectionCamera(area, viewport, limits);
  assert.equal(camera.x, 10_700);
  assert.equal(camera.y, 20_100);
  const gaps = onScreen(area, camera);
  assert.ok(near(gaps.left, selectionMarginPx));
  assert.ok(near(gaps.right, selectionMarginPx));
  assert.ok(gaps.top > selectionMarginPx);
  assert.ok(near(gaps.top, gaps.bottom));
});

test("a tall selection touches the margin at the top and bottom only", () => {
  const area = { x: 0, y: 0, width: 300, height: 2000 };
  const gaps = onScreen(area, selectionCamera(area, viewport, limits));
  assert.ok(near(gaps.top, selectionMarginPx));
  assert.ok(near(gaps.bottom, selectionMarginPx));
  assert.ok(gaps.left > selectionMarginPx);
});

test("the margin can be set per call", () => {
  const area = { x: 0, y: 0, width: 1000, height: 1000 };
  const gaps = onScreen(area, selectionCamera(area, viewport, limits, 100));
  assert.ok(near(gaps.top, 100));
  assert.ok(near(gaps.bottom, 100));
});

test("a tiny selection stops at the deepest zoom instead of filling the screen", () => {
  const area = { x: 500, y: 500, width: 2, height: 2 };
  assert.deepEqual(selectionCamera(area, viewport, limits), { x: 501, y: 501, zoom: 2 });
});

test("a point or a straight line still gets a camera", () => {
  assert.deepEqual(selectionCamera({ x: 40, y: 60, width: 0, height: 0 }, viewport, limits), {
    x: 40,
    y: 60,
    zoom: 2,
  });
  const line = { x: 0, y: 100, width: 1408, height: 0 };
  const camera = selectionCamera(line, viewport, limits);
  assert.ok(near(camera.zoom, Math.log2((800 - 2 * selectionMarginPx) / 1408)));
});

test("a selection larger than the zoom out limit is held at the limit", () => {
  const area = { x: 0, y: 0, width: 10_000_000, height: 10_000_000 };
  assert.equal(selectionCamera(area, viewport, limits).zoom, limits.minZoom);
});

test("the engine flies to the selection and ends with it inside the margin", async () => {
  const frames = new FakeFrames();
  const clock = new FakeClock();
  const engine = createViewerEngine({
    createRenderer: new FakeRenderer().create,
    openSlide: new FakeSource().open,
    zoomLimits: limits,
    frames,
    now: clock.now,
    reducedMotion: () => false,
    observeResize: new FakeResize().observe,
  });
  engine.mount(new FakeContainer());
  await engine.openSlide({ id: "a" });
  runFrames(frames, clock);
  const area = { x: 12_000, y: 9000, width: 704, height: 300 };
  const end = engine.flyToSelection(area);
  runFrames(frames, clock);
  assert.equal(await end, "arrived");
  const camera = engine.getCamera();
  assert.deepEqual(camera, { x: 12_352, y: 9150, zoom: 0 });
  const gaps = onScreen(area, camera);
  assert.ok(near(gaps.left, selectionMarginPx));
  assert.ok(near(gaps.right, selectionMarginPx));
});
