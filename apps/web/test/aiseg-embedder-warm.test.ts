import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getWarmSlideEmbedderUrl } from "@parfocal/api-client";
import { deviceSpeed, type GpuProbe, warmEmbedderIfSlow } from "../src/aiseg/embedder-warm.ts";
import { createFakeReader, createFakeSam } from "../src/aiseg/fake-sam.ts";
import { planPresetPatch } from "../src/aiseg/scale-presets.ts";
import {
  type SmartServices,
  type SmartServicesContext,
  withEmbedderWarm,
} from "../src/aiseg/smart-services.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const withAdapter: GpuProbe = { requestAdapter: () => Promise.resolve({}) };
const withoutAdapter: GpuProbe = { requestAdapter: () => Promise.resolve(null) };
const failingAdapter: GpuProbe = { requestAdapter: () => Promise.reject(new Error("lost")) };

function context(slideId?: string): SmartServicesContext {
  return {
    slide: { width: 4096, height: 4096 },
    ...(slideId === undefined ? {} : { slideId }),
    open: () => Promise.reject(new Error("not opened in this test")),
  };
}

function fakeServices(slide: SmartServicesContext["slide"]): SmartServices {
  return {
    reader: createFakeReader(slide),
    sam: createFakeSam(),
    plan: (preset) => Promise.resolve(planPresetPatch([{ downsample: 1 }], null, preset)),
    close: () => undefined,
  };
}

function recorder() {
  const calls: { slideId: string; device: string }[] = [];
  const warm = (slideId: string, device: string) => {
    calls.push({ slideId, device });
    return Promise.resolve();
  };
  return { calls, warm };
}

describe("the embedder warm on tool open", () => {
  it("calls the route only when the device has no GPU adapter", async () => {
    for (const [gpu, expected] of [
      [withoutAdapter, 1],
      [undefined, 1],
      [failingAdapter, 1],
      [withAdapter, 0],
    ] as const) {
      const { calls, warm } = recorder();
      let opened = 0;
      const loader = withEmbedderWarm(
        (open) => {
          opened += 1;
          return Promise.resolve(fakeServices(open.slide));
        },
        { gpu, warm },
      );
      await loader(context("slide-1"));
      await settle();
      assert.equal(opened, 1);
      assert.equal(calls.length, expected);
      if (expected === 1) assert.deepEqual(calls[0], { slideId: "slide-1", device: "slow" });
    }
  });

  it("sends nothing when the tool opens without a slide", async () => {
    const { calls, warm } = recorder();
    await withEmbedderWarm((open) => Promise.resolve(fakeServices(open.slide)), {
      gpu: withoutAdapter,
      warm,
    })(context());
    await settle();
    assert.equal(calls.length, 0);
  });

  it("never fails the tool open when the warm call fails", async () => {
    const warmed = await warmEmbedderIfSlow("slide-2", {
      gpu: withoutAdapter,
      warm: () => Promise.reject(new Error("offline")),
    });
    assert.equal(warmed, true);
  });

  it("names a device by its GPU adapter and posts to the warm route", async () => {
    assert.equal(await deviceSpeed(withAdapter), "fast");
    assert.equal(await deviceSpeed(withoutAdapter), "slow");
    assert.equal(getWarmSlideEmbedderUrl("s"), "/api/slides/s/embeddings/warm");
  });
});
