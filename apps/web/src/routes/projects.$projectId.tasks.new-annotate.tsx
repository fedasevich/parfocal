import { createFileRoute } from "@tanstack/react-router";
import { NewAnnotateTask } from "../screens/annotate-task/new-annotate-task.tsx";
import { newAnnotateSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/projects/$projectId/tasks/new-annotate")({
  validateSearch: newAnnotateSearch,
  component: NewAnnotateTaskRoute,
});

function NewAnnotateTaskRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <NewAnnotateTask
      key={search.preset ?? "run"}
      projectId={projectId}
      step={search.step ?? "kind"}
      preset={search.preset ?? "run"}
      slides={search.slides}
      onStep={(step) =>
        void navigate({ search: (previous) => ({ ...previous, step }), replace: true })
      }
    />
  );
}
