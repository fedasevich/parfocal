import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { EvaluationScreen } from "../screens/evaluation/evaluation-screen.tsx";
import { mockScenes } from "../screens/scenes.ts";

const evaluationSearch = z.object({
  scene: z.enum(mockScenes.evaluation).optional(),
});

export const Route = createFileRoute("/tasks/$taskId/evaluation")({
  validateSearch: evaluationSearch,
  component: EvaluationReport,
});

function EvaluationReport() {
  const { taskId } = Route.useParams();
  const { scene } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <EvaluationScreen
      taskId={taskId}
      scene={scene ?? "report"}
      onScene={(next) =>
        void navigate({
          search: (previous) => ({ ...previous, scene: next === "report" ? undefined : next }),
        })
      }
    />
  );
}
