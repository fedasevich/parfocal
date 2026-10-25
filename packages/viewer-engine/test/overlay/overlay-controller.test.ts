import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOverlayController,
  createPinOverlay,
  createRasterOverlay,
  createVectorOverlay,
  createViewerEngine,
  isOverlayDescription,
  overlayOrder,
  overlayStack,
  pointBatchFromPoints,
  polygonBatchFromRings,
  withOverlayState,
} from "../../src/index.ts";
import {
  FakeContainer,
  FakeFrames,
  FakeRenderer,
  FakeResize,
  FakeSource,
} from "../engine-fakes.ts";

const red = [255, 0, 0, 255] as const;

const square = polygonBatchFromRings([{ ring: [0, 0, 10, 0, 10, 10, 0, 10], color: red }]);

function annotations(id: string, kind: "human-annotations" | "ai-proposals" = "human-annotations") {
  return createVectorOverlay({ id, kind, shapes: { polygons: square } });
}

function heatmap(id: string, kind: "heatmap" | "coverage" = "heatmap") {
  return createRasterOverlay({
    id,
    kind,
    raster: {
      width: 1,
      height: 1,
      rgba: new Uint8Array(4),
      area: { x: 0, y: 0, width: 10, height: 10 },
    },
  });
}

function pins(id: string) {
  return createPinOverlay({
    id,
    pins: { count: 1, positions: new Float32Array([1, 2]), resolved: new Uint8Array([0]) },
  });
}

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

test("a layer takes its order from its kind, whatever the caller does", () => {
  for (const kind of overlayStack) {
    const layer =
      kind === "heatmap" || kind === "coverage"
        ? heatmap("r", kind)
        : kind === "comment-pins"
          ? pins("p")
          : createVectorOverlay({ id: "v", kind, shapes: {} });
    assert.equal(layer.order, overlayOrder(kind));
  }
});

test("a new layer is visible and fully opaque with the style of its kind", () => {
  const layer = annotations("a");
  assert.equal(layer.visible, true);
  assert.equal(layer.opacity, 1);
  assert.equal(layer.style.lineWidthPx, 2);
  const nuclei = createVectorOverlay({
    id: "n",
    kind: "nuclei",
    shapes: {},
    style: { lineWidthPx: 3 },
  });
  assert.equal(nuclei.style.lineWidthPx, 3);
  assert.equal(nuclei.style.pointRadiusPx, 2);
});

test("a heatmap is smoothed and a coverage mask is not", () => {
  assert.equal(heatmap("h", "heatmap").raster.smooth, true);
  assert.equal(heatmap("c", "coverage").raster.smooth, false);
});

test("opacity is clamped to 0 to 1 and NaN is refused", () => {
  assert.equal(withOverlayState(annotations("a"), { opacity: 3 }).opacity, 1);
  assert.equal(withOverlayState(annotations("a"), { opacity: -1 }).opacity, 0);
  assert.throws(() => withOverlayState(annotations("a"), { opacity: Number.NaN }), RangeError);
});

test("changing visibility or opacity keeps the geometry objects", () => {
  const layer = annotations("a");
  const hidden = withOverlayState(layer, { visible: false });
  const faded = withOverlayState(hidden, { opacity: 0.4 });
  assert.equal(hidden.shapes, layer.shapes);
  assert.equal(faded.shapes, layer.shapes);
  assert.equal(faded.visible, false);
  assert.equal(faded.opacity, 0.4);
  assert.equal(layer.visible, true);
});

test("a raster or pin batch that does not add up is refused", () => {
  assert.throws(
    () =>
      createRasterOverlay({
        id: "r",
        kind: "heatmap",
        raster: {
          width: 2,
          height: 2,
          rgba: new Uint8Array(4),
          area: { x: 0, y: 0, width: 1, height: 1 },
        },
      }),
    /one RGBA value for each pixel/,
  );
  assert.throws(
    () =>
      createPinOverlay({
        id: "p",
        pins: { count: 2, positions: new Float32Array(2), resolved: new Uint8Array(2) },
      }),
    /a position and a state/,
  );
});

test("a bare engine overlay is not a typed description", () => {
  assert.equal(isOverlayDescription({ id: "x", order: 1 }), false);
  assert.equal(isOverlayDescription({ id: "x", order: 1, kind: "labels" } as never), false);
  assert.equal(isOverlayDescription(annotations("a")), true);
});

