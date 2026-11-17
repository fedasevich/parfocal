import { useLingui } from "@lingui/react/macro";
import { useGetReviewTask } from "@parfocal/api-client";
import { Loader } from "@parfocal/ui/components/loader";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { GuidedGate } from "../screens/review/guided-gate.tsx";
import { GuidedReview } from "../screens/review/guided-review.tsx";
import { SlidePicture } from "../screens/review/slide-picture.tsx";
import type { ViewerTab } from "../screens/viewer/viewer-scenes.ts";
import { guidedSearch } from "../search/route-searches.ts";
import { EngineViewer } from "../viewer/engine-viewer.tsx";
import { loadViewerEngine } from "../viewer/load-engine.ts";

export const Route = createFileRoute("/tasks/$taskId/guided")({
  validateSearch: guidedSearch,
  loader: loadViewerEngine,
  component: GuidedRoute,
});

function GuidedRoute() {
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (search.scene === undefined) return <GuidedOnStage />;
  return (
    <SlidePicture slideId={search.slide ?? ""}>
      <GuidedReview
        taskId={taskId}
        slideId={search.slide ?? ""}
        objectId={search.object}
        camera={
          search.x !== undefined && search.y !== undefined && search.z !== undefined
            ? { x: search.x, y: search.y, scale: search.z }
            : undefined
        }
        scene={search.scene}
        submitted={search.submitted ?? false}
        tab={search.tab}
        onTabChange={(tab) =>
          void navigate({ search: (previous) => ({ ...previous, tab }), replace: true })
        }
      />
    </SlidePicture>
  );
}

function GuidedOnStage() {
  const { t } = useLingui();
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [tab, setTab] = useState<ViewerTab>("objects");
  const task = okData(useGetReviewTask(taskId).data);
  const slideId = search.slide ?? task?.slides[0]?.slide_id;
  if (task === undefined || slideId === undefined) {
    return <Loader label={t`Loading the review`} size="page" />;
  }
  const start =
    search.x !== undefined && search.y !== undefined
      ? { x: search.x, y: search.y, scale: search.z ?? 1 }
      : undefined;
  return (
    <GuidedGate taskId={taskId} slideId={slideId}>
      {() => (
        <EngineViewer
          projectId={task.project_id}
          slideId={slideId}
          task={taskId}
          workspace="review"
          tab={tab}
          guided
          object={search.object}
          start={start}
          onOpenSlide={(next) => void navigate({ search: { slide: next } })}
          onWorkspace={(workspace) =>
            void navigate({
              to: "/projects/$projectId/slides/$slideId",
              params: { projectId: task.project_id, slideId },
              search: { task: taskId, workspace },
            })
          }
          onTab={setTab}
        />
      )}
    </GuidedGate>
  );
}
