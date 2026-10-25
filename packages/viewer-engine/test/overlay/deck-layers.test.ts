import assert from "node:assert/strict";
import { before, test } from "node:test";
import {
  createPinOverlay,
  createRasterOverlay,
  createVectorOverlay,
  type OverlayDescription,
  pathBatchFromLines,
  pointBatchFromPoints,
  polygonBatchFromRings,
  withOverlayState,
} from "../../src/index.ts";
import { createOverlayLayerBuilder } from "../../src/overlay/deck/overlay-layers.ts";

class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

before(() => {
  Object.assign(globalThis, { ImageData: FakeImageData });
});

const red = [255, 0, 0, 255] as const;

const polygons = polygonBatchFromRings([
  { ring: [0, 0, 10, 0, 10, 10, 0, 10], color: red },
  { ring: [20, 20, 30, 20, 25, 30], color: [0, 255, 0, 255] },
]);

function vectors(
  id: string,
  kind: "human-annotations" | "nuclei" | "measurements" = "human-annotations",
) {
  return createVectorOverlay({
    id,
    kind,
    shapes: {
      polygons,
      paths: pathBatchFromLines([{ line: [0, 0, 5, 5], color: red }]),
      points: pointBatchFromPoints([{ x: 1, y: 1, color: red }]),
    },
  });
}

function heat(id: string) {
  return createRasterOverlay({
    id,
    kind: "heatmap",
    raster: {
      width: 2,
      height: 1,
      rgba: new Uint8Array(8),
      area: { x: 100, y: 200, width: 40, height: 20 },
    },
  });
}

function pins(id: string, resolved: number[]) {
  return createPinOverlay({
    id,
    pins: {
      count: resolved.length,
      positions: new Float32Array(resolved.length * 2),
      resolved: new Uint8Array(resolved),
    },
  });
}

function propsOf(layer: unknown): Record<string, unknown> {
  return (layer as { props: Record<string, unknown> }).props;
}

function ids(layers: readonly { id: string }[]): string[] {
  return layers.map((layer) => layer.id);
}

test("a vector layer becomes fills, outlines, paths and points", () => {
  const builder = createOverlayLayerBuilder();
  const layers = builder.build([vectors("a")]);
  assert.deepEqual(ids(layers), [
    "overlay:a:fills",
    "overlay:a:outlines",
    "overlay:a:paths",
    "overlay:a:points",
  ]);
});

test("a layer without fills, such as a measurement, draws no fill layer", () => {
  const builder = createOverlayLayerBuilder();
  assert.deepEqual(ids(builder.build([vectors("m", "measurements")])), [
    "overlay:m:outlines",
    "overlay:m:paths",
    "overlay:m:points",
  ]);
});

test("fills hand deck the precomputed triangle indices and skip its own triangulation", () => {
  const builder = createOverlayLayerBuilder();
  const [fills] = builder.build([vectors("a")]);
  const props = propsOf(fills);
  const data = props.data as { attributes: { indices: Uint32Array } };
  assert.equal(data.attributes.indices, polygons.indices);
  assert.equal(props._normalize, false);
});

test("outlines close each ring with its first two vertices", () => {
  const builder = createOverlayLayerBuilder();
  const layers = builder.build([vectors("a")]);
  const outlines = propsOf(layers[1]);
  const data = outlines.data as {
    startIndices: Uint32Array;
    attributes: { getPath: { value: Float32Array } };
  };
  assert.deepEqual([...data.startIndices], [0, 6, 11]);
  const path = data.attributes.getPath.value;
  assert.deepEqual([...path.subarray(4 * 2, 6 * 2)], [0, 0, 10, 0]);
  assert.deepEqual([...path.subarray(9 * 2, 11 * 2)], [20, 20, 30, 20]);
  assert.equal(outlines._pathType, "loop");
});

