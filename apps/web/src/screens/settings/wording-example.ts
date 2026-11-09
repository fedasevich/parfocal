import { aiWording, unmeasuredTyper, type WordingSetting } from "@parfocal/ui/lib/confidence-words";

const sampleCalls = [
  { label: "Tumor", probability: 0.72 },
  { label: "Stroma", probability: 0.2 },
];

export function wordingExample(setting: WordingSetting): string {
  const wording = aiWording(sampleCalls, setting, unmeasuredTyper("Example"));
  if (wording.text === null) return "Nothing is said about how sure the AI is.";
  if (wording.mode === null) return `${wording.text}, shown in the ${wording.band} colour.`;
  return wording.text;
}
