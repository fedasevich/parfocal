import { type Thread, useGetProject, useGetReviewTask } from "@parfocal/api-client";
import { useCallback, useMemo, useRef, useState } from "react";
import { annotateTaskOf, layerKnownOf } from "../annotations/annotate-task.ts";
import { readBuildConfig } from "../config.ts";
import { useRememberResume } from "../screens/home/remember-resume.ts";
import { okData } from "../screens/placeholder.tsx";
import { useInspectorLayout } from "../screens/review/inspector-layout.ts";
import type { ViewerTab } from "../screens/viewer/viewer-scenes.ts";
import { LiveTopBar } from "./live-top-bar.tsx";
import { CasePatientBanner } from "./patient-banner-view.tsx";
import { CopyIntoParfocal, RemoteSlideOffline, RemoteSlideTag } from "./remote-slide-notice.tsx";
import { SlideStage } from "./slide-stage.tsx";
import { StageComments } from "./stage-comments.tsx";
import { StageFocusPill, useFocusKey } from "./stage-focus.tsx";
import type { StageSession } from "./stage-inspector.tsx";
import { StageMinimap } from "./stage-minimap.tsx";
import { NoticeSlotsProvider } from "./stage-notices.tsx";
import { StageObjectNotes } from "./stage-object-notes.tsx";
import { StageOpinion } from "./stage-opinion.tsx";
import { StageResultCells } from "./stage-result-cells.tsx";
import { StageReviewObjects } from "./stage-review-objects.tsx";
import { type StageStart, StageStartCamera } from "./stage-start.tsx";
import { type ArmTool, StageToolLink } from "./stage-tool-link.tsx";
import type { ThreadFocusRequest } from "./thread-focus.tsx";
import type { SlideStorageNote } from "./tile-grant.ts";
import { useCaseLoad } from "./use-case-load.ts";
import { useSlideAreas } from "./use-slide-areas.ts";
import { resolveWorkspace, type SlideWorkspace } from "./workspace.ts";

const fakeOutlines = readBuildConfig().fakeApi !== "off";

export type EngineViewerProps = {
  projectId: string;
  slideId: string;
  task: string | undefined;
  workspace: SlideWorkspace | undefined;
  tab?: ViewerTab | undefined;
  start?: StageStart | undefined;
  object?: string | undefined;
  guided?: boolean;
  tool?: string | undefined;
  focus?: boolean;
  onFocus?: ((on: boolean) => void) | undefined;
  onOpenSlide: (slideId: string) => void;
  onWorkspace: (workspace: SlideWorkspace) => void;
  onTab?: ((tab: ViewerTab) => void) | undefined;
};

export function EngineViewer({
  projectId,
  slideId,
  task,
  workspace: chosen,
  tab: routeTab,
  start,
  object,
  guided = false,
  tool,
  focus = false,
  onFocus,
  onOpenSlide,
  onWorkspace,
  onTab: onRouteTab,
}: EngineViewerProps) {
  const showUi = () => onFocus?.(false);
  useFocusKey(() => onFocus?.(!focus));
  const [ownTab, setOwnTab] = useState<ViewerTab | undefined>(undefined);
  const tab = onRouteTab === undefined ? ownTab : routeTab;
  const onTab = onRouteTab ?? setOwnTab;
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
  const reviewTask = task !== undefined && taskDetail?.kind === "review" ? task : null;
  const [noteObject, setNoteObject] = useState<string | null>(object ?? null);
  const [threadFocus, setThreadFocus] = useState<{
    slideId: string;
    request: ThreadFocusRequest;
  } | null>(null);
  const goToThread = (thread: Thread) =>
    setThreadFocus((before) => ({
      slideId,
      request: { count: (before?.request.count ?? 0) + 1, anchor: thread.anchor },
    }));
  const toolLink = useRef<ArmTool | null>(null);
  const [currentObject, setCurrentObject] = useState<string | null>(object ?? null);
  useRememberResume(
    reviewTask === null
      ? null
      : {
          task_id: reviewTask,
          slide_id: slideId,
          mode: guided ? "guided" : "viewer",
          object_id: currentObject,
          camera: start === undefined ? null : { x: start.x, y: start.y, z: start.scale },
        },
  );
  const extras = (session: StageSession) => (
    <>
      {start === undefined ? null : <StageStartCamera engine={session.engine} start={start} />}
      <StageMinimap engine={session.engine} slideId={slideId} overview={session.overview} />
      <StageResultCells
        engine={session.engine}
        module={session.module}
        slideId={slideId}
        inTask={task !== undefined}
      />
      <StageToolLink armTool={session.armTool} link={toolLink} armFirst={tool} />
      {focus ? (
        <StageFocusPill
          label={load?.case?.label || load?.slide?.label || ""}
          detail={currentObject ?? ""}
          onShowUi={showUi}
        />
      ) : null}
      {reviewTask === null ? null : (
        <StageReviewObjects
          engine={session.engine}
          module={session.module}
          taskId={reviewTask}
          slideId={slideId}
          object={object}
          guided={guided}
          focus={focus ? { onShowUi: showUi } : null}
          onCurrent={setCurrentObject}
          onComments={(id) => {
            setNoteObject(id);
            onTab("comments");
          }}
        />
      )}
    </>
  );
  const inspector = {
    tab,
    onTab,
    focus: threadFocus?.slideId === slideId ? threadFocus.request : null,
    extras,
    comments:
      reviewTask !== null && noteObject !== null ? (
        <StageObjectNotes
          taskId={reviewTask}
          slideId={slideId}
          object={noteObject}
          onAllComments={() => setNoteObject(null)}
        />
      ) : (
        <StageComments
          onGoTo={goToThread}
          onNewComment={() => toolLink.current?.("comment")}
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
        onObjects={() => onTab("objects")}
      />
    ),
  };
  return (
    <main
      className="flex h-screen flex-col bg-chrome text-fg"
      data-testid={focus ? "focus-mode" : undefined}
    >
      {focus ? null : (
        <LiveTopBar
          projectId={projectId}
          slideId={slideId}
          load={load}
          task={taskDetail}
          workspace={workspace}
          onWorkspace={onWorkspace}
          onOpenSlide={onOpenSlide}
          onSubmit={() => {
            setLayout({ hidden: false });
            onTab("opinion");
          }}
          percent={percent}
          objectTotal={areas.length}
          onPeek={() => setPeek(true)}
          statusRef={setStatus}
          storage={
            <>
              <RemoteSlideTag note={storageNote} />
              <CopyIntoParfocal slideId={slideId} note={storageNote} canUpload={owner} />
            </>
          }
        />
      )}
      {focus ? null : (
        <>
          {load ? <CasePatientBanner load={load} /> : null}
          <RemoteSlideOffline note={storageNote} />
          <div ref={setBanner} data-testid="viewer-banner" className="empty:hidden" />
        </>
      )}
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
            onOpenSlide={onOpenSlide}
            onStorage={(note) => setStorage({ slideId, note })}
            systematicScan={load !== null && slideAreas.loaded && areas.length === 0}
            inspector={inspector}
            bare={focus}
          />
        </NoticeSlotsProvider>
      </div>
    </main>
  );
}
