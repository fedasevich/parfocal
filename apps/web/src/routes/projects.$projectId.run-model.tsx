import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const runModelSearch = z.object({
  scene: z.enum(mockScenes.runmodel).optional(),
});

export const Route = createFileRoute("/projects/$projectId/run-model")({
  validateSearch: runModelSearch,
  component: RunAModel,
});

function RunAModel() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Run a model"
      builtBy="PROTO-005 (model runs and jobs)"
      route={{ params, search }}
    />
  );
}
