import type { UploadState } from "@parfocal/api-client";

type CountedState = Pick<UploadState, "status">;

export type IngestCounts = { failed: number; skipped: number };

export function ingestCounts(states: readonly CountedState[]): IngestCounts {
  return {
    failed: states.filter((state) => state.status === "failed").length,
    skipped: states.filter((state) => state.status === "skipped").length,
  };
}
