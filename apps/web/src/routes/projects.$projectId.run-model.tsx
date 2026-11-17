import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectBackground } from "../screens/jobs/project-background.tsx";
import { RunModelWindow } from "../screens/jobs/run-model-window.tsx";
import { runModelSearch } from "../search/route-searches.ts";
import { useJobsTray, useOpenJobsTray } from "../shell/jobs-tray.tsx";

export const Route = createFileRoute("/projects/$projectId/run-model")({
  validateSearch: runModelSearch,
  component: RunAModel,
});

function RunAModel() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const scene = search.scene ?? "pick";
  const navigate = useNavigate();
  const tray = useJobsTray();
  useOpenJobsTray(scene === "started");
  const toProject = () => navigate({ to: "/projects/$projectId", params: { projectId } });
  return (
    <ProjectBackground projectId={projectId}>
      {scene === "started" ? null : (
        <RunModelWindow
          projectId={projectId}
          scene={scene}
          slideIds={search.slides}
          onClose={() => void toProject()}
          onStarted={() => {
            void toProject().then(() => tray.setOpen(true));
          }}
        />
      )}
    </ProjectBackground>
  );
}
