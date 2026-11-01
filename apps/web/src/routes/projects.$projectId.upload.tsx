import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Placeholder } from "../screens/placeholder.tsx";
import { mockScenes } from "../screens/scenes.ts";

const uploadSearch = z.object({
  scene: z.enum(mockScenes.upload).optional(),
});

export const Route = createFileRoute("/projects/$projectId/upload")({
  validateSearch: uploadSearch,
  component: UploadSlidesAndResults,
});

function UploadSlidesAndResults() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <Placeholder
      title="Upload slides and results"
      builtBy="PROTO-004 (project page, new project and upload)"
      route={{ params, search }}
    />
  );
}
