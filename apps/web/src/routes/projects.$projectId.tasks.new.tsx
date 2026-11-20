import { createFileRoute } from "@tanstack/react-router";
import { NewTaskScreen } from "../screens/new-task/new-task-screen.tsx";
import { newTaskSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/projects/$projectId/tasks/new")({
  validateSearch: newTaskSearch,
  component: NewReviewTask,
});

function NewReviewTask() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <NewTaskScreen
      projectId={params.projectId}
      scene={search.scene ?? "slides"}
      step={search.step}
      modal={search.modal}
      keep={search.scene === undefined}
      sentTask={search.task}
      onNavigate={(to) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            step: to.step,
            modal: to.modal,
            ...("task" in to ? { task: to.task } : {}),
          }),
          replace: to.step === search.step,
        })
      }
    />
  );
}
