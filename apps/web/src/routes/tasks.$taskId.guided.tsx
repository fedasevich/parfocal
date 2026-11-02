import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { GuidedReview } from "../screens/review/guided-review.tsx";
import { mockScenes } from "../screens/scenes.ts";
import { loadViewerEngine } from "../viewer/load-engine.ts";

const guidedSearch = z.object({
  slide: z.string().optional(),
  object: z.string().optional(),
  scene: z.enum(mockScenes.guided).optional(),
  submitted: z.boolean().optional(),
  tab: z.enum(["review", "comments", "display"]).optional(),
});

export const Route = createFileRoute("/tasks/$taskId/guided")({
  validateSearch: guidedSearch,
  loader: loadViewerEngine,
  component: GuidedRoute,
});

function GuidedRoute() {
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <GuidedReview
      taskId={taskId}
      slideId={search.slide ?? ""}
      scene={search.scene}
      submitted={search.submitted ?? false}
      tab={search.tab}
      onTabChange={(tab) =>
        void navigate({ search: (previous) => ({ ...previous, tab }), replace: true })
      }
    />
  );
}
