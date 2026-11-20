import {
  type Thread,
  useGetMe,
  useGetProject,
  useGetReviewTask,
  useGetReviewTaskStates,
  useListReviewObjects,
} from "@parfocal/api-client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { annotateTaskOf, layerKnownOf, withLookOnly } from "../annotations/annotate-task.ts";
import { slideStatusQuery } from "../annotations/annotate-task-api.ts";
import { readBuildConfig } from "../config.ts";
import { useRememberResume } from "../screens/home/remember-resume.ts";
import { usePeople } from "../screens/people.ts";
import { okData } from "../screens/placeholder.tsx";
import { useRefusals } from "../screens/refusals.ts";
import { useInspectorLayout } from "../screens/review/inspector-layout.ts";
import type { ViewerTab } from "../screens/viewer/viewer-scenes.ts";
import { usePeekKey } from "../screens/viewer-tools/slide-peek.tsx";
import { FirstReadGuard } from "./first-read-guard.tsx";
import { LiveTopBar } from "./live-top-bar.tsx";
import { CasePatientBanner } from "./patient-banner-view.tsx";
import { useCellRetype } from "./picked-cell-retype.tsx";
import { CopyIntoParfocal, RemoteSlideOffline, RemoteSlideTag } from "./remote-slide-notice.tsx";
import { ResultSetNotice } from "./result-set-notice.tsx";
import { SlideStage } from "./slide-stage.tsx";
import { ReviewStageComments, StageComments } from "./stage-comments.tsx";
import { StageFocusPill, useFocusKey } from "./stage-focus.tsx";
import type { StageSession } from "./stage-inspector.tsx";
import {
  AccessNotice,
  ReadOnlyNotice,
  SignedOffNotice,
  StageIssueLayer,
  useReviewerNames,
} from "./stage-issue-cards.tsx";
import {
  isWithdrawn,
  nothingFoundOf,
  othersReviewOf,
  resultMissingOf,
  signedOffOf,
} from "./stage-issues.ts";
import { StageMinimap } from "./stage-minimap.tsx";
import { NoticeSlotsProvider } from "./stage-notices.tsx";
import type { NoteRequest } from "./stage-object-notes.tsx";
import { StageObjectNotes } from "./stage-object-notes.tsx";
import { StageOpinion } from "./stage-opinion.tsx";
import { StageResultCells } from "./stage-result-cells.tsx";
import { StageReviewObjects } from "./stage-review-objects.tsx";
import { type StageStart, StageStartCamera } from "./stage-start.tsx";
import { useStageTabCounts } from "./stage-tab-counts.ts";
import { type ArmTool, StageToolLink } from "./stage-tool-link.tsx";
import type { ThreadFocusRequest } from "./thread-focus.tsx";
import type { SlideStorageNote } from "./tile-grant.ts";
import { useCaseLoad } from "./use-case-load.ts";
import { useSlideAreas } from "./use-slide-areas.ts";
import {
  assignedTo,
  isReadOnly,
  lookOnlyLayer,
  readOnlyCodeOf,
  viewerAccessOf,
  workspaceRoleOf,
} from "./viewer-access.ts";
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
  cells?: boolean;
  tool?: string | undefined;
  focus?: boolean;
  onFocus?: ((on: boolean) => void) | undefined;
  onOpenSlide: (slideId: string) => void;
  onWorkspace: (workspace: SlideWorkspace) => void;
  onTab?: ((tab: ViewerTab) => void) | undefined;
};

export function EngineViewer(props: EngineViewerProps) {
  return (
    <FirstReadGuard taskId={props.task} slideId={props.slideId}>
      <GuardedViewer {...props} />
    </FirstReadGuard>
  );
}

