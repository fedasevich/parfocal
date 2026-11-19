import { createFileRoute } from "@tanstack/react-router";
import { QueueScreen } from "../screens/disagreements/queue-screen.tsx";

export const Route = createFileRoute("/tasks/$taskId/disagreements")({
  component: Disagreements,
});

function Disagreements() {
  const { taskId } = Route.useParams();
  return <QueueScreen taskId={taskId} />;
}
