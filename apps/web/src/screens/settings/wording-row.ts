import { resolveSetting, type SettingLayers } from "@parfocal/api-client";
import type { WordingSetting } from "@parfocal/ui/lib/confidence-words";

export const wordingLabels: Readonly<Record<WordingSetting, string>> = {
  words: "Words",
  numbers: "Numbers",
  frequency: "Frequency",
  colour: "Colour",
  hidden: "Hidden",
};

export const wordingPairs: [WordingSetting, string][] = (
  Object.keys(wordingLabels) as WordingSetting[]
).map((option) => [option, wordingLabels[option]]);

export const wordingNow = (layers: SettingLayers): WordingSetting =>
  resolveSetting("confidence_wording", layers).value;
