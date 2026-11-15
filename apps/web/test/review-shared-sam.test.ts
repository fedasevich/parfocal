import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFakeReader, createFakeSam } from "../src/aiseg/fake-sam.ts";
import { planPresetPatch } from "../src/aiseg/scale-presets.ts";
import {
  type SmartServices,
  type SmartServicesContext,
  shareServices,
} from "../src/aiseg/smart-services.ts";
import { ringOfShape } from "../src/screens/review/cell-ring.ts";
import { createLazyEmbeddingFeatures } from "../src/screens/viewer/lazy-embedding-features.ts";
import { loadLearnerServices } from "../src/screens/viewer/load-learner-services.ts";
import {
  createSlideLearner,
  type LearnerCell,
  labelsOnceCorrected,
} from "../src/screens/viewer/slide-learner.ts";

const slide = { width: 20_000, height: 20_000 };
const plan = planPresetPatch([{ downsample: 1 }], null, "nuclei");

const cell = (object: string): LearnerCell => ({
  object,
  class_name: "Tumor",
  other_class: "Immune",
  score: 0.5,
});

describe("the review viewer's one SAM worker", () => {
  it("counts one worker and one model load across smart select and a type correction", async () => {
    const log = { workers: 0, modelLoads: 0, closes: 0 };
    const shared = shareServices(() => {
      log.workers += 1;
      const sam = createFakeSam();
      const encode = sam.encode.bind(sam);
      let loaded = false;
      sam.encode = (...args) => {
        if (!loaded) {
          loaded = true;
          log.modelLoads += 1;
        }
        return encode(...args);
      };
      const services: SmartServices = {
        reader: createFakeReader(slide),
        sam,
        plan: () => Promise.resolve(plan),
        close: () => {
          log.closes += 1;
        },
      };
      return Promise.resolve(services);
    });
    const context: SmartServicesContext = {
      slide,
      open: () => Promise.reject(new Error("unused")),
    };

    const smartSelect = await shared(context);
    await smartSelect.sam.encode("select", new Float32Array(0));

    const lazy = createLazyEmbeddingFeatures({
      preset: "nuclei",
      ringOf: () => Float32Array.from([10, 10, 20, 10, 20, 20, 10, 20]),
      load: () => loadLearnerServices(shared, context.open),
    });
    const learner = createSlideLearner({
      client: {
        open: () => Promise.resolve(undefined as never),
        teach: () => Promise.resolve(undefined as never),
        forget: () => Promise.resolve(undefined as never),
        predict: (features: readonly Float32Array[]) => Promise.resolve(features.map(() => null)),
        save: () => Promise.resolve(undefined as never),
        close: () => undefined,
      },
      pooledFeaturesOf: lazy.features,
    });
    const cells = ["A1", "B22"].map(cell);
    const agreeing = new Map(cells.map((item) => [item.object, "Tumor"]));
    await learner.update({
      cells,
      labels: labelsOnceCorrected(new Map([...agreeing, ["A1", "Stroma"]]), cells),
      decided: () => true,
    });

    assert.equal(log.workers, 1);
    assert.equal(log.modelLoads, 1);
    assert.equal(log.closes, 0);
    lazy.close();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(log.closes, 0);
    smartSelect.close();
    assert.equal(log.closes, 1);
    assert.ok(ringOfShape({ x: 0, y: 0, path: "M1,2L3,4L5,6L1,2Z" }) !== undefined);
  });
});
