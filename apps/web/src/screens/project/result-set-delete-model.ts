import { ApiError } from "@parfocal/api-client";

export type DeleteFailure = { needsConfirm: boolean; text: string };

export const deleteFailure = (error: unknown): DeleteFailure => {
  if (error instanceof ApiError && error.kind !== "network") {
    const needsConfirm = error.problem?.code === "result-set-in-review";
    return {
      needsConfirm,
      text: needsConfirm ? (error.problem?.detail ?? error.message) : error.message,
    };
  }
  return { needsConfirm: false, text: "Could not reach the server. Try again." };
};
