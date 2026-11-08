import { lazy, Suspense } from "react";
import { useFeedback } from "./feedback-state.ts";

const FeedbackDialog = lazy(() => import("./feedback-dialog.tsx"));

export function FeedbackHost() {
  const feedback = useFeedback();
  if (feedback.step !== "writing") return null;
  return (
    <Suspense fallback={null}>
      <FeedbackDialog feedback={feedback} />
    </Suspense>
  );
}
