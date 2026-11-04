import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { NewAnnotateTask } from "../screens/annotate-task/new-annotate-task.tsx";
import { annotateStepKeys, presetKeys } from "../screens/annotate-task/step-keys.ts";

const newAnnotateSearch = z.object({
  step: z.enum(annotateStepKeys).optional(),
  preset: z.enum(presetKeys).optional(),
});

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
      onStep={(step) =>
        void navigate({ search: (previous) => ({ ...previous, step }), replace: true })
      }
    />
  );
}
