import { useGetProject, useGetReviewTask } from "@parfocal/api-client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { annotateTaskOf, layerKnownOf } from "../annotations/annotate-task.ts";
import { readBuildConfig } from "../config.ts";
import { okData } from "../screens/placeholder.tsx";
import { useInspectorLayout } from "../screens/review/inspector-layout.ts";
import type { ViewerTab } from "../screens/viewer/viewer-scenes.ts";
import { liveSearch } from "../search/route-searches.ts";
import { LiveTopBar } from "../viewer/live-top-bar.tsx";
import { loadViewerEngine } from "../viewer/load-engine.ts";
import { CasePatientBanner } from "../viewer/patient-banner-view.tsx";
import {
  CopyIntoParfocal,
  RemoteSlideOffline,
  RemoteSlideTag,
} from "../viewer/remote-slide-notice.tsx";
import { SlideStage } from "../viewer/slide-stage.tsx";
import { StageComments } from "../viewer/stage-comments.tsx";
import { NoticeSlotsProvider } from "../viewer/stage-notices.tsx";
import { StageOpinion } from "../viewer/stage-opinion.tsx";
import type { SlideStorageNote } from "../viewer/tile-grant.ts";
import { useCaseLoad } from "../viewer/use-case-load.ts";
import { useSlideAreas } from "../viewer/use-slide-areas.ts";
import { resolveWorkspace, type SlideWorkspace } from "../viewer/workspace.ts";

export const Route = createFileRoute("/projects/$projectId/slides/$slideId_/live")({
  validateSearch: liveSearch,
  loader: loadViewerEngine,
  component: LiveSlide,
});

const fakeOutlines = readBuildConfig().fakeApi !== "off";

function LiveSlide() {
  const { projectId, slideId } = Route.useParams();
  const { task, workspace: chosen, tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const loaded = useCaseLoad(projectId, slideId, task);
  const [percent, setPercent] = useState<number | null>(null);
  const [peek, setPeek] = useState(false);
  const [storage, setStorage] = useState<{ slideId: string; note: SlideStorageNote } | null>(null);
  const [banner, setBanner] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<HTMLElement | null>(null);
  const notices = useMemo(() => ({ banner, status }), [banner, status]);
  const [, setLayout] = useInspectorLayout();
  const storageNote = storage?.slideId === slideId ? storage.note : null;
  const closePeek = useCallback(() => setPeek(false), []);
  const viewed = { peek, onPeekClose: closePeek, onPercent: setPercent };
  const load = loaded.state === "ready" ? loaded.load : null;
  const flagged = load !== null && load.resultSets.length > 0;
  const slideAreas = useSlideAreas(slideId, flagged);
  const areas = slideAreas.areas;
  const workspace = resolveWorkspace(chosen, load?.task?.kind);
  const taskQuery = useGetReviewTask(task ?? "", { query: { enabled: task !== undefined } });
  const taskDetail = okData(taskQuery.data);
  const layerKnown = layerKnownOf(task, taskQuery.isSuccess || taskQuery.isError);
  const owner = okData(useGetProject(projectId).data)?.my_role === "owner";
  const annotateTask = annotateTaskOf(taskDetail, slideId, owner);
  const openSlide = (next: string) =>
    void navigate({
      to: "/projects/$projectId/slides/$slideId/live",
      params: { projectId, slideId: next },
      search: { task, workspace: chosen, tab },
    });
  const switchTo = (next: SlideWorkspace) =>
    void navigate({ search: (previous) => ({ ...previous, workspace: next }), replace: true });
  const showTab = (next: ViewerTab) =>
    void navigate({ search: (previous) => ({ ...previous, tab: next }), replace: true });
  const inspector = {
    tab,
    onTab: showTab,
    comments: (
      <StageComments
        projectId={projectId}
        taskId={task}
        taskName={taskDetail?.name}
        slideId={slideId}
        slideLabel={load?.slide?.label ?? ""}
      />
    ),
    opinion: (
      <StageOpinion
        taskId={task}
        slideId={slideId}
        reviewTask={taskDetail?.kind === "review"}
        onObjects={() => showTab("objects")}
      />
    ),
  };
  return (
    <main className="flex h-screen flex-col bg-chrome text-fg">
      <LiveTopBar
        projectId={projectId}
        slideId={slideId}
        load={load}
        task={taskDetail}
        workspace={workspace}
        onWorkspace={switchTo}
        onOpenSlide={openSlide}
        onSubmit={() => {
          setLayout({ hidden: false });
          showTab("opinion");
        }}
        percent={percent}
        onPeek={() => setPeek(true)}
        statusRef={setStatus}
        storage={
          <>
            <RemoteSlideTag note={storageNote} />
            <CopyIntoParfocal slideId={slideId} note={storageNote} canUpload={owner} />
          </>
        }
      />
      {load ? <CasePatientBanner load={load} /> : null}
      <RemoteSlideOffline note={storageNote} />
      <div ref={setBanner} data-testid="viewer-banner" className="empty:hidden" />
      <div className="min-h-0 flex-1">
        <NoticeSlotsProvider value={notices}>
          <SlideStage
            key={slideId}
            slideId={slideId}
            projectId={projectId}
            {...(task === undefined ? {} : { taskId: task })}
            areas={areas}
            viewed={viewed}
            outlines={fakeOutlines && task !== undefined && annotateTask === null}
            workspace={workspace}
            annotateTask={annotateTask}
            layerKnown={layerKnown}
            onOpenSlide={openSlide}
            onStorage={(note) => setStorage({ slideId, note })}
            systematicScan={load !== null && slideAreas.loaded && areas.length === 0}
            inspector={inspector}
          />
        </NoticeSlotsProvider>
      </div>
    </main>
  );
}
