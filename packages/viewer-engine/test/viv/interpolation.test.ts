import assert from "node:assert/strict";
import { test } from "node:test";
import {
  finestTileSampler,
  type InterpolationRule,
  installTileInterpolation,
  interpolationRuleProp,
  usesNearestMagnification,
} from "../../src/viv/interpolation.ts";

test("only the finest level magnifies with nearest sampling", () => {
  assert.equal(usesNearestMagnification("finest-nearest", 0), true);
  assert.equal(usesNearestMagnification("finest-nearest", -1), false);
  assert.equal(usesNearestMagnification("finest-nearest", -8), false);
  assert.equal(usesNearestMagnification("finest-nearest", undefined), false);
  assert.equal(usesNearestMagnification("linear", 0), false);
});

test("the finest sampler magnifies nearest, minifies linear and clamps at the tile edge", () => {
  assert.deepEqual(finestTileSampler, {
    minFilter: "linear",
    magFilter: "nearest",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
});

interface FakeTexture {
  readonly samplers: unknown[];
  setSampler(sampler: unknown): void;
}

function fakeTexture(): FakeTexture {
  const samplers: unknown[] = [];
  return {
    samplers,
    setSampler: (sampler) => {
      samplers.push(sampler);
    },
  };
}

function fakeBitmapLayerClass() {
  class FakeBitmapLayer {
    props: { tileId?: { z: number }; [interpolationRuleProp]?: InterpolationRule };
    state: { bitmapTexture: FakeTexture | null } = { bitmapTexture: null };
    context: { device: { createSampler(props: unknown): unknown } };
    updates = 0;

    constructor(
      props: FakeBitmapLayer["props"],
      device: { createSampler(props: unknown): unknown },
    ) {
      this.props = props;
      this.context = { device };
    }

    updateState(_params: unknown): string {
      this.updates += 1;
      this.state.bitmapTexture ??= fakeTexture();
      return "stock";
    }
  }
  return FakeBitmapLayer;
}

function fakeDevice() {
  const created: unknown[] = [];
  return {
    created,
    createSampler: (props: unknown) => {
      const sampler = { props };
      created.push(sampler);
      return sampler;
    },
  };
}

test("a finest tile gets the shared nearest magnification sampler and the stock update still runs", () => {
  const Layer = fakeBitmapLayerClass();
  installTileInterpolation(Layer);
  const device = fakeDevice();
  const layer = new Layer({ tileId: { z: 0 } }, device);
  assert.equal(layer.updateState({}), "stock");
  assert.equal(layer.updates, 1);
  assert.equal(layer.state.bitmapTexture?.samplers.length, 1);
  assert.deepEqual(device.created, [{ props: finestTileSampler }]);
  const next = new Layer({ tileId: { z: 0 } }, device);
  next.updateState({});
  assert.equal(device.created.length, 1);
  assert.equal(next.state.bitmapTexture?.samplers[0], layer.state.bitmapTexture?.samplers[0]);
});

test("each device gets its own sampler, so a rebuilt device never reuses a lost one", () => {
  const Layer = fakeBitmapLayerClass();
  installTileInterpolation(Layer);
  const first = fakeDevice();
  const second = fakeDevice();
  new Layer({ tileId: { z: 0 } }, first).updateState({});
  new Layer({ tileId: { z: 0 } }, second).updateState({});
  assert.equal(first.created.length, 1);
  assert.equal(second.created.length, 1);
});

test("coarser tiles, tiles without a level and the linear rule keep the stock sampler", () => {
  const Layer = fakeBitmapLayerClass();
  installTileInterpolation(Layer);
  const device = fakeDevice();
  const coarse = new Layer({ tileId: { z: -1 } }, device);
  const background = new Layer({}, device);
  const linear = new Layer({ tileId: { z: 0 }, [interpolationRuleProp]: "linear" }, device);
  for (const layer of [coarse, background, linear]) {
    layer.updateState({});
    assert.equal(layer.state.bitmapTexture?.samplers.length, 0);
  }
  assert.equal(device.created.length, 0);
});

test("a texture is styled once however often the layer updates", () => {
  const Layer = fakeBitmapLayerClass();
  installTileInterpolation(Layer);
  const layer = new Layer({ tileId: { z: 0 } }, fakeDevice());
  layer.updateState({});
  layer.updateState({});
  layer.updateState({});
  assert.equal(layer.state.bitmapTexture?.samplers.length, 1);
  layer.state.bitmapTexture = fakeTexture();
  layer.updateState({});
  assert.equal(layer.state.bitmapTexture.samplers.length, 1);
});

test("installing twice patches the layer once", () => {
  const Layer = fakeBitmapLayerClass();
  installTileInterpolation(Layer);
  installTileInterpolation(Layer);
  const layer = new Layer({ tileId: { z: 0 } }, fakeDevice());
  layer.updateState({});
  assert.equal(layer.updates, 1);
  assert.equal(layer.state.bitmapTexture?.samplers.length, 1);
});
