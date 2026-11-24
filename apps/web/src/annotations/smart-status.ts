import type { SmartSnapshot } from "../aiseg/smart-session.ts";
import type { EncoderSource } from "../aiseg/view-embeddings.ts";

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
