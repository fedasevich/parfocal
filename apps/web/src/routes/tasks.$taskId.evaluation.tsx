import { createFileRoute } from "@tanstack/react-router";
import { Placeholder } from "../screens/placeholder.tsx";

export const Route = createFileRoute("/tasks/$taskId/evaluation")({
  component: EvaluationReport,
});

function EvaluationReport() {
  const params = Route.useParams();
  return (
    <Placeholder
      title="Evaluation report"
      builtBy="PROTO-008 (disagreements, sign-off and the evaluation report)"
      route={{ params }}
    />
  );
}
