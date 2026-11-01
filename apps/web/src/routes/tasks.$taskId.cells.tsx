import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CellsOnSlide } from "../screens/review/cells-on-slide.tsx";
import { mockScenes } from "../screens/scenes.ts";

const cellsSearch = z.object({
  slide: z.string().optional(),
  scene: z.enum(mockScenes.gallery).optional(),
});

export const Route = createFileRoute("/tasks/$taskId/cells")({
  validateSearch: cellsSearch,
  component: CellsOnTheSlide,
});

function CellsOnTheSlide() {
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  return <CellsOnSlide taskId={taskId} slideId={search.slide ?? ""} scene={search.scene} />;
}
