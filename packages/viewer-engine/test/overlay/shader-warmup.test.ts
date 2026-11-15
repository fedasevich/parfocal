import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { nucleiWarmupLayers } from "../../src/overlay/deck/shader-warmup.ts";

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
