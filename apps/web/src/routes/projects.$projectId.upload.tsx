import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mockScenes } from "../screens/scenes.ts";
import { UploadPage } from "../screens/upload/upload-page.tsx";

const uploadSearch = z.object({
  scene: z.enum(mockScenes.upload).optional(),
  flow: z.string().optional(),
  formats: z.enum(mockScenes.formats).optional(),
});

export const Route = createFileRoute("/projects/$projectId/upload")({
  validateSearch: uploadSearch,
  component: UploadRoute,
});

function UploadRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const scene = search.scene ?? "empty";
  const flow = search.flow ?? scene;
  return (
    <UploadPage
      key={flow}
      projectId={projectId}
      scene={scene}
      flow={flow}
      formats={search.formats}
    />
  );
}
