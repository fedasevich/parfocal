import type { SlideStorageNote } from "./tile-grant.ts";

export type CopyOutcome = "queued" | "already-copied" | "not-ready" | "failed";

export type CopyAction = "hidden" | "offline" | "ready";

export function copyAction(note: SlideStorageNote | null, canUpload: boolean): CopyAction {
  if (note?.storage !== "remote" || !canUpload) return "hidden";
  return note.offline ? "offline" : "ready";
}

export function copyOutcome(answer: { status: number; data: unknown }): CopyOutcome {
  if (answer.status === 202) return "queued";
  const code =
    typeof answer.data === "object" && answer.data !== null && "code" in answer.data
      ? answer.data.code
      : undefined;
  if (code === "slide-not-remote") return "already-copied";
  if (code === "remote-slide-not-ready") return "not-ready";
  return "failed";
}