test("layers registered before the route exists reach it at mount, in stack order", () => {
  const { engine, renderer, container } = setup();
  const layers = createOverlayController(engine);
  layers.set(pins("pins"));
  layers.set(annotations("human"));
  layers.set(heatmap("heat"));
  layers.set(createVectorOverlay({ id: "dots", kind: "nuclei", shapes: {} }));
  engine.mount(container);
  assert.deepEqual(
    renderer.last().overlays.map((layer) => layer.id),
    ["heat", "dots", "human", "pins"],
  );
});

test("registering the stack in reverse order gives the same order", () => {
  const forward = setup();
  const backward = setup();
  const make = () => [
    heatmap("coverage", "coverage"),
    heatmap("heat"),
    createVectorOverlay({ id: "nuclei", kind: "nuclei", shapes: {} }),
    annotations("ai", "ai-proposals"),
    annotations("human"),
    createVectorOverlay({ id: "ruler", kind: "measurements", shapes: {} }),
    pins("pins"),
  ];
  const forwardLayers = createOverlayController(forward.engine);
  for (const layer of make()) forwardLayers.set(layer);
  const backwardLayers = createOverlayController(backward.engine);
  for (const layer of make().reverse()) backwardLayers.set(layer);
  forward.engine.mount(forward.container);
  backward.engine.mount(backward.container);
  const names = (renderer: FakeRenderer) => renderer.last().overlays.map((layer) => layer.id);
  assert.deepEqual(names(forward.renderer), [
    "coverage",
    "heat",
    "nuclei",
    "ai",
    "human",
    "ruler",
    "pins",
  ]);
  assert.deepEqual(names(backward.renderer), names(forward.renderer));
});

test("two layers of one kind keep their registration order, so the later one draws on top", () => {
  const { engine, renderer, container } = setup();
  const layers = createOverlayController(engine);
  engine.mount(container);
  layers.set(annotations("first"));
  layers.set(annotations("second"));
  assert.deepEqual(
    renderer.last().overlays.map((layer) => layer.id),
    ["first", "second"],
  );
});

test("visibility and opacity changes reach a mounted route without registering again", () => {
  const { engine, renderer, container } = setup();
  const layers = createOverlayController(engine);
  const layer = annotations("human");
  layers.set(layer);
  engine.mount(container);
  const route = renderer.last();
  layers.setVisible("human", false);
  layers.setOpacity("human", 0.5);
  const current = route.overlays[0] as ReturnType<typeof annotations>;
  assert.equal(current.visible, false);
  assert.equal(current.opacity, 0.5);
  assert.equal(current.shapes, layer.shapes);
  assert.equal(route.overlays.length, 1);
  assert.equal(layers.get("human"), current);
});

test("setting a layer again replaces it and removing it takes it out of the route", () => {
  const { engine, renderer, container } = setup();
  const layers = createOverlayController(engine);
  engine.mount(container);
  layers.set(annotations("human"));
  const replacement = annotations("human");
  layers.set(replacement);
  assert.equal(renderer.last().overlays.length, 1);
  assert.equal(renderer.last().overlays[0], replacement);
  layers.remove("human");
  layers.remove("human");
  assert.equal(renderer.last().overlays.length, 0);
  assert.equal(layers.get("human"), undefined);
});

test("invalidating asks the route to rebuild just that layer", () => {
  const { engine, renderer, container } = setup();
  const layers = createOverlayController(engine);
  engine.mount(container);
  layers.set(annotations("human"));
  layers.invalidate("human");
  assert.deepEqual(renderer.last().invalidated, ["human"]);
  assert.throws(() => layers.invalidate("missing"), /not in the controller/);
});

test("clearing removes every layer and survives a remount of the route", () => {
  const { engine, renderer, container } = setup();
  const layers = createOverlayController(engine);
  layers.set(annotations("a"));
  layers.set(heatmap("b"));
  engine.mount(container);
  engine.unmount();
  engine.mount(container);
  assert.equal(renderer.last().overlays.length, 2);
  layers.clear();
  assert.equal(renderer.last().overlays.length, 0);
  assert.deepEqual(layers.list(), []);
});

test("updating a layer after the engine is disposed does nothing", () => {
  const { engine } = setup();
  const registration = engine.registerOverlay(annotations("a"));
  engine.dispose();
  registration.update(annotations("a"));
  registration.unregister();
});

test("a layer cannot change its id through update", () => {
  const { engine } = setup();
  const registration = engine.registerOverlay(annotations("a"));
  assert.throws(() => registration.update(annotations("b")), /cannot become/);
});

test("point batches keep their identity through state changes", () => {
  const points = pointBatchFromPoints([{ x: 1, y: 1, color: red }]);
  const layer = createVectorOverlay({ id: "p", kind: "measurements", shapes: { points } });
  assert.equal(withOverlayState(layer, { visible: false }).shapes.points, points);
});
