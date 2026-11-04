import type { ReviewObject, TaskDisplay } from "@parfocal/api-client";
import {
  aiWording,
  type ConfidenceBand,
  type TyperEvidence,
  unmeasuredTyper,
  type WordingSetting,
} from "@parfocal/ui/lib/confidence-words";
import type { Confidence } from "./decision-mapping.ts";

export type ReviewConfidence = Confidence | "frequency";

export const wordingOfDisplay: Record<ReviewConfidence, WordingSetting> = {
  number: "numbers",
  word: "words",
  frequency: "frequency",
  color: "colour",
  hidden: "hidden",
};

export const confidenceOfWording: Record<WordingSetting, ReviewConfidence> = {
  numbers: "number",
  words: "word",
  frequency: "frequency",
  colour: "color",
  hidden: "hidden",
};

const confidenceOfTask = (value: unknown): ReviewConfidence | null => {
  if (value === "colour") return "color";
  return typeof value === "string" && value in wordingOfDisplay
    ? (value as ReviewConfidence)
    : null;
};

type ConfidenceLock = { setting: string; value: string };

export function reviewConfidence(
  display: TaskDisplay | undefined,
  preset: string | null,
  extraLocks: readonly ConfidenceLock[],
  wording: WordingSetting,
): ReviewConfidence {
  const locks = [
    ...(display?.locks ?? []).map((lock) => ({ setting: lock.setting, value: String(lock.value) })),
    ...extraLocks,
  ];
  const locked = confidenceOfTask(locks.find((lock) => lock.setting === "confidence")?.value);
  if (locked !== null) return locked;
  const picked = confidenceOfTask(
    display?.presets.find((item) => item.name === preset)?.settings.confidence,
  );
  return picked ?? confidenceOfWording[wording];
}

export const reviewTyper = unmeasuredTyper("The AI");

const bandSure: Record<ConfidenceBand, string> = {
  confident: "very sure",
  likely: "fairly sure",
  unsure: "not very sure",
  doubtful: "unsure",
};

export function sureText(
  object: ReviewObject,
  confidence: ReviewConfidence,
  typer: TyperEvidence = reviewTyper,
) {
  const calls = [{ label: object.class_name, probability: object.score }];
  const shown = aiWording(calls, wordingOfDisplay[confidence], typer);
  if (shown.mode === "percent") {
    return `, ${object.kind === "cell" ? "only " : ""}${Math.round(object.score * 100)}% sure`;
  }
  if (shown.mode === "frequency" && shown.text !== null) {
    return `, ${shown.text.slice(object.class_name.length + 2)}`;
  }
  return shown.mode === "plain" ? `, ${bandSure[shown.band]}` : "";
}
