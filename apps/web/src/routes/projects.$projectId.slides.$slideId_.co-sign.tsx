import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CosignScreen } from "../screens/clinical-report/cosign-screen.tsx";
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
    <CosignScreen
      projectId={params.projectId}
      slideId={params.slideId}
      scene={search.scene ?? "review"}
    />
  );
}
