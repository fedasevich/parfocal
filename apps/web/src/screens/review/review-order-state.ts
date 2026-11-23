import { ApiError, type ReviewObjects } from "@parfocal/api-client";

export type ReviewOrderState = "ready" | "preparing" | "failed";

type OrderAnswer = Pick<ReviewObjects, "order"> | undefined;

export const preparingPollMs = 3000;

const failedCodes = new Set([
  "review-order-failed",
  "result-files-missing",
  "result-files-unreadable",
]);

export function reviewOrderState(data: OrderAnswer, error: unknown): ReviewOrderState {
  if (error instanceof ApiError && error.status === 409) {
    return failedCodes.has(error.problem?.code ?? "") ? "failed" : "ready";
  }
  return data?.order === "preparing" ? "preparing" : "ready";
}

export function nextReviewOrderState(
  previous: ReviewOrderState,
  data: OrderAnswer,
  error: unknown,
  fetching: boolean,
): ReviewOrderState {
  if (fetching && previous === "failed" && error == null) return previous;
  return reviewOrderState(data, error);
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

export function preparingInterval(data: OrderAnswer, error: unknown): number | false {
  return reviewOrderState(data, error) === "preparing" ? preparingPollMs : false;
}

type ReadyEstimate = { unit: "seconds" | "minutes"; count: number };

export function readyEstimate(seconds: number | null | undefined): ReadyEstimate | null {
  if (seconds == null || seconds <= 0) return null;
  if (seconds < 90) return { unit: "seconds", count: Math.ceil(seconds / 5) * 5 };
  return { unit: "minutes", count: Math.round(seconds / 60) };
}
