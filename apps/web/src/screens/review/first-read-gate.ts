import { ApiError, useGetFirstRead } from "@parfocal/api-client";
import type { ReviewSession } from "./review-data.ts";

export type FirstReadGate = "off" | "checking" | "open" | "recorded" | "unknown";

export function useFirstReadGate(session: ReviewSession): FirstReadGate {
  const hidesAi = session.task?.ai_hidden_first_read === true;
  const firstRead = useGetFirstRead(session.taskId, session.slideId, undefined, {
    query: { enabled: hidesAi, retry: false },
  });
  if (!hidesAi) return "off";
  if (firstRead.isPending) return "checking";
  if (!firstRead.isError) return "recorded";
  return firstRead.error instanceof ApiError && firstRead.error.status === 404 ? "open" : "unknown";
}
