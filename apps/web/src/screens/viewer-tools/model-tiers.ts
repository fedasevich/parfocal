import type { ModelTier, TierMapping, TierTask } from "@parfocal/api-client";
import type { Tier } from "@parfocal/ui/components/viewer-tools";

export const NO_TIER_MODEL = "Your lab has not chosen a model for this tier";

const tierWords: Record<ModelTier, string> = { best: "Best", good: "Good", fast: "Fast" };

const tierSpeeds: Record<ModelTier, Tier["speed"]> = { best: 1, good: 2, fast: 3 };

const tierColours: Record<ModelTier, string> = {
  best: "var(--ok)",
  good: "var(--accent)",
  fast: "var(--warn)",
};

const tierDescriptions: Record<TierTask, Record<ModelTier, string>> = {
  tumor: {
    best: "The tumor model your lab validated.",
    good: "A quicker tumor model.",
    fast: "A quick draft on this computer.",
  },
  outline: {
    best: "The most accurate outlines. Slowest, runs on the hospital server.",
    good: "Nearly as accurate, about three times quicker.",
    fast: "A quick draft that runs on this computer, also offline.",
  },
  typer: {
    best: "Types every nucleus on the hospital server.",
    good: "A lighter classifier trained on your lab's corrections.",
    fast: "Learns from your own examples on this computer.",
  },
};

const browserModels: Partial<Record<TierTask, string>> = {
  outline: "SlimSAM-77 · ONNX in the browser · v1.0",
  typer: "Learned in your browser · 212 examples",
};

const modelText = (mapping: TierMapping) =>
  mapping.model?.label ??
  (mapping.tier === "fast" ? browserModels[mapping.task] : undefined) ??
  NO_TIER_MODEL;

export const tiersFor = (mappings: TierMapping[], task: TierTask): Tier[] =>
  mappings
    .filter((mapping) => mapping.task === task)
    .map((mapping) => ({
      name: tierWords[mapping.tier],
      description: tierDescriptions[task][mapping.tier],
      model: modelText(mapping),
      speed: tierSpeeds[mapping.tier],
      colour: tierColours[mapping.tier],
    }));
