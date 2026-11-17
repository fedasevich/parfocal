import { createFileRoute } from "@tanstack/react-router";
import { GuidedReview } from "../screens/review/guided-review.tsx";
import { guidedSearch } from "../search/route-searches.ts";
import { loadViewerEngine } from "../viewer/load-engine.ts";

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
      objectId={search.object}
      camera={
        search.x !== undefined && search.y !== undefined && search.z !== undefined
          ? { x: search.x, y: search.y, scale: search.z }
          : undefined
      }
      scene={search.scene}
      submitted={search.submitted ?? false}
      tab={search.tab}
      onTabChange={(tab) =>
        void navigate({ search: (previous) => ({ ...previous, tab }), replace: true })
      }
    />
  );
}