test("hiding a layer and changing its opacity reuse every data object", () => {
  const builder = createOverlayLayerBuilder();
  const layer = vectors("a");
  const before = builder.build([layer]);
  const hidden = builder.build([withOverlayState(layer, { visible: false })]);
  const faded = builder.build([withOverlayState(layer, { opacity: 0.25 })]);
  assert.deepEqual(ids(hidden), ids(before));
  before.forEach((built, index) => {
    assert.equal(propsOf(hidden[index]).data, propsOf(built).data);
    assert.equal(propsOf(faded[index]).data, propsOf(built).data);
    assert.equal(propsOf(hidden[index]).visible, false);
    assert.equal(propsOf(built).visible, true);
  });
  assert.equal(propsOf(faded[1]).opacity, 0.25);
  assert.equal(propsOf(faded[0]).opacity, 0.25 * layer.style.fillOpacity);
});

test("invalidating a layer gives deck new ids and new data", () => {
  const builder = createOverlayLayerBuilder();
  const layer = vectors("a");
  const first = builder.build([layer]);
  builder.invalidate("a");
  const second = builder.build([layer]);
  assert.notDeepEqual(ids(second), ids(first));
  first.forEach((built, index) => {
    assert.notEqual(propsOf(second[index]).data, propsOf(built).data);
  });
  const third = builder.build([layer]);
  assert.deepEqual(ids(third), ids(second));
  assert.equal(propsOf(third[0]).data, propsOf(second[0]).data);
});

test("replacing the geometry of a layer rebuilds its data", () => {
  const builder = createOverlayLayerBuilder();
  const first = builder.build([vectors("a")]);
  const second = builder.build([vectors("a")]);
  assert.notEqual(propsOf(second[1]).data, propsOf(first[1]).data);
});

test("a layer that leaves the list takes its layers and cache with it", () => {
  const builder = createOverlayLayerBuilder();
  const layer = vectors("a");
  const first = builder.build([layer, heat("h")]);
  assert.ok(ids(first).includes("overlay:h:raster"));
  const without = builder.build([layer]);
  assert.ok(!ids(without).includes("overlay:h:raster"));
  const again = builder.build([layer, heat("h")]);
  assert.ok(ids(again).includes("overlay:h:raster"));
  assert.equal(propsOf(builder.build([layer])[0]).data, propsOf(first[0]).data);
});

test("layers come out in the order they were given, so the engine's sort decides the stack", () => {
  const builder = createOverlayLayerBuilder();
  const stack: OverlayDescription[] = [heat("h"), vectors("a", "nuclei"), pins("p", [0])];
  const layers = builder.build(stack);
  assert.deepEqual(ids(layers), [
    "overlay:h:raster",
    "overlay:a:fills",
    "overlay:a:outlines",
    "overlay:a:paths",
    "overlay:a:points",
    "overlay:p:open",
  ]);
});

test("entries that are not typed overlays are skipped", () => {
  const builder = createOverlayLayerBuilder();
  assert.deepEqual(builder.build([{ id: "bare", order: 1 }]), []);
});

test("a heatmap sits in its slide area with the bottom edge at the larger y", () => {
  const builder = createOverlayLayerBuilder();
  const [layer] = builder.build([heat("h")]);
  const props = propsOf(layer);
  assert.deepEqual(props.bounds, [100, 220, 140, 200]);
  assert.deepEqual(props.textureParameters, {
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "none",
  });
});

test("pins split into an open and a resolved layer, and an empty state draws nothing", () => {
  const builder = createOverlayLayerBuilder();
  assert.deepEqual(ids(builder.build([pins("p", [0, 1, 0])])), [
    "overlay:p:open",
    "overlay:p:resolved",
  ]);
  assert.deepEqual(ids(builder.build([pins("p", [1, 1])])), ["overlay:p:resolved"]);
  assert.deepEqual(ids(builder.build([pins("p", [])])), []);
  const open = propsOf(builder.build([pins("q", [0, 1, 0])])[0]);
  assert.equal((open.data as { length: number }).length, 2);
});

test("no layer can be picked", () => {
  const builder = createOverlayLayerBuilder();
  const layers = builder.build([vectors("a"), heat("h"), pins("p", [0, 1])]);
  for (const layer of layers) assert.equal(propsOf(layer).pickable, false);
});
