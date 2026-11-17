import { createFileRoute } from "@tanstack/react-router";
import { AnnotateTaskView } from "../fake-api/annotate-task/annotate-task-view.tsx";
import { WithToolSession } from "../screens/viewer-tools/tool-session.tsx";
import { annotateTaskSearch } from "../search/route-searches.ts";
import { EngineViewer } from "../viewer/engine-viewer.tsx";
import { openSlideEarly } from "../viewer/load-engine.ts";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/annotate-task")({
  validateSearch: annotateTaskSearch,
  loader: ({ params, cause }) => openSlideEarly(params.slideId, cause),
  component: AnnotateTaskWorkspace,
});

function AnnotateTaskWorkspace() {
  const { projectId, slideId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (search.scene === undefined) {
    return (
      <EngineViewer
        projectId={projectId}
        slideId={slideId}
        task={search.task}
        workspace="annotate"
        onOpenSlide={(next) =>
          void navigate({
            to: "/projects/$projectId/slides/$slideId/annotate-task",
            params: { projectId, slideId: next },
            search: { task: search.task },
          })
        }
        onWorkspace={(workspace) =>
          void navigate({
            to: "/projects/$projectId/slides/$slideId",
            params: { projectId, slideId },
            search: { task: search.task, workspace },
          })
        }
      />
    );
  }
  return (
    <WithToolSession projectId={projectId} slideId={slideId} task={search.task}>
      {(tools) => <AnnotateTaskView tools={tools} scene={search.scene ?? "origins"} />}
    </WithToolSession>
  );
}
