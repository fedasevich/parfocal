import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { NewTaskScreen } from "../screens/new-task/new-task-screen.tsx";
import { mockScenes } from "../screens/scenes.ts";

const newTaskSearch = z.object({
  scene: z.enum(mockScenes.task).optional(),
  step: z.enum(["slides", "reviewers", "check", "how", "send", "sent"]).optional(),
  modal: z.enum(["addslides", "dpreview"]).optional(),
});

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
      onNavigate={(to) =>
        void navigate({
          search: (previous) => ({ ...previous, step: to.step, modal: to.modal }),
          replace: to.step === search.step,
        })
      }
    />
  );
}
