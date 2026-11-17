import { Trans, useLingui } from "@lingui/react/macro";
import { useGetMyHome, useGetProject, useGetSlideAiProgress } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { CellCluster, CellsLauncher } from "@parfocal/ui/components/cells-panel";
import { Icon } from "@parfocal/ui/components/icon";
import { Loader } from "@parfocal/ui/components/loader";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { UndoToast } from "@parfocal/ui/components/undo-toast";
import { inspectorTabLabels } from "@parfocal/ui/lib/inspector-tabs";
import { okData } from "../placeholder.tsx";
import { CellsGrid } from "../review/cells-grid.tsx";
import { pinForClick } from "../review/comment-pin.ts";
import { answersOf, rawFor, showsClaim } from "../review/decision-style.ts";
import { PagedProbeMarker } from "../review/paged-probe.tsx";
import { PinMark } from "../review/pinned-thread.tsx";
import { useReviewSession } from "../review/review-data.ts";
import { shownReviewTool } from "../review/review-rail.ts";
import { countAnswers } from "../review/review-state.ts";
import { SlidePicture } from "../review/slide-picture.tsx";
import { magnificationOf, SlideStill } from "../review/slide-still.tsx";
import { chosenType } from "../review/type-bar.ts";
import { cellCentre, TypeBar } from "../review/type-bar.tsx";
import { ViewerFrame } from "../review/viewer-frame.tsx";
import { MeasureCanvas } from "../viewer-tools/measure-canvas.tsx";
import { MeasuredBlock } from "../viewer-tools/measured-block.tsx";
import { NavigatorCanvas, OverviewCanvas } from "../viewer-tools/navigator-canvas.tsx";
import { peekSpot } from "../viewer-tools/peek-model.ts";
import { reviewRail, reviewRailKeys } from "../viewer-tools/rails.ts";
import { SlidePeek } from "../viewer-tools/slide-peek.tsx";
import { ViewerMinimap } from "../viewer-tools/viewer-minimap.tsx";
import { confidenceTintOf } from "./object-draw.ts";
import { ObjectTablePanel } from "./object-table.tsx";
import { tableColumns, tableCsv } from "./object-table-rows.ts";
import { ReviewLearnerEmbeddings } from "./review-learner-embeddings.tsx";
import { SavePresetModal } from "./save-preset-modal.tsx";
import { useViewerModel } from "./use-viewer-model.ts";
import { RunningHeat, readReach } from "./viewer-canvas-parts.tsx";
import type { BodyProps, FullViewerProps } from "./viewer-model-types.ts";
import type { ViewerTab } from "./viewer-scenes.ts";

export type { ViewerSearch } from "./viewer-model-types.ts";

function SlideLoader() {
  const { t } = useLingui();
  return <Loader label={t`Loading the slide`} size="page" />;
}

export function FullViewer(props: FullViewerProps) {
  const home = okData(useGetMyHome().data);
  const taskId = props.search.task ?? home?.resume?.task_id;
  if (taskId === undefined) return <SlideLoader />;
  return (
    <SlidePicture slideId={props.slideId}>
      <ViewerWithTask {...props} taskId={taskId} />
    </SlidePicture>
  );
}

function ViewerWithTask(props: FullViewerProps & { taskId: string }) {
  const session = useReviewSession(props.taskId, props.slideId);
  const project = okData(useGetProject(props.projectId).data);
  const progress = useGetSlideAiProgress(props.slideId);
  if (!session.ready || project === undefined || progress.isPending) return <SlideLoader />;
  return (
    <ReviewLearnerEmbeddings slideId={props.slideId}>
      <ViewerBody
        key={`${props.search.scene ?? "objects"}-${props.slideId}`}
        {...props}
        session={session}
        clinical={project.privacy_mode === "clinical"}
        projectCode={project.code}
        projectName={project.name}
        viewerParts={project.viewer_parts}
        template={project.template}
      />
    </ReviewLearnerEmbeddings>
  );
}

