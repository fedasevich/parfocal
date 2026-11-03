import type { ReviewObject } from "@parfocal/api-client";
import {
  aiWording,
  type ConfidenceBand,
  type TyperEvidence,
  unmeasuredTyper,
  type WordingSetting,
} from "@parfocal/ui/lib/confidence-words";
import type { Confidence } from "./decision-mapping.ts";

export const wordingOfDisplay: Record<Confidence, WordingSetting> = {
  number: "numbers",
  word: "words",
  color: "colour",
  hidden: "hidden",
};

export const reviewTyper = unmeasuredTyper("The AI");

const bandSure: Record<ConfidenceBand, string> = {
  confident: "very sure",
  likely: "fairly sure",
  unsure: "not very sure",
  doubtful: "unsure",
};

export function sureText(
  object: ReviewObject,
  confidence: Confidence,
  typer: TyperEvidence = reviewTyper,
) {
  const calls = [{ label: object.class_name, probability: object.score }];
  const shown = aiWording(calls, wordingOfDisplay[confidence], typer);
  if (shown.mode === "percent") {
    return `, ${object.kind === "cell" ? "only " : ""}${Math.round(object.score * 100)}% sure`;
  }
  return shown.mode === "plain" ? `, ${bandSure[shown.band]}` : "";
}
