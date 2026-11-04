import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mockScenes } from "../screens/scenes.ts";
import { LivePage } from "../screens/upload/live-page.tsx";
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
  if (search.scene === undefined || search.flow === "live") {
    return <LivePage projectId={projectId} scene={search.scene} />;
  }
  const scene = search.scene;
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
