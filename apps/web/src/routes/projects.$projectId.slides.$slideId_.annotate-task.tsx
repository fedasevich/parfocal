import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AnnotateTaskView } from "../screens/annotate-task/annotate-task-view.tsx";
import { taskScenes } from "../screens/annotate-task/scene-list.ts";
import { WithToolSession } from "../screens/viewer-tools/tool-session.tsx";

const sceneKeys = taskScenes.map((item) => item.scene) as [
  (typeof taskScenes)[number]["scene"],
  ...(typeof taskScenes)[number]["scene"][],
];

const annotateTaskSearch = z.object({
  task: z.string().optional(),
  scene: z.enum(sceneKeys).optional(),
});

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
