import { createFileRoute } from "@tanstack/react-router";
import { AnnotateTaskView } from "../fake-api/annotate-task/annotate-task-view.tsx";
import { WithToolSession } from "../screens/viewer-tools/tool-session.tsx";
import { annotateTaskSearch } from "../search/route-searches.ts";
import { openSlideEarly } from "../viewer/load-engine.ts";
import { slideRedirect } from "../viewer/old-slide-address.ts";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/annotate-task")({
  validateSearch: annotateTaskSearch,
  beforeLoad: ({ params, search, location }) => {
    if (search.scene !== undefined) return;
    throw slideRedirect(params, location.search, { mode: "annotate" });
  },
  loader: ({ params, cause }) => openSlideEarly(params.slideId, cause),
  component: AnnotateTaskPrototype,
});

function AnnotateTaskPrototype() {
  const { projectId, slideId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <WithToolSession projectId={projectId} slideId={slideId} task={search.task}>
      {(tools) => <AnnotateTaskView tools={tools} scene={search.scene ?? "origins"} />}
    </WithToolSession>
  );
}
