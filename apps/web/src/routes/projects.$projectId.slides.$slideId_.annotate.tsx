import { createFileRoute } from "@tanstack/react-router";
import { AnnotateView } from "../screens/viewer-tools/annotate-view.tsx";
import { WithToolSession } from "../screens/viewer-tools/tool-session.tsx";
import { annotateSearch } from "../search/route-searches.ts";
import { slidePath } from "../shell/slide-link.ts";
import { openSlideEarly } from "../viewer/load-engine.ts";
import { slideRedirect } from "../viewer/old-slide-address.ts";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/annotate")({
  validateSearch: annotateSearch,
  beforeLoad: ({ params, search, location }) => {
    if (search.scene !== undefined) return;
    throw slideRedirect(params, location.search, { mode: "annotate" });
  },
  loader: ({ params, cause }) => openSlideEarly(params.slideId, cause),
  component: AnnotatePrototype,
});

function AnnotatePrototype() {
  const { projectId, slideId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
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
              to: slidePath,
              params: { projectId, slideId },
              search: { task: tools.session.taskId, tab },
            })
          }
        />
      )}
    </WithToolSession>
  );
}
