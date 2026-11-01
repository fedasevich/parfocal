import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const newTaskSearch = z.object({
  scene: z.enum(mockScenes.task).optional(),
});

export const Route = createFileRoute("/projects/$projectId/tasks/new")({
  validateSearch: newTaskSearch,
  component: NewReviewTask,
});

function NewReviewTask() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="New review task"
      builtBy="PROTO-006 (New review task)"
      route={{ params, search }}
    />
  );
}