function GuardedViewer({
  projectId,
  slideId,
  task,
  workspace: chosen,
  tab: routeTab,
  start,
  object,
  guided = false,
  cells = false,
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
  const [finish, setFinish] = useState<HTMLElement | null>(null);
  const [, setLayout] = useInspectorLayout();
  const person = usePeople();
  const storageNote = storage?.slideId === slideId ? storage.note : null;
  const closePeek = useCallback(() => setPeek(false), []);
  const openPeek = useCallback(() => setPeek(true), []);
  usePeekKey(peek, openPeek, closePeek);
  const [peekHost, setPeekHost] = useState<HTMLElement | null>(null);
  const viewed = { peek, onPeekClose: closePeek, onPercent: setPercent, host: peekHost };
  const load = loaded.state === "ready" ? loaded.load : null;
  const flagged = load !== null && load.resultSets.length > 0;
  const slideAreas = useSlideAreas(slideId, flagged);
  const areas = slideAreas.areas;
  const workspace = resolveWorkspace(chosen, load?.task?.kind);
  const taskQuery = useGetReviewTask(task ?? "", { query: { enabled: task !== undefined } });
  const taskDetail = okData(taskQuery.data);
  const layerKnown = layerKnownOf(task, taskQuery.isSuccess || taskQuery.isError);
  const projectRole = okData(useGetProject(projectId).data)?.my_role ?? undefined;
  const owner = projectRole === "owner";
  const annotating = task !== undefined && taskDetail?.kind === "annotate";
  const annotateStatus = okData(
    useQuery({ ...slideStatusQuery(task ?? "", slideId), enabled: annotating }).data,
  );
  const withdrawn = taskDetail?.kind === "review" && isWithdrawn(taskDetail);
  const reviewTask = task !== undefined && taskDetail?.kind === "review" ? task : null;
  const statesQuery = useGetReviewTaskStates(task ?? "", {
    query: { enabled: task !== undefined && taskDetail?.kind === "review" },
  });
  const signedOff =
    taskDetail?.kind === "review" ? signedOffOf(okData(statesQuery.data), slideId) : null;
  const resultMissing =
    taskDetail?.kind === "review" && resultMissingOf(taskDetail.slides, slideId);
  const reviewObjects = useListReviewObjects(reviewTask ?? "", slideId, {
    query: { enabled: reviewTask !== null },
  });
  const nothingFound = reviewTask !== null && nothingFoundOf(okData(reviewObjects.data));
  const meData = okData(useGetMe().data);
  const me = meData?.user_id;
  const othersReview =
    taskDetail?.kind === "review" ? othersReviewOf(taskDetail.slides, slideId, me) : null;
  const reviewers = useReviewerNames(othersReview?.map((id) => person(id)?.name ?? id) ?? null);
  const access = viewerAccessOf({
    role: workspaceRoleOf(meData),
    projectRole,
    taskKind: task === undefined ? undefined : taskDetail?.kind,
    assigned: taskDetail === undefined ? undefined : assignedTo(taskDetail.slides, slideId, me),
    withdrawn: isWithdrawn(taskDetail),
    signedOff: annotating ? annotateStatus?.signed_off_at != null : signedOff !== null,
  });
  const layerLookOnly = annotating && lookOnlyLayer(access);
  const annotateTask = withLookOnly(
    annotateTaskOf(taskDetail, slideId, owner, object),
    layerLookOnly,
  );
  const retype = useCellRetype(projectId, annotateTask);
  const { sentenceOf } = useRefusals();
  const accessCode = readOnlyCodeOf(access);
  const accessLine = accessCode === undefined ? undefined : sentenceOf(accessCode);
  const lookingOn =
    access.kind === "read-only" &&
    (access.reason === "not-assigned" || access.reason === "no-review-right");
  const stageReadOnly = annotating ? layerLookOnly : isReadOnly(access);
  const opinionShown = taskDetail?.kind === "review" && !lookingOn;
  const taskSlideIds = taskDetail?.slides.map((item) => item.slide_id) ?? [];
  const nextSlideId = taskSlideIds[taskSlideIds.indexOf(slideId) + 1];
  const researcher = person(taskDetail?.created_by_user_id)?.name;
  const tabCounts = useStageTabCounts({
    projectId,
    taskId: task,
    reviewTaskId: reviewTask,
    slideId,
  });
  const [noteObject, setNoteObject] = useState<string | null>(object ?? null);
  const [noteRequest, setNoteRequest] = useState<NoteRequest | null>(null);
  const [threadFocus, setThreadFocus] = useState<{
    slideId: string;
    request: ThreadFocusRequest;
  } | null>(null);
  const focusThread = (thread: Thread, open: boolean) =>
    setThreadFocus((before) => ({
      slideId,
      request: {
        count: (before?.request.count ?? 0) + 1,
        anchor: thread.anchor,
        openThreadId: open ? thread.id : undefined,
      },
    }));
  const goToThread = (thread: Thread) => focusThread(thread, false);
  const openThread = (thread: Thread) => focusThread(thread, true);
  const [jumpRequest, setJumpRequest] = useState<{ id: string; count: number } | null>(null);
  const toolLink = useRef<ArmTool | null>(null);
  const [currentObject, setCurrentObject] = useState<string | null>(object ?? null);
  const [doneRequest, setDoneRequest] = useState(0);
  useRememberResume(
    reviewTask === null || reviewers !== null
      ? null
      : {
          task_id: reviewTask,
          slide_id: slideId,
          mode: guided ? "guided" : "viewer",
          object_id: currentObject,
          camera: start === undefined ? null : { x: start.x, y: start.y, z: start.scale },
        },
  );
  const askResearcher = () => {
    showUi();
    setLayout({ hidden: false });
    onTab("comments");
    toolLink.current?.("comment");
  };
  const lock =
    reviewers !== null ? (
      <ReadOnlyNotice reviewers={reviewers} />
    ) : signedOff !== null ? (
      <SignedOffNotice at={signedOff.at} researcher={researcher} onAsk={askResearcher} />
    ) : access.kind === "read-only" &&
      accessLine !== undefined &&
      !withdrawn &&
      (!annotating || layerLookOnly) ? (
      <AccessNotice reason={access.reason} sentence={accessLine} />
    ) : null;
  const notices = useMemo(
    () => ({ banner, status, lock, finish, placeBanner: focus ? undefined : setBanner }),
    [banner, status, lock, finish, focus],
  );
  const extras = (session: StageSession) => (
    <>
      {start === undefined ? null : <StageStartCamera engine={session.engine} start={start} />}
      <StageMinimap
        engine={session.engine}
        slideId={slideId}
        overview={session.overview}
        units={session.module}
        surface={cells ? "cells" : "viewer"}
        guided={guided}
        seenPercent={percent}
        {...(reviewTask === null ? {} : { review: { taskId: reviewTask, current: currentObject } })}
        onOpen={openPeek}
      />
      <StageResultCells
        engine={session.engine}
        module={session.module}
        slideId={slideId}
        inTask={task !== undefined}
        retype={retype}
        reviewTaskId={reviewTask ?? undefined}
      />
      <StageToolLink armTool={session.armTool} link={toolLink} armFirst={tool} />
      {load ? <ResultSetNotice resultSets={load.resultSets} /> : null}
      {focus ? (
        <StageFocusPill
          label={load?.case?.label || load?.slide?.label || ""}
          detail={currentObject ?? ""}
          onShowUi={showUi}
        />
      ) : null}
      <StageIssueLayer
        route={session.route}
        slideId={slideId}
        withdrawn={withdrawn}
        unreadable={load?.slide?.highPowerUnreadable === true}
        resultMissing={resultMissing}
        nothingFound={nothingFound}
        signedOff={signedOff !== null}
        slideLabel={load?.slide?.label ?? ""}
        reviewers={reviewers}
        readOnly={reviewers !== null || lookingOn}
        readOnlyLine={accessLine}
        onAsk={askResearcher}
        onNext={
          nextSlideId === undefined || taskSlideIds.indexOf(slideId) < 0
            ? null
            : () => onOpenSlide(nextSlideId)
        }
      >
        {(answersOff, readOnly) =>
          reviewTask === null ? null : (
            <StageReviewObjects
              answersOff={answersOff}
              readOnly={readOnly}
              opinionLocked={accessLine}
              engine={session.engine}
              module={session.module}
              taskId={reviewTask}
              slideId={slideId}
              object={object}
              guided={guided}
              cellsGrid={cells}
              jumpRequest={jumpRequest}
              focus={focus ? { onShowUi: showUi } : null}
              doneRequest={doneRequest}
              onAddMissed={() => session.armTool("smart")}
              onCurrent={(id) => {
                setCurrentObject(id);
                if (guided && id !== null) {
                  setNoteRequest(null);
                  setNoteObject(id);
                }
              }}
              onComments={(id) => {
                setNoteRequest(null);
                setNoteObject(id);
                onTab("comments");
              }}
              onNote={(id) => {
                showUi();
                setLayout({ hidden: false });
                setNoteRequest((before) => ({ object: id, count: (before?.count ?? 0) + 1 }));
                setNoteObject(id);
                onTab("comments");
              }}
            />
          )
        }
      </StageIssueLayer>
    </>
  );
  const commentsProps = {
    onGoTo: goToThread,
    onOpen: openThread,
    onNewComment: () => toolLink.current?.("comment"),
    projectId,
    taskId: task,
    taskName: taskDetail?.name,
    slideId,
    slideLabel: load?.slide?.label ?? "",
  };
  const inspector = {
    guided,
    tab: tab === "opinion" && !opinionShown ? undefined : tab,
    onTab,
    counts: tabCounts,
    focus: threadFocus?.slideId === slideId ? threadFocus.request : null,
    extras,
    comments: (
      <>
        {reviewTask !== null && noteObject !== null ? (
          <StageObjectNotes
            key={noteObject}
            editRequest={noteRequest?.object === noteObject ? noteRequest.count : 0}
            taskId={reviewTask}
            slideId={slideId}
            object={noteObject}
            onAllComments={() => setNoteObject(null)}
          />
        ) : null}
        {reviewTask === null ? (
          <StageComments {...commentsProps} />
        ) : (
          <ReviewStageComments
            {...commentsProps}
            reviewTaskId={reviewTask}
            onSelectNote={(id) => {
              setNoteRequest(null);
              setNoteObject(id);
            }}
          />
        )}
      </>
    ),
    opinion: opinionShown ? (
      <StageOpinion
        taskId={task}
        slideId={slideId}
        reviewTask
        readOnly={accessLine}
        onObjects={(id) => {
          onTab("objects");
          if (id !== undefined)
            setJumpRequest((before) => ({ id, count: (before?.count ?? 0) + 1 }));
        }}
      />
    ) : null,
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
          guided={guided}
          onWorkspace={onWorkspace}
          onOpenSlide={onOpenSlide}
          onSubmit={
            isReadOnly(access)
              ? undefined
              : () => {
                  setLayout({ hidden: false });
                  if (guided) {
                    setDoneRequest((count) => count + 1);
                    onTab("objects");
                  } else onTab("opinion");
                }
          }
          onResultSets={() => {
            setLayout({ hidden: false });
            onTab("display");
          }}
          percent={percent}
          objectTotal={areas.length}
          onPeek={() => setPeek(true)}
          statusRef={setStatus}
          finishRef={setFinish}
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
        </>
      )}
      <div className="relative min-h-0 flex-1">
        {focus ? (
          <div
            data-testid="focus-notices"
            className="pointer-events-none absolute top-14 left-1/2 z-20 flex w-[min(760px,calc(100%-2rem))] -translate-x-1/2 flex-col items-center gap-2"
          >
            <div
              ref={setStatus}
              data-testid="focus-save-status"
              className="pointer-events-auto empty:hidden"
            />
            <div
              ref={setBanner}
              data-testid="viewer-banner"
              className="pointer-events-auto w-full empty:hidden"
            />
          </div>
        ) : null}
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
            readOnly={stageReadOnly}
            onOpenSlide={onOpenSlide}
            onStorage={(note) => setStorage({ slideId, note })}
            systematicScan={load !== null && slideAreas.loaded && areas.length === 0}
            inspector={inspector}
            bare={focus}
          />
        </NoticeSlotsProvider>
        <div
          ref={setPeekHost}
          data-slot="peek-host"
          className="absolute inset-0 z-30 empty:hidden"
        />
      </div>
    </main>
  );
}
