import assert from "node:assert/strict";
import { test } from "node:test";
import type { TierMapping } from "@parfocal/api-client";
import { toModelTiers } from "@parfocal/api-client/fake";
import { NO_TIER_MODEL, tiersFor } from "../src/screens/viewer-tools/model-tiers.ts";

test("the outline picker shows the lab's exact model for each tier on hover", () => {
  const tiers = tiersFor(toModelTiers(), "outline");
  assert.deepEqual(
    tiers.map((tier) => [tier.name, tier.model, tier.speed]),
    [
      ["Best", "PathoSAM + HoVer-NeXt · v1.2", 1],
      ["Good", "HoVer-Net · v0.9", 2],
      ["Fast", "SlimSAM-77 · ONNX in the browser · v1.0", 3],
    ],
  );
});

test("a tier the lab mapped shows that model and an empty server tier says so", () => {
  const mappings: TierMapping[] = [
    {
      task: "tumor",
      tier: "best",
      model: {
        name: "camelyon-tumor",
        version: "v1.0",
        title: "CAMELYON tumor model",
        description: "Tumor regions and a heatmap",
        label: "CAMELYON tumor model · v1.0",
      },
      set_by_lab: true,
    },
    { task: "tumor", tier: "fast", model: null, set_by_lab: false },
    { task: "outline", tier: "good", model: null, set_by_lab: false },
  ];
  assert.deepEqual(
    tiersFor(mappings, "tumor").map((tier) => [tier.name, tier.model]),
    [
      ["Best", "CAMELYON tumor model · v1.0"],
      ["Fast", NO_TIER_MODEL],
    ],
  );
  assert.deepEqual(
    tiersFor(mappings, "outline").map((tier) => tier.model),
    [NO_TIER_MODEL],
  );
});
