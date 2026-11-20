import { useLingui } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import type { DisplaySettings } from "@parfocal/ui/components/display-panel";
import { useEffect, useMemo, useRef, useState } from "react";
import { polygonToGeoJson } from "../annotations/geojson.ts";
import { closeDraft, type PolygonDraft } from "../annotations/polygon-draft.ts";
import { useAnswerKeys } from "../screens/review/answer-keys.ts";
import { rawFor } from "../screens/review/decision-mapping.ts";
import { answersOf } from "../screens/review/decision-style.ts";
import { disagreeOptions, reasonDraft } from "../screens/review/disagree-reasons.ts";
import { drawChoicesOf, myDisplaySettings } from "../screens/review/display-tab.tsx";
import { coachShown, useGuidedCoach } from "../screens/review/guided-coach.ts";
import { useNoteKey } from "../screens/review/note-key.ts";
import { useObjectKeys } from "../screens/review/object-keys.ts";
import { type ReviewSession, useReviewSession } from "../screens/review/review-data.ts";
import { pendingOrder } from "../screens/review/review-order-state.ts";
import { ReviewOrderTabNotice } from "../screens/review/review-order-state.tsx";
import { answerFromDecision } from "../screens/review/review-state.ts";
import {
  storedType,
  type TypeOption,
  typeAnswers,
  typeChoice,
  typeOptions,
} from "../screens/review/type-bar.ts";
import { useDecisionSaves } from "../screens/review/use-decision-saves.ts";
import { personalPanelValues, useDisplayDefaults } from "../shell/display-defaults.ts";
import { useLabDecisionCutoff } from "../shell/resolved-settings.ts";
import { showUndoToast } from "../shell/undo-toasts.tsx";
import {
  type CalmCamera,
  type CalmStep,
  calmStep,
  landingCamera,
  landingPower,
  stageCalmView,
} from "./calm-camera.ts";
import { DockCard } from "./inspector-slots.tsx";
import type { ViewerModule } from "./magnification-control.tsx";
import { StageAiReading } from "./stage-ai-reading.tsx";
import { StageCellTypeBar } from "./stage-cell-type-bar.tsx";
import { StageCellsGrid } from "./stage-cells-grid.tsx";
import { StageCoachAnswerTip, StageCoachOnSlide, StageCoachStepTip } from "./stage-coach.tsx";
import { StageFocusCard } from "./stage-focus.tsx";
import {
  cellsInTissueOrder,
  nextOpenObject,
  outlineArea,
  outlineCentre,
  placedObjects,
} from "./stage-geometry.ts";
import { type GuidedFix, StageGuidedCard } from "./stage-guided-card.tsx";
import { StageGuidedView } from "./stage-guided-view.tsx";
import { useStageRulers } from "./stage-measurements.tsx";
import { StageObjectsPanel } from "./stage-objects-panel.tsx";
import { ReviewOpinion } from "./stage-opinion.tsx";
import { StageRedrawLayer } from "./stage-redraw-layer.tsx";
import { type ReviewFix, ringOfFix, useReviewFixes } from "./stage-review-fixes.ts";
import { StageSlideMarks, sampleOf, useSampleCollapsed } from "./stage-slide-marks.tsx";
import { StageTypePicker } from "./stage-type-picker.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";

const overlayId = "review-objects";

const dimmedShare = 0.35;

const decisionNames = new Set(["agree", "disagree", "unsure"]);

function decisionNameOf(value: string | undefined) {
  return value !== undefined && decisionNames.has(value)
    ? (value as "agree" | "disagree" | "unsure")
    : null;
}

type Placed = ReturnType<typeof placedObjects>;

function useDrawing(
  engine: ViewerEngine,
  module: ViewerModule,
  id: string,
  kind: "nuclei" | "human-annotations",
  objects: Placed,
  choices: ReturnType<typeof drawChoicesOf>,
  current: string | null,
) {
  const drawing = useMemo(
    () => module.createObjectDrawing({ id, host: engine, kind }),
    [module, engine, id, kind],
  );
  useEffect(() => () => drawing.clear(), [drawing]);
  useEffect(() => {
    drawing.setObjects(objects);
  }, [drawing, objects]);
  useEffect(() => {
    drawing.setChoices(choices);
  }, [drawing, choices]);
  useEffect(() => {
    drawing.setCurrent(current);
  }, [drawing, current]);
}

