import type { SmartSnapshot } from "../aiseg/smart-session.ts";
import type { BestFallback, EncoderSource } from "../aiseg/view-embeddings.ts";

export type SmartStatus = "outlining" | "found" | "message" | null;

export type SmartStep = "asking-best" | "loading-model" | "outlining";

export function smartStepOf(encoderSource: EncoderSource | null): SmartStep {
  if (encoderSource === "asking") return "asking-best";
  if (encoderSource === "preparing") return "loading-model";
  return "outlining";
}

export function smartStatusOf(snapshot: SmartSnapshot): SmartStatus {
  if (snapshot.phase === "thinking") return "outlining";
  if (snapshot.message !== null) return "message";
  if (snapshot.phase === "ready" && snapshot.live?.ring != null) return "found";
  return null;
}

const messageWords: ReadonlyMap<string, string> = new Map([
  ["The model is not running yet", "Not running"],
  ["The model could not load its files", "Not loaded"],
  ["This area has no pixels yet", "No pixels"],
  ["This area is too small for smart select", "Too small"],
  ["Smart select could not outline that", "No outline"],
  ["Smart select could not start", "Not started"],
  ["No outline found", "No outline"],
  ["Outside the area being refined", "Outside"],
]);

export function stateWordOf(message: string): string {
  return messageWords.get(message) ?? "Not done";
}

export const fallbackWords: Record<BestFallback, string> = {
  unsendable: "Good used",
  refused: "Good used",
  offline: "Good used",
  "gave-up": "Good used",
  cancelled: "Good used",
};
