import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const coSignSearch = z.object({
  scene: z.enum(mockScenes.cosign).optional(),
});

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/co-sign")({
  validateSearch: coSignSearch,
  component: CoSignReview,
});

function CoSignReview() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Co-sign review"
      builtBy="PROTO-014 (clinical report, sign-out and co-sign)"
      route={{ params, search }}
    />
  );
}
