import type { SmartSnapshot } from "../aiseg/smart-session.ts";

export type SmartStatus = "outlining" | "found" | "message" | null;

export function smartStatusOf(snapshot: SmartSnapshot): SmartStatus {
  if (snapshot.phase === "thinking") return "outlining";
  if (snapshot.message !== null) return "message";
  if (snapshot.phase === "ready" && snapshot.live?.ring != null) return "found";
  return null;
}
