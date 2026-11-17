import { createFileRoute } from "@tanstack/react-router";
import { liveSearch } from "../search/route-searches.ts";
import { EngineViewer } from "../viewer/engine-viewer.tsx";
import { openSlideEarly } from "../viewer/load-engine.ts";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/live")({
  validateSearch: liveSearch,
  loader: ({ params, cause }) => openSlideEarly(params.slideId, cause),
  component: LiveSlide,
});

function LiveSlide() {
  const { projectId, slideId } = Route.useParams();
  const { task, workspace, tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <EngineViewer
      projectId={projectId}
      slideId={slideId}
      task={task}
      workspace={workspace}
      tab={tab}
      onOpenSlide={(next) =>
        void navigate({
          to: "/projects/$projectId/slides/$slideId/live",
          params: { projectId, slideId: next },
          search: { task, workspace, tab },
        })
      }
      onWorkspace={(next) =>
        void navigate({ search: (previous) => ({ ...previous, workspace: next }), replace: true })
      }
      onTab={(next) =>
        void navigate({ search: (previous) => ({ ...previous, tab: next }), replace: true })
      }
    />
  );
}
