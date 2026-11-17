import { createFileRoute } from "@tanstack/react-router";
import { CellsOnSlide } from "../screens/review/cells-on-slide.tsx";
import { cellsSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/tasks/$taskId/cells")({
  validateSearch: cellsSearch,
  component: CellsOnTheSlide,
});

function CellsOnTheSlide() {
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  return <CellsOnSlide taskId={taskId} slideId={search.slide ?? ""} scene={search.scene} />;
}
