import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { FindingsPanel } from "@parfocal/ui/components/findings-panel";
import { InspectorPanel } from "@parfocal/ui/components/inspector-panel";
import { ModelWarningsBlock } from "@parfocal/ui/components/model-warnings";
import { SlideDoneCard } from "@parfocal/ui/components/slide-done-card";
import { ViewPicker } from "@parfocal/ui/components/visualize";
import { Zone } from "@parfocal/ui/components/zone";
import { inspectorCounts } from "@parfocal/ui/lib/inspector-tabs";
import { scanSummary } from "@parfocal/ui/lib/systematic-scan";
import type { ReactNode } from "react";
import { useSelectionSync } from "../../popout/popout-channel.ts";
import { reviewTyper } from "../review/ai-wording.ts";
import { cardText } from "../review/decision-style.ts";
import { DisplayTab } from "../review/display-tab.tsx";
import { FirstReadNotice } from "../review/first-read-notice.tsx";
import { hasNote } from "../review/note-model.ts";
import { answerLabel, SavedNote } from "../review/object-card.tsx";
import { ObjectComments } from "../review/object-comments.tsx";
import { answerOfNote } from "../review/others-notes.ts";
import { PinnedThread } from "../review/pinned-thread.tsx";
import { ReviewTop } from "../review/review-top.tsx";
import { ThreadsTab } from "../review/threads-tab.tsx";
import { overviewTissue } from "../review/tissue-mask.ts";
import { AiSays, ObjectList, ObjectsSummary } from "../review/viewer-frame.tsx";
import { lookUrl } from "../thumbnails.ts";
import { CalibrationBlock, TrackRecordBlock } from "./ai-record-blocks.tsx";
import { calibrationLines, trackRecordLines } from "./ai-record-lines.ts";
import {
  changedZone,
  findingsSelection,
  findingsZones,
  numberLineOf,
  stagingPanelAreas,
} from "./findings-data.ts";
import {
  AddedFoot,
  MeasurementFoot,
  ObjectFoot,
  RunningObjects,
  TellMeWhenReady,
} from "./objects-panel.tsx";
import type { useViewerScene } from "./use-viewer-scene.tsx";
import type { useViewerState } from "./use-viewer-state.tsx";
import { TableObjectFacts } from "./viewer-canvas-parts.tsx";
import type { BodyProps } from "./viewer-model-types.ts";
import { addedSize } from "./viewer-model-types.ts";
import { ViewerBanner, ViewerCanvasNotice, ViewerTileHint } from "./viewer-notices.tsx";
import { ViewerResultSets } from "./viewer-result-sets.tsx";
import { layerViews, mapViews, type ViewerTab } from "./viewer-scenes.ts";
import { ZoneFoot } from "./zone-gallery.tsx";