function downloadCsv(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function ViewerBody(props: BodyProps) {
  const { t } = useLingui();
  const { onSearch, panelOnly = false, search, session } = props;
  const {
    answer,
    areaNav,
    areas,
    backdrop,
    banner,
    buttonsOff,
    camera,
    canvasNotice,
    cellDecisions,
    cells,
    cellsFolded,
    cellsOpen,
    cellsRect,
    choice,
    closePeek,
    confidence,
    confirmRest,
    counts,
    current,
    decideType,
    decidedRegions,
    drawing,
    firstOpenCell,
    inspector,
    measurement,
    measures,
    minimapSetting,
    navigator,
    notNucleus,
    nothing,
    objectTableRows,
    onCell,
    openCells,
    openZoneCells,
    overrides,
    paged,
    pathOfObject,
    peekHeld,
    peekOpen,
    pick,
    pickTool,
    plainObjects,
    preset,
    progress,
    ranked,
    regionDecisions,
    regions,
    running,
    scene,
    selected,
    setCamera,
    setCellsFolded,
    setCellsOpen,
    setCellsRect,
    setConfirmRest,
    setOverrides,
    setPin,
    setToast,
    settings,
    setup,
    showScore,
    shownCamera,
    shownPin,
    slideLabel,
    stats,
    still,
    stillCamera,
    stillView,
    style,
    styleOfObject,
    tab,
    tabCounts,
    tileHint,
    toast,
    topBar,
    view,
    whole,
  } = useViewerModel(props);
  if (panelOnly) {
    return (
      <main className="flex h-screen min-h-0 bg-bg [&>aside]:w-full!" data-testid="popout-panel">
        {inspector}
      </main>
    );
  }

  return (
    <>
      <ViewerFrame
        session={session}
        counts={counts}
        tool={shownReviewTool(search.tool, running || nothing)}
        railGroups={reviewRail}
        railKeys={reviewRailKeys}
        panel={inspector}
        panelTab={{ label: inspectorTabLabels[tab], count: tabCounts[tab] }}
        onToolChange={pickTool}
        onCompare={() => onSearch({ scene: "picking", object: undefined, tool: undefined })}
        overlay={
          peekOpen ? (
            <SlidePeek
              slideName={session.slideName}
              areas={areas}
              checked={regions
                .filter((region) => answer(region.object))
                .map((region) => region.object)}
              atCell={navigator === "cells" || navigator === "focus" || current?.kind === "cell"}
              held={peekHeld}
              onClose={closePeek}
              onPick={(point) => {
                if (!areaNav.jump(peekSpot(point))) closePeek();
              }}
            />
          ) : null
        }
        tab={tab}
        onTabChange={(next) => onSearch({ tab: next as ViewerTab })}
        topBar={topBar}
        scene={scene ?? "objects"}
        banner={banner}
        below={
          view === "table" ? (
            <ObjectTablePanel
              slideLabel={slideLabel}
              pathOf={pathOfObject}
              rows={objectTableRows}
              stats={stats}
              classColour={(name) =>
                session.classes.find((item) => item.name === name)?.color ?? "var(--fg-faint)"
              }
              showScore={showScore}
              presetUsed={preset !== null}
              cutoff={settings.cutoff}
              selected={selected}
              onPick={(object) => onSearch({ object })}
              onCsv={() => {
                downloadCsv(
                  tableCsv(
                    objectTableRows,
                    tableColumns({ showScore, presetUsed: preset !== null }),
                    pathOfObject,
                  ),
                  `objects-${slideLabel}.csv`,
                );
                setToast({ id: Date.now(), text: t`Downloaded the table as CSV with full IDs` });
              }}
            />
          ) : null
        }
      >
        {navigator === "overview" ? (
          <OverviewCanvas areas={areas} checked={["T1"]} />
        ) : navigator ? (
          <NavigatorCanvas
            scene={navigator}
            areas={ranked}
            decided={decidedRegions}
            current="T2"
            onPeek={() => onSearch({ peek: true })}
            onTravel={() => onSearch({ scene: "travel" })}
            onGoTo={(object) => onSearch({ scene: "objects", object })}
            onPopOut={() =>
              setToast({ id: Date.now(), text: t`Opens the whole slide on the second monitor` })
            }
          />
        ) : measurement ? (
          <MeasureCanvas
            across={measurement.across}
            mm={measurement.mm}
            line={measurement.line}
            outline={measurement.outline}
            outlines={still.outlines}
            outlineFrame={still.frame}
            onLine={(line) => measures.setLine(measurement.across, line)}
          />
        ) : (
          <div className="flex min-h-0 flex-1">
            <SlideStill
              className={drawing.second ? "basis-0 border-r border-black" : ""}
              view={stillView}
              camera={shownCamera}
              onCameraChange={setCamera}
              backdrop={backdrop}
              engineDrawn={plainObjects && showsClaim(style) ? still.ids : undefined}
              outlines={still.outlines}
              outlineFrame={still.frame}
              regionDecisions={regionDecisions}
              cellDecisions={cellDecisions}
              ringedCells={
                confirmRest
                  ? openCells.map((cell) => cell.object)
                  : openZoneCells.map((cell) => cell.object)
              }
              claimHidden={!showsClaim(style)}
              drawAs={settings.draw}
              showIds={settings.ids}
              failed={setup.issue === "slidefail"}
              bare={nothing || running}
              minimap={false}
              hint={false}
              tiles={setup.tiles}
              slideName={session.slideName}
              regionStyle={(object) => drawing.regionStyle(object) ?? styleOfObject(object)}
              cellStyle={
                paged ? (object) => paged.styleOf(object, styleOfObject(object)) : styleOfObject
              }
              currentTint={
                confidence === "color" && current ? confidenceTintOf(current.score) : undefined
              }
              tags={running || nothing ? [] : drawing.tags}
              underlay={
                running ? () => <RunningHeat reached={readReach(progress)} /> : drawing.underlay
              }
              onCellPick={search.tool === undefined ? pick : undefined}
              onPointPick={(point) => {
                const placed = pinForClick(search.tool, point);
                if (placed === null) return;
                setPin(placed);
                onSearch({ object: undefined, tab: "comments" });
              }}
              overlay={(still) => {
                stillCamera.current = still.camera;
                return (
                  <>
                    {paged ? <PagedProbeMarker probe={paged.probe} /> : null}
                    {canvasNotice}
                    {onCell && tab === "objects" && current && !running ? (
                      <TypeBar
                        object={current.object}
                        centre={cellCentre(current.object, still.camera, still.size)}
                        scale={still.camera.scale}
                        size={still.size}
                        chosen={chosenType(style, current, session.classes, answer(current.object))}
                        disabledReason={buttonsOff}
                        onChoose={(option) => decideType(option.id)}
                      />
                    ) : null}
                    {shownPin ? (
                      <PinMark pin={shownPin} camera={still.camera} size={still.size} />
                    ) : null}
                    {drawing.legend ? (
                      <div className="absolute top-4 left-4">{drawing.legend}</div>
                    ) : null}
                    {drawing.extra}
                    {nothing || running || setup.issue === "slidefail" ? null : (
                      <ViewerMinimap
                        setting={minimapSetting}
                        view={stillView}
                        camera={still.camera}
                        size={still.size}
                        areas={areas}
                        checked={regions
                          .filter((region) => answer(region.object))
                          .map((region) => region.object)}
                        blockLeft={!whole}
                        blockToast={toast !== null}
                        cells={cells.map((cell) => ({
                          object: cell.object,
                          decided: answer(cell.object) !== undefined,
                        }))}
                        pins={shownPin ? [shownPin] : []}
                        cellsPanel={cellsRect}
                        onMoveView={setCamera}
                        onOpen={() => onSearch({ peek: true })}
                        onPopOut={() =>
                          setToast({
                            id: Date.now(),
                            text: t`Opens the whole slide on the second monitor`,
                          })
                        }
                      />
                    )}
                    {whole && cells.length && !running && view === "panel" ? (
                      <CellCluster
                        className="absolute top-[50%] left-[54%]"
                        split={countAnswers(cells, answer)}
                        onClick={() => pick(firstOpenCell)}
                      />
                    ) : null}
                    {current?.kind === "cell" ? (
                      cellsOpen ? (
                        <MeasuredBlock
                          className="absolute bottom-18 left-1/2 w-fit -translate-x-1/2"
                          onRect={setCellsRect}
                        >
                          <CellsGrid
                            cells={cells}
                            current={current.object}
                            answer={answer}
                            answerKeys={answersOf(style, session.classes, current).map(
                              (item) => item.key,
                            )}
                            claimHidden={!showsClaim(style)}
                            folded={cellsFolded}
                            confirming={confirmRest}
                            onPick={(object) => pick(object)}
                            onNotNucleus={buttonsOff ? undefined : notNucleus}
                            onAgreeRest={() => setConfirmRest(true)}
                            onCancelRest={() => setConfirmRest(false)}
                            onApplyRest={() => {
                              const next = new Map(overrides);
                              for (const cell of openCells) {
                                next.set(cell.object, {
                                  value: "agree",
                                  raw: rawFor(style, "agree", cell),
                                  reasons: [],
                                  note: null,
                                });
                              }
                              setOverrides(next);
                              setConfirmRest(false);
                              setToast({
                                id: Date.now(),
                                text: t`${openCells.length} cells marked agree`,
                                undo: () => setOverrides(overrides),
                              });
                            }}
                            onFoldChange={setCellsFolded}
                            onClose={() => setCellsOpen(false)}
                          />
                        </MeasuredBlock>
                      ) : (
                        <MeasuredBlock
                          className="absolute bottom-18 left-1/2 -translate-x-1/2"
                          onRect={setCellsRect}
                        >
                          <CellsLauncher
                            decided={cells.length - openCells.length}
                            total={cells.length}
                            onClick={() => setCellsOpen(true)}
                          />
                        </MeasuredBlock>
                      )
                    ) : null}
                    {whole ? null : (
                      <Button
                        size="lg"
                        className="absolute bottom-4 left-4"
                        onClick={() => pick(undefined)}
                      >
                        <Icon name="expand" />
                        <Trans>Whole slide</Trans>
                      </Button>
                    )}
                    <div className="absolute bottom-4 left-1/2 grid -translate-x-1/2 justify-items-center gap-2">
                      {tileHint}
                      <MagnificationBar
                        magnification={
                          camera
                            ? magnificationOf(stillView, camera)
                            : stillView.kind === "cell"
                              ? 40
                              : whole
                                ? 1.25
                                : 2.5
                        }
                        scaleLabel={stillView.kind === "cell" ? "10 µm" : whole ? "5 mm" : "500 µm"}
                        scalePx={92}
                        micronsPerPixel={stillView.kind === "cell" ? 0.11 : whole ? 33.87 : 4.43}
                      />
                    </div>
                    {toast ? (
                      <div className="absolute right-4 bottom-4">
                        <UndoToast
                          key={toast.id}
                          message={toast.text}
                          {...(toast.undo ? { onUndo: toast.undo } : {})}
                          onExpire={() => setToast(null)}
                        />
                      </div>
                    ) : null}
                  </>
                );
              }}
            />
            {drawing.second ? (
              <SlideStill
                className="basis-0"
                view={stillView}
                camera={shownCamera}
                onCameraChange={setCamera}
                regionDecisions={regionDecisions}
                claimHidden={!showsClaim(style)}
                drawAs={settings.draw}
                showIds={settings.ids}
                minimap={false}
                hint={false}
                tiles={setup.tiles}
                slideName={session.slideName}
                regionStyle={drawing.second.regionStyle}
                tags={drawing.second.tags}
                underlay={drawing.underlay}
                overlay={() => drawing.second?.extra}
              />
            ) : null}
          </div>
        )}
      </ViewerFrame>
      <SavePresetModal
        open={search.modal === "preset"}
        slideLabel={slideLabel}
        taskCode={session.task?.code ?? "this task"}
        taken={(session.display?.presets ?? []).map((item) => item.name)}
        onClose={() => onSearch({ modal: undefined })}
        onSave={async (name, scope) => {
          const result = await choice.saveAs(name, scope);
          if (result.status === "saved") {
            onSearch({ modal: undefined });
            setToast({
              id: Date.now(),
              text: t`Preset ${name} saved.`,
              ...(result.undo ? { undo: result.undo } : {}),
            });
          }
          return result.status;
        }}
      />
    </>
  );
}
