import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const slideSearch = z.object({
  task: z.string().optional(),
  x: z.number().min(0).max(1).default(0.5),
  y: z.number().min(0).max(1).default(0.5),
  z: z.number().min(0).max(20).default(0),
  object: z.string().optional(),
  scene: z.enum(mockScenes.case).optional(),
});

export const Route = createFileRoute("/projects/$projectId/slides/$slideId")({
  validateSearch: slideSearch,
  component: SlideView,
});

function SlideView() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return <Placeholder title="Slide" builtBy="PROTO-018 (full viewer)" route={{ params, search }} />;
}