function withDecisions(shown: Placed, decisionKey: string): Placed {
  if (decisionKey === "") return shown;
  const decided = new Map(JSON.parse(decisionKey) as [string, string][]);
  return shown.map((item) => ({ ...item, decision: decisionNameOf(decided.get(item.id)) }));
}

function reviewedObjects(
  objects: readonly ReviewObject[],
  fixed: ReadonlyMap<string, ReviewFix>,
  classes: readonly { id: string; name: string }[],
): ReviewObject[] {
  return objects.flatMap((item) => {
    const fix = fixed.get(item.object);
    if (fix === undefined || fix.deleted) return [];
    const name = classes.find((entry) => entry.id === fix.classId)?.name;
    return [
      {
        ...item,
        outline: ringOfFix(fix) ?? item.outline ?? null,
        class_name: name ?? item.class_name,
      },
    ];
  });
}

function ObjectOutlines({
  engine,
  module,
  objects,
  classes,
  current,
  collapsed,
  decisions,
  settings,
  fixed,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  objects: readonly ReviewObject[];
  classes: ReviewSession["classes"];
  current: string | null;
  collapsed: boolean;
  decisions: ReviewSession["decisions"];
  settings: DisplaySettings;
  fixed: ReadonlyMap<string, ReviewFix>;
}) {
  const defaults = useDisplayDefaults();
  const classKey = JSON.stringify(classes.map((item) => [item.id, item.name, item.color]));
  const projectClasses = useMemo(
    () =>
      (JSON.parse(classKey) as [string, string, string][]).map(([id, name, colour]) => ({
        id,
        name,
        colour,
      })),
    [classKey],
  );
  const decisionKey =
    settings.colorBy === "decision"
      ? JSON.stringify([...decisions].map(([id, decision]) => [id, decision.value]))
      : "";
  const shownObjects = useMemo(
    () => (collapsed ? objects.filter((item) => item.kind !== "cell") : objects),
    [collapsed, objects],
  );
  const placed = useMemo(
    () =>
      withDecisions(
        placedObjects(shownObjects, projectClasses, defaults.classPalette),
        decisionKey,
      ),
    [shownObjects, projectClasses, decisionKey, defaults.classPalette],
  );
  const reviewed = useMemo(
    () =>
      withDecisions(
        placedObjects(
          reviewedObjects(shownObjects, fixed, projectClasses),
          projectClasses,
          defaults.classPalette,
        ),
        decisionKey,
      ),
    [shownObjects, fixed, projectClasses, decisionKey, defaults.classPalette],
  );
  const kept = useMemo(() => placed.filter((item) => !fixed.has(item.id)), [placed, fixed]);
  const dimmed = useMemo(() => placed.filter((item) => fixed.has(item.id)), [placed, fixed]);
  const choices = useMemo(() => drawChoicesOf(settings), [settings]);
  const dimmedChoices = useMemo(
    () => ({ ...choices, opacity: Math.round((choices.opacity ?? 100) * dimmedShare) }),
    [choices],
  );
  const currentReviewed = current !== null && reviewed.some((item) => item.id === current);
  useDrawing(engine, module, overlayId, "nuclei", kept, choices, currentReviewed ? null : current);
  useDrawing(engine, module, `${overlayId}-ai-dimmed`, "nuclei", dimmed, dimmedChoices, null);
  useDrawing(
    engine,
    module,
    `${overlayId}-reviewed`,
    "human-annotations",
    reviewed,
    choices,
    currentReviewed ? current : null,
  );
  return (
    <div
      hidden
      data-testid="review-object-outlines"
      data-objects={placed.length}
      data-dimmed={dimmed.map((item) => item.id).join(" ")}
      data-reviewed={reviewed.map((item) => item.id).join(" ")}
      data-draw={choices.draw}
      data-width={choices.width}
      data-opacity={choices.opacity}
      data-color-by={choices.colorBy}
      data-cutoff={choices.cutoff}
    />
  );
}

