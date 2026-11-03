import type { UploadState } from "@parfocal/api-client";

export const supportEmail = "support@parfocal.eu";

export type IngestFailureView = {
  fileName: string;
  message: string;
  failureClass: "transient" | "permanent";
  supportHref: string | undefined;
};

export function supportHref(reason: string): string {
  const subject = encodeURIComponent(`Refused upload ${reason}`);
  return `mailto:${supportEmail}?subject=${subject}`;
}

type FailureSource = Pick<UploadState, "status" | "reason" | "message" | "failure_class">;

export function ingestFailureView(
  state: FailureSource,
  fileName: string,
): IngestFailureView | null {
  if (state.status !== "failed" || state.reason === null) return null;
  const failureClass = state.failure_class ?? "permanent";
  return {
    fileName,
    message: state.message ?? "Parfocal could not take this file in.",
    failureClass,
    supportHref: failureClass === "permanent" ? supportHref(state.reason) : undefined,
  };
}
