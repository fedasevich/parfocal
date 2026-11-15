import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { samFrame, slideToModel } from "@parfocal/viewer-engine";
import {
  createEmbeddingFeatures,
  type EmbeddingServices,
} from "../src/screens/viewer/embedding-features.ts";
import { createSlideLearner, type LearnerCell } from "../src/screens/viewer/slide-learner.ts";

const patchSize = 256;

function square(x: number, y: number, size = 10): Float32Array {
  return Float32Array.from([x, y, x + size, y, x + size, y + size, x, y + size]);
}

function stubbedServices() {
  const calls: { encoded: string[]; pooled: Float32Array[][]; dropped: string[]; reads: number } = {
    encoded: [],
    pooled: [],
    dropped: [],
    reads: 0,
  };
  const services: EmbeddingServices = {
    reader: {
      read: (query) => {
        calls.reads += 1;
        const x = Math.floor(query.x / patchSize) * patchSize;
        const y = Math.floor(query.y / patchSize) * patchSize;
        return Promise.resolve({
          patch: {
            key: `${x}:${y}`,
            level: 0,
            downsample: 1,
            x,
            y,
            width: patchSize,
            height: patchSize,
            absent: false,
            rgb: new Uint8Array(patchSize * patchSize * 3),
          },
        });
      },
    },
    sam: {
      encode: (id) => {
        calls.encoded.push(id);
        return Promise.resolve({ evicted: [] } as never);
      },
      pool: (_id, outlines) => {
        calls.pooled.push([...outlines]);
        return Promise.resolve(outlines.map((outline) => Float32Array.from([outline[0] ?? 0, 1])));
      },
      drop: (id) => {
        calls.dropped.push(id);
      },
    },
  };
  return { services, calls };
}

const cell = (object: string): LearnerCell => ({
  object,
  class_name: "Tumor",
  other_class: "Immune",
  score: 0.5,
});

describe("the embedding feature source for the learner", () => {
  const rings = new Map([
    ["A", square(20, 20)],
    ["B", square(60, 90)],
    ["C", square(300, 40)],
  ]);

  it("encodes each patch once and pools every cell outline inside it", async () => {
    const { services, calls } = stubbedServices();
    const features = createEmbeddingFeatures({
      services,
      preset: "cell" as never,
      ringOf: (object) => rings.get(object),
    });
    const found = await features([cell("A"), cell("B"), cell("C"), cell("D")]);
    assert.equal(calls.encoded.length, 2);
    assert.deepEqual(calls.dropped, calls.encoded);
    assert.deepEqual([...found.keys()].sort(), ["A", "B", "C"]);
    const frame = samFrame({
      key: "0:0",
      level: 0,
      downsample: 1,
      x: 0,
      y: 0,
      width: patchSize,
      height: patchSize,
    } as never);
    const expected = slideToModel(frame, { x: 20, y: 20 });
    assert.equal(calls.pooled[0]?.[0]?.[0], expected.x);
    assert.equal(calls.pooled[0]?.length, 2);
  });

  it("leaves a cell without an outline or a patch out of the features", async () => {
    const { services } = stubbedServices();
    const features = createEmbeddingFeatures({
      services,
      preset: "cell" as never,
      ringOf: (object) => rings.get(object),
    });
    const found = await features([cell("D")]);
    assert.equal(found.size, 0);
  });

  it("stops after the set number of patches", async () => {
    const { services, calls } = stubbedServices();
    const features = createEmbeddingFeatures({
      services,
      preset: "cell" as never,
      ringOf: (object) => rings.get(object),
      maxPatches: 1,
    });
    const found = await features([cell("A"), cell("C")]);
    assert.equal(calls.encoded.length, 1);
    assert.deepEqual([...found.keys()], ["A"]);
  });

  it("gives the learner nothing to learn from when no embedding is available", async () => {
    const calls: string[] = [];
    const client = {
      open: () => {
        calls.push("open");
        return Promise.reject(new Error("unused"));
      },
      teach: () => {
        calls.push("teach");
        return Promise.reject(new Error("unused"));
      },
      forget: () => Promise.reject(new Error("unused")),
      predict: () => Promise.reject(new Error("unused")),
      save: () => Promise.reject(new Error("unused")),
      close: () => undefined,
    };
    const learner = createSlideLearner({
      client,
      pooledFeaturesOf: () => Promise.resolve(new Map()),
    });
    const cells = ["A", "B", "C"].map(cell);
    const labels = new Map(cells.map((item) => [item.object, "Stroma"]));
    await learner.update({ cells, labels, decided: () => true });
    assert.deepEqual(calls, []);
    assert.equal(learner.view().examples, 0);
    assert.equal(learner.view().failed, false);
    assert.equal(learner.view().changes.size, 0);
  });
});