export function StageReviewObjects({
  engine,
  module,
  stage = null,
  taskId,
  slideId,
  object,
  guided = false,
  cellsGrid = false,
  jumpRequest = null,
  focus = null,
  doneRequest = 0,
  onComments,
  onNote,
  onCurrent,
  onAddMissed,
  answersOff,
  readOnly = false,
  opinionLocked,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  stage?: HTMLElement | null;
  taskId: string;
  slideId: string;
  object: string | undefined;
  guided?: boolean;
  cellsGrid?: boolean;
  jumpRequest?: { readonly id: string; readonly count: number } | null;
  focus?: { onShowUi: () => void } | null;
  doneRequest?: number;
  onComments: (object: string) => void;
  onNote?: (object: string) => void;
  onCurrent?: (object: string | null) => void;
  onAddMissed?: () => void;
  answersOff?: string | undefined;
  readOnly?: boolean;
  opinionLocked?: string | undefined;
}) {
  const { t } = useLingui();
  const session = useReviewSession(taskId, slideId);
  const labCutoff = useLabDecisionCutoff();
  const defaults = useDisplayDefaults();
  const settings = useMemo(
    () => myDisplaySettings(session.myDisplay, labCutoff, personalPanelValues(defaults)),
    [session.myDisplay, labCutoff, defaults],
  );
  const saves = useDecisionSaves(session, session.style);
  const fixes = useReviewFixes(taskId, slideId, session.ready);
  const [fixing, setFixing] = useState<{
    readonly object: string;
    readonly step: "reasons" | "redraw" | "type";
  } | null>(null);
  const [draft, setDraft] = useState<PolygonDraft>([]);
  const objects = session.objects;
  const order = objects.map((item) => item.object);
  const decided = new Set(session.decisions.keys());
  const [chosen, setCurrent] = useState<string | null>(object ?? null);
  const [gridOpen, setGridOpen] = useState(cellsGrid);
  const [done, setDone] = useState(false);
  const [seenRequest, setSeenRequest] = useState(doneRequest);
  if (doneRequest !== seenRequest) {
    setSeenRequest(doneRequest);
    if (guided) setDone(true);
  }
  const hasCells = objects.some((item) => item.kind === "cell");
  const current =
    chosen ??
    (guided || focus !== null ? (nextOpenObject(order, decided, null) ?? order[0] ?? null) : null);
  const canFix = guided && focus === null && !readOnly && answersOff === undefined;
  const fixStep = canFix && fixing !== null && fixing.object === current ? fixing.step : null;
  useNoteKey(() => {
    if (current !== null && decided.has(current)) onNote?.(current);
  });
  const measurements = useStageRulers(!guided);
  const rulers = measurements?.rulers ?? [];
  const flyTo = (id: string | null) => {
    const area = outlineArea(
      objects.find((item) => item.object === id)?.outline ??
        rulers.find((item) => item.label === id)?.points,
    );
    if (area !== null) void engine.flyToArea(area);
  };
  const pick = (id: string | null) => {
    if (id === null) return;
    setDone(false);
    setCurrent(id);
    flyTo(id);
  };
  const focusedObject = useRef<string | null>(null);
  useEffect(() => {
    if (object === undefined || focusedObject.current === object) return;
    if (!objects.some((item) => item.object === object)) return;
    focusedObject.current = object;
    setDone(false);
    setCurrent(object);
    const area = outlineArea(objects.find((item) => item.object === object)?.outline);
    if (area !== null) void engine.flyToArea(area);
  }, [object, objects, engine]);
  const stepGoal = useRef<CalmCamera | null>(null);
  const stepTo = (id: string) => {
    const cell = outlineCentre(objects.find((item) => item.object === id)?.outline);
    const view = stageCalmView();
    const flying = engine.getMotion() === "flying";
    const from = flying ? stepGoal.current : engine.getCamera();
    const move: CalmStep =
      cell === null || view === null || from === null
        ? { kind: "fly" }
        : calmStep(from, view, { x: cell.x, y: cell.y, size: cell.radius * 2 });
    setDone(false);
    setCurrent(id);
    if (move.kind === "stay") return;
    if (move.kind === "fly") return landOnCell(id);
    stepGoal.current = move.camera;
    void engine.flyTo(move.camera);
  };
  const landOnCell = (id: string) => {
    const cell = outlineCentre(objects.find((item) => item.object === id)?.outline);
    const spacing = engine.getSlide()?.micronsPerPixel ?? null;
    const power = landingPower(
      module.scanObjective(spacing) ?? module.effectiveMagnification(0, spacing),
    );
    if (cell === null || spacing === null || power === null) {
      stepGoal.current = null;
      flyTo(id);
      return;
    }
    const zoom = module.zoomForMagnification(spacing, power);
    const goal = landingCamera(stageCalmView(), cell, zoom);
    stepGoal.current = goal;
    void engine.flyTo(goal);
  };
  const pickInStrip = (id: string) => {
    setDone(false);
    setCurrent(id);
    landOnCell(id);
  };
  const ready = session.ready && objects.length > 0;
  const orderWait = pendingOrder(session.order, session.ready);
  const coach = useGuidedCoach(guided && object === undefined);
  const coachOn =
    guided && coachShown(coach.open, ready ? objects.length : 0, answersOff === undefined);
  const opening = useRef(true);
  const reported = useRef(onCurrent);
  reported.current = onCurrent;
  useEffect(() => {
    if (!ready || !opening.current) return;
    opening.current = false;
    const area = outlineArea(objects.find((item) => item.object === current)?.outline);
    if (area !== null) void engine.flyToArea(area);
  }, [ready, objects, engine, current]);
  useEffect(() => {
    if (ready) reported.current?.(current);
  }, [ready, current]);
  const advance = (answered: string) => {
    const next = nextOpenObject(order, new Set([...decided, answered]), answered);
    if (next === null) setDone(true);
    else pick(next);
  };
  const answer = (item: ReviewObject, raw: string) => {
    if (answersOff !== undefined) return;
    const option = answersOf(session.style, session.classes, item).find(
      (entry) => entry.raw === raw,
    );
    const value = option?.countsAs;
    if (value === undefined) return;
    saves.save(item.object, raw, value);
    if (canFix && session.style.kind !== "blind" && value === "disagree") {
      setCurrent(item.object);
      setFixing({ object: item.object, step: "reasons" });
      return;
    }
    if (guided) advance(item.object);
    else setCurrent(item.object);
  };
  const currentItem = objects.find((item) => item.object === current);
  const currentOutline = currentItem?.outline;
  const currentArea = useMemo(() => outlineArea(currentOutline), [currentOutline]);
  const typedCell =
    currentItem?.kind === "cell" && outlineArea(currentItem.outline) !== null ? currentItem : null;
  const decideType = (cell: ReviewObject, id: string) => {
    if (answersOff !== undefined) return;
    const option = typeOptions.find((item) => item.id === id);
    if (option === undefined) {
      if (id === "unsure") saves.save(cell.object, rawFor(session.style, "unsure", cell), "unsure");
    } else {
      const choice = typeChoice(session.style, option, cell, session.classes);
      saves.save(cell.object, choice.raw, choice.value, choice.draft);
    }
    if (guided) advance(cell.object);
  };
  const stepToOpenCell = (answered: ReviewObject) => {
    if (guided || !gridOpen || answersOff !== undefined || answered.kind !== "cell") return;
    const cellOrder = cellsInTissueOrder(objects).map((item) => item.object);
    const next = nextOpenObject(cellOrder, new Set([...decided, answered.object]), answered.object);
    if (next !== null) stepTo(next);
  };
  useAnswerKeys(
    typeAnswers,
    (raw) => {
      if (typedCell === null) return;
      decideType(typedCell, raw);
      stepToOpenCell(typedCell);
    },
    ready && typedCell !== null && fixStep === null,
  );
  const listKeysLive =
    ready && !guided && focus === null && currentItem !== undefined && typedCell === null;
  useAnswerKeys(
    answersOf(session.style, session.classes, currentItem),
    (raw) => {
      if (currentItem === undefined) return;
      answer(currentItem, raw);
      stepToOpenCell(currentItem);
    },
    listKeysLive,
  );
  const sample = useMemo(() => sampleOf(objects), [objects]);
  const collapsed = useSampleCollapsed(engine, sample);
  const wholeSlide = () => {
    setCurrent(null);
    void engine.flyToFit();
  };
  const index = current === null ? -1 : order.indexOf(current);
  const stepping = guided && ready && !done && focus === null && fixStep === null;
  useAnswerKeys(
    answersOf(session.style, session.classes, currentItem),
    (raw) => {
      if (currentItem !== undefined) answer(currentItem, raw);
    },
    stepping && typedCell === null && currentItem !== undefined,
  );
  useObjectKeys(
    () => pick(order[index + 1] ?? null),
    () => pick(order[index - 1] ?? null),
    stepping,
  );
  const jump = (id: string) =>
    pick(
      id === "cells"
        ? (objects.find((item) => item.kind === "cell" && !decided.has(item.object))?.object ??
            objects.find((item) => item.kind === "cell")?.object ??
            null)
        : id,
    );
  const [seenJump, setSeenJump] = useState(jumpRequest?.count ?? 0);
  if (jumpRequest !== null && jumpRequest.count !== seenJump) {
    setSeenJump(jumpRequest.count);
    if (jumpRequest.id === "cells") setGridOpen(true);
    jump(jumpRequest.id);
  }
  const toggleReason = (item: ReviewObject, reason: string) => {
    const decision = session.decisions.get(item.object);
    if (decision === undefined) return;
    const kept = answerFromDecision(decision, session.style, item, session.classes);
    const reasons = kept.reasons.includes(reason)
      ? kept.reasons.filter((entry) => entry !== reason)
      : [...kept.reasons, reason];
    saves.save(
      item.object,
      kept.raw,
      kept.value,
      reasonDraft(reasons, disagreeOptions(item.kind, item.class_name, session.classes)),
      kept.note,
    );
  };
  const saveFix = (item: ReviewObject, change: Partial<ReviewFix>, message: string) => {
    const before = fixes.change(item.object, change);
    setFixing({ object: item.object, step: "reasons" });
    showUndoToast({
      message,
      undo: () => fixes.restore(item.object, before),
    });
  };
  const finishRedraw = (item: ReviewObject, points: Float32Array | null) => {
    const closed = points === null ? closeDraft(draft) : { kind: "closed" as const, points };
    if (closed.kind !== "closed") return;
    setDraft([]);
    saveFix(
      item,
      { geometry: polygonToGeoJson(closed.points) },
      t`New outline saved for ${item.object}. The AI result is not changed.`,
    );
  };
  const cancelRedraw = (item: ReviewObject) => {
    setDraft([]);
    setFixing({ object: item.object, step: "reasons" });
  };
  const fixFor = (item: ReviewObject): GuidedFix => ({
    open: fixStep !== null,
    redrawPoints: fixStep === "redraw" ? draft.length : null,
    typePicker:
      fixStep === "type" ? (
        <StageTypePicker
          object={item}
          classes={session.classes}
          chosen={fixes.fixOf(item.object)?.classId ?? null}
          onPick={(classId) => {
            const name = session.classes.find((entry) => entry.id === classId)?.name ?? "";
            saveFix(
              item,
              { classId },
              t`${item.object} saved as ${name}. The AI result is not changed.`,
            );
          }}
          onCancel={() => setFixing({ object: item.object, step: "reasons" })}
        />
      ) : null,
    onReason: (reason) => toggleReason(item, reason),
    onBack: () => setFixing(null),
    onFix: (what) => {
      setDraft([]);
      setFixing({ object: item.object, step: what === "outline" ? "redraw" : "type" });
    },
    onFinishRedraw: () => finishRedraw(item, null),
    onCancelRedraw: () => cancelRedraw(item),
  });
  const coachPart = coachOn ? (
    <StageCoachAnswerTip
      keys={answersOf(session.style, session.classes, currentItem).map((item) => item.key)}
    />
  ) : answersOff === undefined ? (
    <Button variant="ghost" size="sm" className="w-fit px-0" onClick={coach.reopen}>
      {t`How guided review works`}
    </Button>
  ) : null;
  return (
    <>
      <ObjectOutlines
        engine={engine}
        module={module}
        objects={objects}
        classes={session.classes}
        current={current}
        collapsed={collapsed}
        decisions={session.decisions}
        settings={settings}
        fixed={fixes.fixed}
      />
      {fixStep === "redraw" && stage !== null && currentItem !== undefined ? (
        <StageRedrawLayer
          engine={engine}
          stage={stage}
          draft={draft}
          onDraft={setDraft}
          onClose={(points) => finishRedraw(currentItem, points)}
          onCancel={() => cancelRedraw(currentItem)}
        />
      ) : null}
      {guided && ready && focus === null && currentItem !== undefined ? (
        <StageGuidedView
          key={currentItem.object}
          engine={engine}
          module={module}
          object={currentItem.object}
          area={currentArea}
          finished={done}
        />
      ) : null}
      {focus === null ? (
        <StageSlideMarks
          engine={engine}
          objects={objects}
          decisionOf={(id) => session.decisions.get(id)?.value}
          showScore={session.style.kind !== "yesno" && session.style.kind !== "blind"}
          sample={sample}
          collapsed={collapsed}
          ids={settings.ids}
          added={session.added}
          onWholeSlide={guided ? null : wholeSlide}
        />
      ) : null}
      {coachOn && focus === null ? <StageCoachOnSlide object={current ?? ""} /> : null}
      {focus === null || currentItem === undefined || typedCell !== null ? null : (
        <StageFocusCard
          session={session}
          object={currentItem}
          onAnswer={(raw) => answer(currentItem, raw)}
          onShowUi={focus.onShowUi}
          keysLive={ready}
          readOnly={readOnly}
        />
      )}
      {gridOpen && hasCells && ready && focus === null ? (
        <StageCellsGrid
          engine={engine}
          session={session}
          saves={saves}
          slideId={slideId}
          current={current}
          readOnly={readOnly}
          onPick={pickInStrip}
          onStep={stepTo}
          onClose={() => setGridOpen(false)}
        />
      ) : null}
      {typedCell === null || readOnly || fixStep !== null ? null : (
        <StageCellTypeBar
          engine={engine}
          cell={typedCell}
          chosen={storedType(
            session.style,
            typedCell,
            session.classes,
            session.decisions.get(typedCell.object),
          )}
          onChoose={(option: TypeOption) => decideType(typedCell, option.id)}
        />
      )}
      <DockCard section="objects" order={1}>
        <section
          aria-label={t`AI objects`}
          data-testid="stage-review-objects"
          data-ready={ready}
          data-guided={guided}
          data-current={current ?? ""}
          className={guided ? "flex flex-col gap-4" : "flex flex-col gap-2"}
        >
          {guided && done ? (
            <ReviewOpinion
              taskId={taskId}
              slideId={slideId}
              readOnly={opinionLocked}
              onObjects={(id) => {
                if (id === "cells") setGridOpen(true);
                if (id !== undefined) jump(id);
              }}
            />
          ) : guided && currentItem !== undefined ? (
            <StageGuidedCard
              session={session}
              object={currentItem}
              position={index + 1}
              coach={coachPart}
              stepTip={coachOn ? <StageCoachStepTip onStart={coach.dismiss} /> : null}
              onAnswer={(raw) => answer(currentItem, raw)}
              onJump={(id) => {
                if (id === "cells") setGridOpen(true);
                jump(id);
              }}
              onPrevious={() => pick(order[index - 1] ?? null)}
              onSkip={() => pick(order[index + 1] ?? nextOpenObject(order, decided, current))}
              onNote={() => {
                if (current !== null) onNote?.(current);
              }}
              onAddMissed={() => onAddMissed?.()}
              answersOff={answersOff}
              readOnly={readOnly}
              fix={fixFor(currentItem)}
            />
          ) : null}
          {orderWait ? (
            <ReviewOrderTabNotice order={orderWait} onRetry={session.retryOrder} />
          ) : null}
          <StageAiReading slideId={slideId} objects={objects} />
          {readOnly && answersOff !== undefined ? (
            <p
              data-testid="read-only-note"
              className="m-0 inline-flex items-center gap-2 text-body-sm text-fg-dim"
            >
              {answersOff}
            </p>
          ) : null}
          {!ready && !readOnly && answersOff !== undefined ? (
            <p
              data-testid="answers-off"
              className="m-0 inline-flex items-center gap-2 text-body-sm text-warn"
            >
              {answersOff}
            </p>
          ) : null}
          {!guided && ready ? (
            <StageObjectsPanel
              answersOff={answersOff}
              readOnly={readOnly}
              session={session}
              current={current}
              onPick={(id) => (id === null ? setCurrent(null) : pick(id))}
              onAnswer={answer}
              onNote={(id) => (decided.has(id) ? onNote?.(id) : onComments(id))}
              onOpenCells={() => setGridOpen(true)}
              cellTyped={typedCell !== null}
              rulers={rulers}
              onRemoveRuler={(ruler) => measurements?.remove(ruler.shapeId)}
            />
          ) : null}
        </section>
      </DockCard>
    </>
  );
}
