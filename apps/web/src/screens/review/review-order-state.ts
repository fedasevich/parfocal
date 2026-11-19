import { ApiError } from "@parfocal/api-client";

export type ReviewOrderState = "ready" | "preparing" | "failed";

export const preparingPollMs = 3000;

const failedCodes = new Set([
  "review-order-failed",
  "result-files-missing",
  "result-files-unreadable",
]);

export function reviewOrderState(error: unknown): ReviewOrderState {
  if (!(error instanceof ApiError) || error.status !== 409) return "ready";
  const code = error.problem?.code ?? "";
  if (code === "review-order-not-ready") return "preparing";
  return failedCodes.has(code) ? "failed" : "ready";
}

export function nextReviewOrderState(
  previous: ReviewOrderState,
  error: unknown,
  fetching: boolean,
): ReviewOrderState {
  if (fetching && previous !== "ready" && error == null) return previous;
  return reviewOrderState(error);
}

export function waitedMinutes(madeAt: string | undefined, now: number): number {
  const made = madeAt ? Date.parse(madeAt) : Number.NaN;
  if (Number.isNaN(made)) return 0;
  return Math.max(0, Math.floor((now - made) / 60_000));
}

export function pendingOrder(
  order: ReviewOrderState,
  ready: boolean,
): Exclude<ReviewOrderState, "ready"> | null {
  return order === "ready" || ready ? null : order;
}

export function preparingInterval(error: unknown): number | false {
  return reviewOrderState(error) === "preparing" ? preparingPollMs : false;
}
