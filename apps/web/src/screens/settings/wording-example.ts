import {
  aiWording,
  type TyperEvidence,
  type WordingSetting,
} from "@parfocal/ui/lib/confidence-words";

const sampleCalls = [
  { label: "Tumor", probability: 0.72 },
  { label: "Stroma", probability: 0.2 },
];

export const sampleTyper: TyperEvidence = {
  name: "Example",
  calibrated: true,
  checkedOnHeldOut: true,
  bandAccuracy: { confident: 0.9, likely: 0.8, unsure: 0.6, doubtful: 0.4 },
};

export function wordingExample(setting: WordingSetting): string {
  const wording = aiWording(sampleCalls, setting, sampleTyper);
  if (wording.text === null) return "Nothing is said about how sure the AI is.";
  if (wording.mode === null) return `${wording.text}, shown in the ${wording.band} colour.`;
  return wording.text;
}
