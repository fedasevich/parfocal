import { createFileRoute } from "@tanstack/react-router";
import { CellsOnSlide } from "../screens/review/cells-on-slide.tsx";
import { cellsSearch } from "../search/route-searches.ts";
import { loadViewerEngine } from "../viewer/load-engine.ts";
import { TaskSlideRedirect } from "../viewer/task-slide-redirect.tsx";

export const Route = createFileRoute("/tasks/$taskId/cells")({
  validateSearch: cellsSearch,
  loader: loadViewerEngine,
  component: CellsOnTheSlide,
});

function CellsOnTheSlide() {
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  if (search.scene === undefined) {
    return <TaskSlideRedirect taskId={taskId} slideId={search.slide} mode="cells" />;
  }
  return <CellsOnSlide taskId={taskId} slideId={search.slide ?? ""} scene={search.scene} />;
}
