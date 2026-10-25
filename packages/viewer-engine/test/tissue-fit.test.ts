import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Camera,
  createViewerEngine,
  type EngineSlide,
  fitArea,
  fitCamera,
  type SlideArea,
  tissueArea,
  tissueMarginShare,
} from "../src/index.ts";
import { FakeContainer, FakeFrames, FakeRenderer, FakeResize } from "./engine-fakes.ts";

const slide = { width: 40_000, height: 30_000 };
const viewport = { width: 800, height: 600 };
const limits = { minZoom: -10, maxZoom: 2 };
const box: SlideArea = { x: 10_000, y: 6_000, width: 20_000, height: 15_000 };

function near(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);
}

describe("the tissue box with its margin", () => {
  it("adds 5 percent of each side on every edge", () => {
    assert.equal(tissueMarginShare, 0.05);
    assert.deepEqual(tissueArea(box, slide), {
      x: 9_000,
      y: 5_250,
      width: 22_000,
      height: 16_500,
    });
  });

  it("stops the margin at the slide edge", () => {
    const edge = tissueArea({ x: 0, y: 29_000, width: 40_000, height: 1_000 }, slide);
    assert.deepEqual(edge, { x: 0, y: 28_950, width: 40_000, height: 1_050 });
  });

  it("keeps only the part of the box that lies on the slide", () => {
    const partly = tissueArea({ x: -2_000, y: 0, width: 4_000, height: 30_000 }, slide);
    assert.deepEqual(partly, { x: 0, y: 0, width: 2_100, height: 30_000 });
  });

  it("ignores a missing, empty, non-finite or off-slide box", () => {
    for (const unusable of [
      null,
      undefined,
      { x: 100, y: 100, width: 0, height: 50 },
      { x: 100, y: 100, width: 50, height: -4 },
      { x: Number.NaN, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 },
      { x: 50_000, y: 0, width: 10, height: 10 },
    ]) {
      assert.equal(tissueArea(unusable, slide), null);
    }
  });
});

describe("fitting a slide to its tissue", () => {
  it("fits the margined box and centres on it", () => {
    const camera = fitCamera(slide, viewport, limits, box);
    near(camera.x, 20_000);
    near(camera.y, 13_500);
    near(camera.zoom, Math.log2(800 / 22_000));
  });

  it("zooms in on the tissue compared with the whole slide", () => {
    const whole = fitCamera(slide, viewport, limits);
    const tissue = fitCamera(slide, viewport, limits, box);
    near(whole.zoom, Math.log2(800 / 40_000));
    near(tissue.zoom - whole.zoom, Math.log2(40_000 / 22_000));
  });

  it("fits the whole slide without a mask", () => {
    const whole = fitCamera(slide, viewport, limits);
    assert.deepEqual(fitCamera(slide, viewport, limits, null), whole);
    assert.deepEqual(fitCamera(slide, viewport, limits, undefined), whole);
    assert.deepEqual(whole, { x: 20_000, y: 15_000, zoom: Math.log2(800 / 40_000) });
  });

  it("fits the whole slide when the mask box is unusable", () => {
    const whole = fitCamera(slide, viewport, limits);
    const empty = { x: 0, y: 0, width: 0, height: 0 };
    assert.deepEqual(fitCamera(slide, viewport, limits, empty), whole);
  });

  it("never zooms past the zoom limit on a tiny tissue box", () => {
    const speck = { x: 20_000, y: 15_000, width: 10, height: 10 };
    assert.equal(fitCamera(slide, viewport, limits, speck).zoom, limits.maxZoom);
  });

  it("names the fitted area for the camera code and the engine", () => {
    assert.deepEqual(fitArea(slide, null), { x: 0, y: 0, width: 40_000, height: 30_000 });
    assert.deepEqual(fitArea(slide, box), tissueArea(box, slide));
  });
});

function setup(tissue: SlideArea | null) {
  const renderer = new FakeRenderer();
  const frames = new FakeFrames();
  const container = new FakeContainer();
  const resize = new FakeResize();
  const engine = createViewerEngine<EngineSlide>({
    createRenderer: renderer.create,
    openSlide: (ref) =>
      Promise.resolve({
        id: ref.id,
        ...slide,
        micronsPerPixel: 0.25,
        tissue,
        close: () => undefined,
      }),
    zoomLimits: limits,
    frames,
    observeResize: resize.observe,
    devicePixelRatio: () => 1,
  });
  return { engine, container, resize };
}

function assertCamera(actual: Camera, expected: Camera): void {
  near(actual.x, expected.x);
  near(actual.y, expected.y);
  near(actual.zoom, expected.zoom);
}

describe("the engine opens a slide fitted to its tissue", () => {
  it("opens fitted to the tissue box, and the fit command returns to the same box", async () => {
    const { engine, container } = setup(box);
    engine.mount(container);
    await engine.openSlide({ id: "with-mask" });
    const expected = fitCamera(slide, container.rect, engine.getCameraBounds(), box);
    assertCamera(engine.getCamera(), expected);
    engine.setCamera({ x: 100, y: 100, zoom: 1 });
    engine.fitToSlide();
    assertCamera(engine.getCamera(), expected);
  });

  it("opens fitted to the whole slide without a mask", async () => {
    const { engine, container } = setup(null);
    engine.mount(container);
    await engine.openSlide({ id: "no-mask" });
    assertCamera(engine.getCamera(), fitCamera(slide, container.rect, engine.getCameraBounds()));
    assertCamera(engine.getCamera(), { x: 20_000, y: 15_000, zoom: Math.log2(800 / 40_000) });
  });

  it("fits the tissue on the first resize when the viewport had no size at open", async () => {
    const { engine, container, resize } = setup(box);
    container.rect = { left: 0, top: 0, width: 0, height: 0 };
    engine.mount(container);
    await engine.openSlide({ id: "late-viewport" });
    near(engine.getCamera().x, 20_000);
    near(engine.getCamera().y, 13_500);
    container.rect = { left: 0, top: 0, width: 800, height: 600 };
    resize.fire(container);
    assertCamera(engine.getCamera(), fitCamera(slide, viewport, engine.getCameraBounds(), box));
  });

  it("keeps the zoom-out limit at half the whole-slide fit", async () => {
    const { engine, container } = setup(box);
    engine.mount(container);
    await engine.openSlide({ id: "limits" });
    near(engine.getCameraBounds().minZoom, Math.log2(800 / 40_000) - 1);
  });
});
