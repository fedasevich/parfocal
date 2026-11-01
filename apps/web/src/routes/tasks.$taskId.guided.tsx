import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const guidedSearch = z.object({
  slide: z.string().optional(),
  object: z.string().optional(),
  scene: z.enum(mockScenes.guided).optional(),
  submitted: z.boolean().optional(),
});

export const Route = createFileRoute("/tasks/$taskId/guided")({
  validateSearch: guidedSearch,
  component: GuidedReview,
});

function GuidedReview() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Guided review"
      builtBy="PROTO-007 (guided review and the Slide done card)"
      route={{ params, search }}
    />
  );
}