export function useViewerPanels(
  props: BodyProps,
  model: ReturnType<typeof useViewerState> & ReturnType<typeof useViewerScene>,
) {
  const { t } = useLingui();
  const {
    clinical,
    onSearch,
    panelOnly = false,
    projectCode,
    projectId,
    projectName,
    search,
    session,
    slideId,
    template,
    viewerParts,
  } = props;
  const {
    added,
    addedCurrent,
    answer,
    areaNav,
    areaRole,
    buttonsOff,
    callArea,
    cells,
    changeOpinion,
    changedCells,
    choice,
    classColor,
    classVisibility,
    confidence,
    counts,
    current,
    decide,
    decidedObject,
    display,
    doneBlockers,
    everyZone,
    extraLocks,
    failed,
    filter,
    findingsLayout,
    firstOpenCell,
    firstReadOpen,
    goView,
    learner,
    learnerView,
    leaveComment,
    measurement,
    measures,
    modelWarnings,
    navigate,
    netOff,
    nextInZone,
    noTask,
    noTumor,
    note,
    nothing,
    objects,
    online,
    openRegions,
    openZoneCells,
    openZoneId,
    othersOn,
    pathOfObject,
    person,
    personalSettings,
    pick,
    preset,
    progress,
    questions,
    readOnly,
    reportCaseId,
    restLookRight,
    reviewedOn,
    running,
    saveNote,
    scan,
    scanStep,
    scattered,
    selected,
    setA,
    setB,
    setFilter,
    setIsShown,
    setName,
    setNote,
    setOpenZoneId,
    setPin,
    setTellMe,
    setToast,
    setsLock,
    settings,
    setup,
    showScore,
    shownPin,
    slideLabel,
    slideSets,
    stagingAreas,
    stillView,
    style,
    submit,
    tab,
    taskCodeOrThe,
    taskCodeOrThis,
    taskSetId,
    tellMe,
    threadsWarning,
    tileOf,
    trackRecord,
    typer,
    unsureIds,
    view,
    zones,
  } = model;
  const objectsBody: ReactNode =
    running && progress ? (
      <RunningObjects progress={progress} objects={objects} />
    ) : nothing ? (
      <Zone title={t`Objects on ${slideLabel}`} data-phi="">
        {firstReadOpen ? (
          <FirstReadNotice taskId={session.taskId} slideId={session.slideId} />
        ) : (
          <p className="m-0 text-body-sm leading-[1.5] text-fg-dim">
            {noTask
              ? t`No review task asks about ${slideLabel}. Look at it here, and write what you find in the clinical report.`
              : setup.issue === "noresults"
                ? t`Nothing to decide here yet. ${slideLabel} has no ${setName} result in ${taskCodeOrThis}.`
                : t`${taskCodeOrThe} was withdrawn on 16 Oct. There is nothing left to decide.`}
          </p>
        )}
      </Zone>
    ) : (
      <>
        <ObjectsSummary
          slideLabel={slideLabel}
          counts={counts}
          added={added.map((item) => item.object)}
        />
        {findingsLayout === "cell-findings" ? (
          <FindingsPanel
            layout="cell-findings"
            image={lookUrl("hpf")}
            slide={{
              label: t`Cells on ${slideLabel}`,
              classes: numberLineOf(cells, decidedObject, classColor, (cell) =>
                unsureIds.has(cell.object),
              ),
            }}
            selection={findingsSelection(everyZone, openZoneId, selected)}
            onSelect={(next) => {
              if (next.kind === "cell") {
                if (next.zoneId !== null) setOpenZoneId(next.zoneId);
                pick(next.id);
              } else if (next.kind === "zone") {
                setOpenZoneId(next.id);
                if (current?.kind === "cell") pick(undefined);
              } else if (next.kind === "none") {
                setOpenZoneId(null);
              }
            }}
            zones={findingsZones(zones, decidedObject, classColor, tileOf)}
            changed={changedZone(changedCells, decidedObject, classColor, tileOf)}
            onUndoChanged={learner.undoAll}
            undoLabel={t`Undo all`}
            learner={
              learnerView.examples > 0
                ? {
                    title: t`Learned on this slide`,
                    summary: plural(learnerView.examples, {
                      one: "# example",
                      other: "# examples",
                    }),
                    forgetLabel: t`Forget`,
                    onForget: learner.forget,
                  }
                : undefined
            }
            scattered={scattered.map(tileOf)}
            cellCall={
              current?.kind === "cell"
                ? {
                    calls: [
                      { label: current.class_name.toLowerCase(), probability: current.score },
                    ],
                    typer: reviewTyper,
                    wording: "words",
                  }
                : undefined
            }
            galleryFoot={
              <ZoneFoot
                remaining={openZoneCells.length}
                disabledReason={buttonsOff}
                onNext={nextInZone}
                onRest={restLookRight}
              />
            }
            warnings={modelWarnings}
          />
        ) : findingsLayout === "node-staging" ? (
          <FindingsPanel
            layout="node-staging"
            areas={stagingPanelAreas(stagingAreas)}
            current={selected ?? null}
            onPickArea={areaNav.goTo}
            onCall={callArea}
            onMeasure={(id) => {
              measures.open(id);
              onSearch({ tool: "ruler", across: id, object: id });
            }}
            onCount={() => pick(firstOpenCell)}
            warnings={modelWarnings}
          />
        ) : (
          <ModelWarningsBlock warnings={modelWarnings} />
        )}
        <AiSays setName={setName} objects={objects} />
        <TrackRecordBlock
          enabled={personalSettings?.inspector_track_record ?? true}
          lines={trackRecordLines(trackRecord, typer?.name ?? "")}
        />
        <CalibrationBlock
          enabled={personalSettings?.inspector_calibration ?? true}
          lines={calibrationLines(typer)}
        />
        <ObjectList
          objects={objects}
          counts={counts}
          answer={answer}
          current={selected ?? undefined}
          onPick={pick}
          filter={filter}
          onFilterChange={setFilter}
          showScore={showScore}
          added={added.map((item) => ({
            object: item.object,
            size: addedSize(item.note),
            note: item.note,
          }))}
          onOpenCells={() => pick(firstOpenCell)}
          measurements={measures.measurements}
        />
      </>
    );
  const firstOpen = openRegions[0]?.object;
  const objectsFoot: ReactNode = running ? (
    <TellMeWhenReady on={tellMe} onChange={setTellMe} />
  ) : nothing ? undefined : measurement && selected === measurement.object ? (
    <MeasurementFoot
      {...measurement}
      onClose={() => onSearch({ object: "" })}
      onRemove={() => {
        const { across, line, object } = measurement;
        measures.remove(across);
        onSearch({ tool: undefined, across: undefined, object: undefined });
        setToast({
          id: Date.now(),
          text: `${object} removed`,
          undo: () => {
            measures.setLine(across, line);
            onSearch({ tool: "ruler", across, object });
          },
        });
      }}
    />
  ) : current ? (
    <ObjectFoot
      object={current}
      text={cardText(style, current, confidence)}
      style={style}
      classes={session.classes}
      answer={answer(current.object)}
      disabledReason={buttonsOff}
      author={person(session.meId)}
      note={note}
      saveOffReason={setup.connLost ? netOff : undefined}
      onNote={setNote}
      onSaveNote={saveNote}
      onAnswer={decide}
      onClose={() => pick(undefined)}
    />
  ) : addedCurrent ? (
    <AddedFoot
      object={addedCurrent.object}
      size={addedSize(addedCurrent.note)}
      note={addedCurrent.note}
      onClose={() => pick(undefined)}
    />
  ) : firstOpen ? (
    <Button variant="primary" className="w-full" onClick={() => pick(firstOpen)}>
      <Trans>Go to {firstOpen}, the first open object</Trans>
    </Button>
  ) : (
    <Button variant="primary" className="w-full" onClick={() => onSearch({ tab: "opinion" })}>
      <Trans>All decided. Open the Slide done card</Trans>
    </Button>
  );

  const resultSetRows = (
    <ViewerResultSets
      projectId={projectId}
      slideId={slideId}
      slideSets={slideSets}
      taskSetId={taskSetId}
      taskCode={session.display?.task_code}
      setsLock={setsLock}
      isShown={setIsShown}
      reviewedOn={reviewedOn}
      onToggle={choice.showSet}
      goView={goView}
    />
  );

  const mapsLock = session.display?.locks.find((lock) => lock.setting === "heatmap");
  const confidenceHidden = extraLocks.find(
    (lock) => lock.setting === "confidence" && lock.value === "hidden",
  );
  const pickableViews = layerViews.map((item) => {
    const lock =
      mapsLock && mapViews.has(item.value)
        ? mapsLock
        : confidenceHidden && item.value === "confidence"
          ? confidenceHidden
          : undefined;
    return lock ? { ...item, lockedReason: lock.reason } : item;
  });
  const viewZone = (
    <Zone
      title={t`View`}
      end={
        <span className="text-caption text-fg-dim">
          <Trans>Ways to show results</Trans>
        </span>
      }
    >
      <ViewPicker views={pickableViews} value={view} onValueChange={goView} />
    </Zone>
  );
  const thread = session.threads.find((item) => item.anchor === current?.object);
  const displayBody =
    view === "table" && current ? (
      <>
        <Zone title={t`${current.object} · Tumor region`} highlight>
          <TableObjectFacts
            object={current.object}
            score={showScore ? current.score : null}
            size={current.size_mm}
            sets={[setA, setB]}
            answer={answer(current.object)}
            fullId={pathOfObject(current.object)}
            comments={thread ? thread.replies + 1 : 0}
            onComments={() => onSearch({ tab: "comments" })}
          />
        </Zone>
        {viewZone}
      </>
    ) : (
      <DisplayTab
        display={display}
        preset={preset}
        extraLocks={extraLocks}
        viewer
        presetOpen={setup.presetOpen}
        changed={choice.changed}
        saveBlocked={choice.save.reason}
        onSave={choice.saveChanges}
        onPresetPick={choice.pick}
        overrides={choice.overrides}
        onSettingChange={choice.change}
        classVisibility={classVisibility}
        onSaveAs={() => onSearch({ modal: "preset" })}
        resultSets={resultSetRows}
        after={viewZone}
        idLabels={{ on: settings.ids, onChange: (on) => choice.change("ids", on) }}
      />
    );

  const decisionNotesOf = (object: string) => {
    const kept = answer(object);
    const others = othersOn(object);
    const own = kept && hasNote(kept) ? kept : undefined;
    if (!own && others.length === 0) return null;
    return (
      <>
        {own ? (
          <SavedNote
            answer={own}
            label={answerLabel(style, own, session.classes)}
            author={person(session.meId)}
            onEdit={() => {
              setNote({ open: true, reasons: own.reasons, text: own.note ?? "" });
              onSearch({ tab: "objects" });
            }}
          />
        ) : null}
        {others.map((item) => (
          <SavedNote
            key={item.author_id}
            answer={answerOfNote(item)}
            label={answerLabel(style, answerOfNote(item), session.classes)}
            author={person(item.author_id)}
          />
        ))}
      </>
    );
  };

  const commentsBody = shownPin ? (
    <PinnedThread
      key={`${shownPin.x},${shownPin.y}`}
      pin={shownPin}
      taskId={session.taskId}
      slideId={session.slideId}
      offReason={setup.connLost ? netOff : undefined}
      onCancel={leaveComment}
      onPosted={() => {
        setPin(null);
        setToast({ id: Date.now(), text: t`Thread pinned on the slide.` });
      }}
    />
  ) : selected ? (
    <ObjectComments
      taskId={session.taskId}
      slideId={session.slideId}
      object={selected}
      decisionNotes={decisionNotesOf(selected)}
      threads={session.threads}
      meId={session.meId}
      blind={session.task?.blinded ?? false}
      blindReviewers={[]}
      offReason={setup.connLost ? netOff : undefined}
    />
  ) : (
    <ThreadsTab
      taskId={session.taskId}
      slideId={session.slideId}
      slideLabel={slideLabel}
      hidden={nothing}
      onOpen={(anchor) => onSearch({ object: anchor, tab: "comments" })}
      onGoTo={(anchor) => onSearch({ object: anchor, tab: "objects" })}
    />
  );

  const opinionBody = (
    <SlideDoneCard
      panel
      className="min-h-full"
      slideNumber={session.neighbours?.position ?? 1}
      counts={{ ...counts, added: added.length }}
      questions={questions}
      blockers={doneBlockers}
      submitLabel={failed ? t`Try again` : t`Submit`}
      failed={failed}
      warning={threadsWarning}
      {...(readOnly ? { lockedReason: t`Signed off. Changes need an amendment.` } : {})}
      onSubmit={submit}
      onAnswerChange={changeOpinion}
    />
  );

  const creatorName = person(session.task?.created_by_user_id)?.name;
  const researcherName = creatorName?.split(" ")[0];
  const withdrawnBy = creatorName ?? t`The researcher`;
  const withdrawnTask = session.task?.code ?? t`the task`;
  const banner =
    setup.connLost || !online || readOnly || setup.sourceOff ? (
      <ViewerBanner
        setup={setup}
        online={online}
        readOnly={readOnly}
        researcherName={researcherName}
        slideLabel={slideLabel}
      />
    ) : null;

  const canvasNotice = setup.issue ? (
    <ViewerCanvasNotice
      setup={setup}
      slideLabel={slideLabel}
      setName={setName}
      taskCodeOrThe={taskCodeOrThe}
      withdrawnBy={withdrawnBy}
      withdrawnTask={withdrawnTask}
    />
  ) : null;

  const whole = stillView.kind === "whole";
  const tileHint = setup.tileHint ? <ViewerTileHint setup={setup} /> : null;

  const topBar = (
    <ReviewTop
      mode="full"
      object={selected ?? undefined}
      onWholeSlide={() => onSearch({ peek: true })}
      session={
        noTask
          ? {
              ...session,
              taskName: projectName,
              taskSub: session.caseLabel ? `Case ${session.caseLabel}` : projectCode,
              neighbours: undefined,
            }
          : session
      }
      counts={counts}
      nothingToDecide={running || nothing}
      {...(running ? { progressSub: t`The AI is still reading` } : {})}
      {...(clinical
        ? {
            primaryLabel: t`Open report`,
            primaryTitle: t`Open the clinical report of this case`,
            onSubmit: () =>
              reportCaseId !== undefined &&
              void navigate({
                to: "/projects/$projectId/cases/$caseId/report",
                params: { projectId, caseId: reportCaseId },
              }),
          }
        : {
            submitReason: nothing
              ? t`Nothing to decide on this slide`
              : counts.open
                ? t`${counts.open} object${counts.open === 1 ? " is" : "s are"} still open.`
                : undefined,
            onSubmit: () => onSearch({ tab: "opinion" }),
          })}
    />
  );

  const tabCounts = inspectorCounts({
    objects: running ? (progress?.found.length ?? 0) : counts.total,
    resultSets: slideSets.length + 1,
    threads: nothing ? [] : session.threads,
    questions: questions.map((question) => ({ answered: Boolean(question.answer) })),
  });
  useSelectionSync({
    tab: search.tab,
    object: search.object,
    ask: panelOnly,
    onRemote: (change) =>
      onSearch({ tab: change.tab as ViewerTab | undefined, object: change.object }),
  });
  const inspector = (
    <InspectorPanel
      width={340}
      value={tab}
      onValueChange={(next) => onSearch({ tab: next as ViewerTab })}
      template={template}
      parts={viewerParts}
      counts={tabCounts}
      bodies={{
        objects: { body: objectsBody, foot: objectsFoot },
        display: { body: displayBody },
        comments: { body: commentsBody },
        opinion: { body: opinionBody },
      }}
      staging={
        nothing
          ? undefined
          : {
              areas: stagingAreas,
              running,
              current: selected,
              visited: areaNav.visited,
              roleOf: running ? undefined : areaRole,
              onGoTo: areaNav.goTo,
              onStart: areaNav.goTo,
              onSubmit: () => onSearch({ tab: "opinion" }),
              scan: noTumor ? scanSummary(overviewTissue, scan) : null,
              onScan: scanStep,
            }
      }
    />
  );
  return { banner, canvasNotice, whole, tileHint, topBar, tabCounts, inspector };
}
