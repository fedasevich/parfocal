import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  deviceInfoOf,
  nucleiWarmupLayers,
  warmupPaysOff,
} from "../../src/overlay/deck/shader-warmup.ts";

before(() => {
  if (typeof globalThis.ImageData === "undefined") {
    Object.assign(globalThis, { ImageData: class {} });
  }
});

describe("nucleiWarmupLayers", () => {
  it("builds the outline, dot and density layers of a nuclei overlay with distinct ids", () => {
    const layers = nucleiWarmupLayers();
    const ids = layers.map((layer) => layer.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const tier of ["outlines", "dots", "density"]) {
      assert.ok(
        ids.some((id) => id.includes(`shader-warmup:${tier}:`)),
        `${tier} in ${ids.join(", ")}`,
      );
    }
    const kinds = new Set(layers.map((layer) => layer.constructor.name));
    assert.ok(kinds.size >= 3, [...kinds].join(", "));
  });
});

describe("warmupPaysOff", () => {
  it("warms on a hardware GPU and when the device is not known yet", () => {
    assert.equal(
      warmupPaysOff({ gpuType: "integrated", renderer: "ANGLE (Apple, M4, Metal)" }),
      true,
    );
    assert.equal(warmupPaysOff({ gpuType: "unknown", renderer: "ANGLE (NVIDIA GeForce)" }), true);
    assert.equal(warmupPaysOff(null), true);
  });

  it("skips a software renderer, where linking the programs stalls frames for seconds", () => {
    assert.equal(warmupPaysOff({ gpuType: "cpu", renderer: "ANGLE (Google, SwiftShader)" }), false);
    assert.equal(warmupPaysOff({ gpuType: "unknown", renderer: "llvmpipe (LLVM 15.0.7)" }), false);
  });

  it("reads the device info from a deck", () => {
    const info = { gpuType: "cpu", renderer: "SwiftShader" };
    assert.deepEqual(deviceInfoOf({ device: { info } }), info);
    assert.equal(deviceInfoOf({ device: null }), null);
  });
});
