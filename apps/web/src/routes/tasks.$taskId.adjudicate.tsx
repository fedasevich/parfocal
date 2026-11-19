import { createFileRoute } from "@tanstack/react-router";
import { AdjudicatorView } from "../screens/disagreements/adjudicator-view.tsx";

export const Route = createFileRoute("/tasks/$taskId/adjudicate")({
  component: Adjudicate,
});

function Adjudicate() {
  const { taskId } = Route.useParams();
  return <AdjudicatorView taskId={taskId} />;
}
