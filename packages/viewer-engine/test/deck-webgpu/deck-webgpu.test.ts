import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertWebGpuAvailable,
  WebGpuUnavailableError,
} from "../../src/deck-webgpu/availability.ts";
import {
  polygonBufferBytes,
  polygonVertexBytes,
  splitByBufferLimit,
  WebGpuBufferLimitError,
} from "../../src/deck-webgpu/buffer-limit.ts";
import { rgbToRgba } from "../../src/deck-webgpu/rgba.ts";
import { availableRendererRoutes } from "../../src/index.ts";
import { pixelRendererRoutes } from "../../src/viv/index.ts";

function polygonLayer(id: string, vertices: number) {
  return {
    id,
    props: {
      data: { attributes: { getPolygon: { value: new Float32Array(vertices * 2), size: 2 } } },
    },
  };
}

describe("rgbToRgba", () => {
  it("adds an opaque alpha byte to every pixel and keeps the row order", () => {
    const rgba = rgbToRgba(new Uint8Array([1, 2, 3, 4, 5, 6]), 2, 1);
    assert.deepEqual([...rgba], [1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it("refuses a tile whose byte count does not match its size", () => {
    assert.throws(() => rgbToRgba(new Uint8Array(5), 2, 1), RangeError);
  });
});

describe("the WebGPU buffer limit", () => {
  it("counts 24 bytes for every polygon vertex", () => {
    assert.equal(polygonBufferBytes(polygonLayer("fills", 12)), 12 * polygonVertexBytes);
  });

  it("counts nothing for a layer without binary polygons", () => {
    assert.equal(polygonBufferBytes({ id: "pins", props: { data: [] } }), 0);
    assert.equal(polygonBufferBytes({ id: "slide", props: {} }), 0);
  });

  it("keeps a layer that fits exactly and rejects one byte more, by name", () => {
    const fits = polygonLayer("fits", 10);
    const tooLarge = polygonLayer("too-large", 11);
    const { drawable, rejected } = splitByBufferLimit([fits, tooLarge], 10 * polygonVertexBytes);
    assert.deepEqual(drawable, [fits]);
    assert.equal(rejected.length, 1);
    const [error] = rejected;
    assert.ok(error instanceof WebGpuBufferLimitError);
    assert.equal(error.layerId, "too-large");
    assert.equal(error.bytes, 11 * polygonVertexBytes);
    assert.equal(error.limit, 10 * polygonVertexBytes);
  });

  it("a million 12-vertex nuclei pass 256 MiB, the default limit doc 23 hit", () => {
    const layer = polygonLayer("nuclei", 0);
    const million = {
      ...layer,
      props: { data: { attributes: { getPolygon: { value: { length: 24_000_000 }, size: 2 } } } },
    };
    assert.equal(splitByBufferLimit([million], 256 * 2 ** 20).rejected.length, 1);
  });
});

describe("WebGPU availability", () => {
  it("fails by name when the browser has no navigator.gpu", async () => {
    await assert.rejects(assertWebGpuAvailable(undefined), WebGpuUnavailableError);
  });

  it("fails by name when no adapter is offered", async () => {
    await assert.rejects(
      assertWebGpuAvailable({ requestAdapter: () => Promise.resolve(null) }),
      /offers no WebGPU adapter/,
    );
  });

  it("fails by name when the adapter request throws", async () => {
    await assert.rejects(
      assertWebGpuAvailable({
        requestAdapter: () => Promise.reject(new Error("blocklisted")),
      }),
      /blocklisted/,
    );
  });

  it("passes when an adapter is offered", async () => {
    await assertWebGpuAvailable({ requestAdapter: () => Promise.resolve({}) });
  });
});

describe("the pixel route registry", () => {
  it("registers Viv first and the deck.gl WebGPU route behind a loader", () => {
    assert.deepEqual(availableRendererRoutes(pixelRendererRoutes()), ["viv", "deck-webgpu"]);
  });

  it("refuses to load the deck.gl WebGPU route where WebGPU is missing", async () => {
    const load = pixelRendererRoutes()["deck-webgpu"];
    assert.ok(load);
    await assert.rejects(Promise.resolve().then(load), WebGpuUnavailableError);
  });
});
