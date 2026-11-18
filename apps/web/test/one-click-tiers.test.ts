import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EngineNotReadyError, SamStartError } from "@parfocal/viewer-engine";
import { createFakeReader, createFakeSam } from "../src/aiseg/fake-sam.ts";
import {
  browserDownloadBytes,
  megabytes,
  oneClickTiers,
  shownTier,
  tierOfName,
  usesServerEmbeddings,
} from "../src/aiseg/one-click-tiers.ts";
import {
  canStartModel,
  modelNotLoadedText,
  modelNotStartedText,
  plainFailure,
} from "../src/aiseg/plain-message.ts";
import { planPresetPatch } from "../src/aiseg/scale-presets.ts";
import {
  type SmartServices,
  type SmartServicesContext,
  shareServices,
} from "../src/aiseg/smart-services.ts";

const slide = { width: 1000, height: 1000 };

describe("one-click model tiers", () => {
  it("offers Best on the server and Good on this computer with their size", () => {
    const tiers = oneClickTiers(true);
    assert.deepEqual(
      tiers.map((tier) => tier.name),
      ["Best", "Good"],
    );
    assert.match(tiers[0]?.model ?? "", /PathoSAM ViT-B · on the Parfocal server/);
    assert.doesNotMatch(tiers.map((tier) => tier.description).join(" "), /hospital/);
    assert.match(
      tiers[1]?.model ?? "",
      /on this computer, on the graphics card · 106 MB, downloaded once/,
    );
    assert.match(oneClickTiers(false)[1]?.model ?? "", /on the processor · 134 MB/);
  });

  it("counts the encoder, decoder and window decoder a browser downloads", () => {
    assert.equal(megabytes(browserDownloadBytes(true)), "106 MB");
    assert.equal(megabytes(browserDownloadBytes(false)), "134 MB");
  });

  it("maps names back to tiers and keeps Fast off the server", () => {
    assert.equal(tierOfName("Good"), "good");
    assert.equal(tierOfName("Turbo"), null);
    assert.equal(usesServerEmbeddings("best"), true);
    assert.equal(usesServerEmbeddings("good"), false);
    assert.equal(usesServerEmbeddings("fast"), false);
    assert.equal(shownTier("fast"), "good");
  });
});

describe("model start messages", () => {
  it("names a failed start plainly and offers to start again", () => {
    assert.equal(plainFailure(new SamStartError("Model download failed"), "x"), modelNotLoadedText);
    assert.equal(plainFailure(new EngineNotReadyError(), "x"), modelNotStartedText);
    assert.equal(plainFailure(new Error("other"), "x"), "x");
    assert.equal(canStartModel(modelNotLoadedText), true);
    assert.equal(canStartModel("x"), false);
  });
});

describe("shared services per tier", () => {
  it("loads the browser-only model apart from the server-first one", async () => {
    const tiers: (string | undefined)[] = [];
    const loader = shareServices((context) => {
      tiers.push(context.tier);
      const services: SmartServices = {
        reader: createFakeReader(slide),
        sam: createFakeSam(),
        plan: () => Promise.resolve(planPresetPatch([{ downsample: 1 }], null, "nuclei")),
        close: () => undefined,
      };
      return Promise.resolve(services);
    });
    const context = (tier: SmartServicesContext["tier"]): SmartServicesContext => ({
      slide,
      ...(tier === undefined ? {} : { tier }),
      open: () => Promise.reject(new Error("unused")),
    });
    await loader(context("best"));
    await loader(context(undefined));
    await loader(context("good"));
    await loader(context("fast"));
    assert.deepEqual(tiers, ["best", "good"]);
  });
});
