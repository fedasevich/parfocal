import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const disagreementsSearch = z.object({
  scene: z.enum(mockScenes.disagree).optional(),
});

export const Route = createFileRoute("/tasks/$taskId/disagreements")({
  validateSearch: disagreementsSearch,
  component: Disagreements,
});

function Disagreements() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Disagreements"
      builtBy="PROTO-008 (disagreements, sign-off and the evaluation report)"
      route={{ params, search }}
    />
  );
}
