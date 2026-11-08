import { useMatches } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { feedbackRoute, useFeedback } from "./feedback-state.ts";

const FeedbackDialog = lazy(() => import("./feedback-dialog.tsx"));

export function FeedbackHost() {
  const feedback = useFeedback();
  const route = useMatches({ select: feedbackRoute });
  if (feedback.step !== "writing") return null;
  return (
    <Suspense fallback={null}>
      <FeedbackDialog feedback={feedback} route={route} />
    </Suspense>
  );
}
