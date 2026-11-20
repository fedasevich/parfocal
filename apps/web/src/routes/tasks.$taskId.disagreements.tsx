import { createFileRoute } from "@tanstack/react-router";
import { QueueScreen } from "../screens/disagreements/queue-screen.tsx";
import { ReviewTaskOnly } from "../shell/review-task-only.tsx";

export const Route = createFileRoute("/tasks/$taskId/disagreements")({
  component: Disagreements,
});

function Disagreements() {
  const { taskId } = Route.useParams();
  return (
    <ReviewTaskOnly taskId={taskId} what="disagreements">
      <QueueScreen taskId={taskId} />
    </ReviewTaskOnly>
  );
}
