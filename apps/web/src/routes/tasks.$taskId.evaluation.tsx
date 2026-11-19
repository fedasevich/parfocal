import { createFileRoute } from "@tanstack/react-router";
import { EvaluationScreen } from "../screens/evaluation/evaluation-screen.tsx";
import { evaluationSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/tasks/$taskId/evaluation")({
  validateSearch: evaluationSearch,
  component: EvaluationReport,
});

function EvaluationReport() {
  const { taskId } = Route.useParams();
  const { scene, view } = Route.useSearch();
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
      previewing={view === "pdf"}
      onPreview={(open) =>
        void navigate({
          search: (previous) => ({ ...previous, view: open ? "pdf" : undefined }),
        })
      }
    />
  );
}
