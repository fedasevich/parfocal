import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
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
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Cells on the slide"
      builtBy="PROTO-007 (guided review, the Slide done card and the next slide)"
      route={{ params, search }}
    />
  );
}
