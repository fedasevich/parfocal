import { createFileRoute } from "@tanstack/react-router";
import { LivePage } from "../screens/upload/live-page.tsx";
import { UploadPage } from "../screens/upload/upload-page.tsx";
import { uploadSearch } from "../search/route-searches.ts";
import { sceneHarnessOn } from "../search/scene-harness.ts";

export const Route = createFileRoute("/projects/$projectId/upload")({
  validateSearch: uploadSearch,
  component: UploadRoute,
});

function UploadRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  if (!sceneHarnessOn() || search.scene === undefined || search.flow === "live") {
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
