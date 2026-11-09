import { useMatches } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { closeFeedback, feedbackRoute, useFeedbackOpen } from "./feedback-state.ts";

const FeedbackFlow = lazy(() => import("./feedback-flow.tsx"));

export function FeedbackHost() {
  const route = useMatches({ select: feedbackRoute });
  return useFeedbackOpen() ? (
    <Suspense fallback={null}>
      <FeedbackFlow route={route} onClose={closeFeedback} />
    </Suspense>
  ) : null;
}
