import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const evaluationSearch = z.object({
  scene: z.enum(mockScenes.evaluation).optional(),
});

export const Route = createFileRoute("/tasks/$taskId/evaluation")({
  validateSearch: evaluationSearch,
  component: EvaluationReport,
});

function EvaluationReport() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Evaluation report"
      builtBy="PROTO-008 (disagreements, sign-off and the evaluation report)"
      route={{ params, search }}
    />
  );
}
