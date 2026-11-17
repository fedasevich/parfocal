import { createFileRoute } from "@tanstack/react-router";
import { AnnotateTaskView } from "../screens/annotate-task/annotate-task-view.tsx";
import { WithToolSession } from "../screens/viewer-tools/tool-session.tsx";
import { annotateTaskSearch } from "../search/route-searches.ts";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/annotate-task")({
  validateSearch: annotateTaskSearch,
  component: AnnotateTaskWorkspace,
});

function AnnotateTaskWorkspace() {
  const { projectId, slideId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <WithToolSession projectId={projectId} slideId={slideId} task={search.task}>
      {(tools) => <AnnotateTaskView tools={tools} scene={search.scene ?? "origins"} />}
    </WithToolSession>
  );
}
