import { createFileRoute } from "@tanstack/react-router";
import { AnnotateView } from "../screens/viewer-tools/annotate-view.tsx";
import { WithToolSession } from "../screens/viewer-tools/tool-session.tsx";
import { annotateSearch } from "../search/route-searches.ts";
import { EngineViewer } from "../viewer/engine-viewer.tsx";
import { openSlideEarly } from "../viewer/load-engine.ts";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/annotate")({
  validateSearch: annotateSearch,
  loader: ({ params, cause }) => openSlideEarly(params.slideId, cause),
  component: AnnotateWorkspace,
});

function AnnotateWorkspace() {
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
        tool={search.tool}
        onOpenSlide={(next) =>
          void navigate({
            to: "/projects/$projectId/slides/$slideId/annotate",
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
      {(tools) => (
        <AnnotateView
          tools={tools}
          scene={search.scene ?? "auto"}
          initialTool={search.tool}
          onScene={(scene) =>
            void navigate({ search: (previous) => ({ ...previous, scene }), replace: true })
          }
          onLeave={(tab) =>
            void navigate({
              to: "/projects/$projectId/slides/$slideId",
              params: { projectId, slideId },
              search: { task: tools.session.taskId, tab },
            })
          }
        />
      )}
    </WithToolSession>
  );
}
