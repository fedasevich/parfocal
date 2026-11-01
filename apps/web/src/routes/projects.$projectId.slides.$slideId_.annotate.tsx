import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { mockScenes } from "../screens/scenes.ts";
import { AnnotateView } from "../screens/viewer-tools/annotate-view.tsx";
import { WithToolSession } from "../screens/viewer-tools/tool-session.tsx";

const annotateSearch = z.object({
  task: z.string().optional(),
  scene: z.enum(mockScenes.annotate).optional(),
});

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/annotate")({
  validateSearch: annotateSearch,
  component: AnnotateWorkspace,
});

function AnnotateWorkspace() {
  const { projectId, slideId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <WithToolSession projectId={projectId} slideId={slideId} task={search.task}>
      {(tools) => (
        <AnnotateView
          tools={tools}
          scene={search.scene ?? "auto"}
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
