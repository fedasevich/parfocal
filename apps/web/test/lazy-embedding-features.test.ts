import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ringOfShape } from "../src/screens/review/cell-ring.ts";
import type { EmbeddingServices } from "../src/screens/viewer/embedding-features.ts";
import { createLazyEmbeddingFeatures } from "../src/screens/viewer/lazy-embedding-features.ts";
import {
  createSlideLearner,
  type LearnerCell,
  labelsOnceCorrected,
} from "../src/screens/viewer/slide-learner.ts";

const cell = (object: string): LearnerCell => ({
  object,
  class_name: "Tumor",
  other_class: "Immune",
  score: 0.5,
});

function stubbed() {
  const log = { loads: 0, closes: 0, encodes: 0, reads: 0, teaches: 0 };
  const services: EmbeddingServices = {
    reader: {
      read: () => {
        log.reads += 1;
        return Promise.resolve({
          patch: {
            key: "0:0",
            level: 0,
            downsample: 1,
            x: 0,
            y: 0,
            width: 256,
            height: 256,
            absent: false,
            rgb: new Uint8Array(256 * 256 * 3),
          },
        });
      },
    },
    sam: {
      encode: () => {
        log.encodes += 1;
        return Promise.resolve({ evicted: [] } as never);
      },
      pool: (_id, outlines) => Promise.resolve(outlines.map(() => Float32Array.of(3, 0))),
      drop: () => undefined,
    },
  };
  const lazy = createLazyEmbeddingFeatures({
    preset: "nuclei",
    ringOf: (object) =>
      Float32Array.from([10, 10, 20, 10, 20, 20, 10, 20].map((value) => value + object.length)),
    load: () => {
      log.loads += 1;
      return Promise.resolve({
        services,
        close: () => {
          log.closes += 1;
        },
      });
    },
  });
  const client = {
    open: () => Promise.resolve(undefined as never),
    teach: () => {
      log.teaches += 1;
      return Promise.resolve(undefined as never);
    },
    forget: () => Promise.resolve(undefined as never),
    predict: (features: readonly Float32Array[]) => Promise.resolve(features.map(() => null)),
    save: () => Promise.resolve(undefined as never),
    close: () => undefined,
  };
  return { log, lazy, client };
}

describe("the lazy embedding features for the review viewer", () => {
  it("starts no SAM work before the first correction", async () => {
    const { log, lazy, client } = stubbed();
    const learner = createSlideLearner({
      client,
      pooledFeaturesOf: lazy.features,
    });
    const cells = ["A1", "B22", "C333"].map(cell);
    const agreeing = new Map(cells.map((item) => [item.object, "Tumor"]));
    await learner.update({
      cells,
      labels: labelsOnceCorrected(agreeing, cells),
      decided: () => true,
    });
    assert.deepEqual(log, { loads: 0, closes: 0, encodes: 0, reads: 0, teaches: 0 });
    const corrected = new Map([...agreeing, ["A1", "Stroma"]]);
    await learner.update({
      cells,
      labels: labelsOnceCorrected(corrected, cells),
      decided: () => true,
    });
    assert.equal(log.loads, 1);
    assert.ok(log.encodes >= 1);
    assert.ok(log.teaches >= 1);
  });

  it("loads the services once however many times features are asked for", async () => {
    const { log, lazy } = stubbed();
    await Promise.all([lazy.features([cell("A1")]), lazy.features([cell("B22")])]);
    await lazy.features([cell("C333")]);
    assert.equal(log.loads, 1);
  });

  it("releases the services on close and gives nothing afterwards", async () => {
    const { log, lazy } = stubbed();
    await lazy.features([cell("A1")]);
    lazy.close();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(log.closes, 1);
    assert.equal((await lazy.features([cell("A1")])).size, 0);
    assert.equal(log.loads, 1);
  });

  it("closing before anything loaded costs nothing", () => {
    const { log, lazy } = stubbed();
    lazy.close();
    assert.equal(log.loads, 0);
  });
});

describe("the outline of a review cell", () => {
  it("reads a polygon path as a ring", () => {
    const ring = ringOfShape({ x: 0, y: 0, path: "M1,2L3,4L5,6L1,2Z" });
    assert.deepEqual([...(ring ?? [])], [1, 2, 3, 4, 5, 6, 1, 2]);
  });

  it("turns a circle path into a ring around its centre", () => {
    const ring = ringOfShape({
      x: 50,
      y: 40,
      path: "M45.0,40.0A5.0,5.0 0 1,0 55.0,40.0A5.0,5.0 0 1,0 45.0,40.0Z",
    });
    assert.ok(ring !== undefined && ring.length >= 6);
    let x = 0;
    let y = 0;
    for (let at = 0; at < (ring?.length ?? 0); at += 2) {
      x += (ring?.[at] ?? 0) / ((ring?.length ?? 2) / 2);
      y += (ring?.[at + 1] ?? 0) / ((ring?.length ?? 2) / 2);
    }
    assert.ok(Math.abs(x - 50) < 0.01 && Math.abs(y - 40) < 0.01);
  });

  it("has no ring for an unknown cell", () => {
    assert.equal(ringOfShape(undefined), undefined);
  });
});
