import { useLingui } from "@lingui/react/macro";
import { useGetReviewTask } from "@parfocal/api-client";
import { Loader } from "@parfocal/ui/components/loader";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { CellsOnSlide } from "../screens/review/cells-on-slide.tsx";
import type { ViewerTab } from "../screens/viewer/viewer-scenes.ts";
import { cellsSearch } from "../search/route-searches.ts";
import { EngineViewer } from "../viewer/engine-viewer.tsx";
import { loadViewerEngine } from "../viewer/load-engine.ts";

export const Route = createFileRoute("/tasks/$taskId/cells")({
  validateSearch: cellsSearch,
  loader: loadViewerEngine,
  component: CellsOnTheSlide,
});

function CellsOnTheSlide() {
  const { taskId } = Route.useParams();
  const search = Route.useSearch();
  if (search.scene === undefined) return <CellsOnStage />;
  return <CellsOnSlide taskId={taskId} slideId={search.slide ?? ""} scene={search.scene} />;
}

function CellsOnStage() {
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
  return (
    <EngineViewer
      projectId={task.project_id}
      slideId={slideId}
      task={taskId}
      workspace="review"
      tab={tab}
      cells
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
  );
}
