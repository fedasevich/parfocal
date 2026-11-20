import { createFileRoute } from "@tanstack/react-router";
import { DatasetScreen } from "../screens/dataset/dataset-screen.tsx";

export const Route = createFileRoute("/tasks/$taskId/dataset")({
  component: Dataset,
});

function Dataset() {
  const { taskId } = Route.useParams();
  return <DatasetScreen taskId={taskId} />;
}
