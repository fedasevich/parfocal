import { useLingui } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import type { DisplaySettings } from "@parfocal/ui/components/display-panel";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAnswerKeys } from "../screens/review/answer-keys.ts";
import { rawFor } from "../screens/review/decision-mapping.ts";
import { answersOf } from "../screens/review/decision-style.ts";
import { drawChoicesOf, myDisplaySettings } from "../screens/review/display-tab.tsx";
import { coachShown, useGuidedCoach } from "../screens/review/guided-coach.ts";
import { useNoteKey } from "../screens/review/note-key.ts";
import { useObjectKeys } from "../screens/review/object-keys.ts";
import { type ReviewSession, useReviewSession } from "../screens/review/review-data.ts";
import { pendingOrder } from "../screens/review/review-order-state.ts";
import { ReviewOrderTabNotice } from "../screens/review/review-order-state.tsx";
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
import { StageGuidedCard } from "./stage-guided-card.tsx";
import { StageGuidedView } from "./stage-guided-view.tsx";
import { useStageRulers } from "./stage-measurements.tsx";
import { StageObjectsPanel } from "./stage-objects-panel.tsx";
import { ReviewOpinion } from "./stage-opinion.tsx";
import { StageSlideMarks, sampleOf, useSampleCollapsed } from "./stage-slide-marks.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";

const overlayId = "review-objects";

const decisionNames = new Set(["agree", "disagree", "unsure"]);

function decisionNameOf(value: string | undefined) {
  return value !== undefined && decisionNames.has(value)
    ? (value as "agree" | "disagree" | "unsure")
    : null;
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
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  objects: readonly ReviewObject[];
  classes: ReviewSession["classes"];
  current: string | null;
  collapsed: boolean;
  decisions: ReviewSession["decisions"];
  settings: DisplaySettings;
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
  const placed = useMemo(() => {
    const shown = placedObjects(
      collapsed ? objects.filter((item) => item.kind !== "cell") : objects,
      projectClasses,
      defaults.classPalette,
    );
    if (decisionKey === "") return shown;
    const decided = new Map(JSON.parse(decisionKey) as [string, string][]);
    return shown.map((item) => ({ ...item, decision: decisionNameOf(decided.get(item.id)) }));
  }, [objects, projectClasses, collapsed, decisionKey, defaults.classPalette]);
  const choices = useMemo(() => drawChoicesOf(settings), [settings]);
  const drawing = useMemo(
    () => module.createObjectDrawing({ id: overlayId, host: engine }),
    [module, engine],
  );
  useEffect(() => () => drawing.clear(), [drawing]);
  useEffect(() => {
    drawing.setObjects(placed);
  }, [drawing, placed]);
  useEffect(() => {
    drawing.setChoices(choices);
  }, [drawing, choices]);
  useEffect(() => {
    drawing.setCurrent(current);
  }, [drawing, current]);
  return (
    <div
      hidden
      data-testid="review-object-outlines"
      data-objects={placed.length}
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
}: {
  engine: ViewerEngine;
  module: ViewerModule;
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
  const coachOn = guided && coachShown(coach.open, ready ? objects.length : 0);
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
    ready && typedCell !== null,
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
  const stepping = guided && ready && !done && focus === null;
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
  const coachPart = coachOn ? (
    <StageCoachAnswerTip
      keys={answersOf(session.style, session.classes, currentItem).map((item) => item.key)}
    />
  ) : (
    <Button variant="ghost" size="sm" className="w-fit px-0" onClick={coach.reopen}>
      {t`How guided review works`}
    </Button>
  );
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
      />
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
        />
      )}
      {gridOpen && hasCells && ready && focus === null ? (
        <StageCellsGrid
          engine={engine}
          session={session}
          saves={saves}
          slideId={slideId}
          current={current}
          onPick={pickInStrip}
          onStep={stepTo}
          onClose={() => setGridOpen(false)}
        />
      ) : null}
      {typedCell === null ? null : (
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
            />
          ) : null}
          {orderWait ? (
            <ReviewOrderTabNotice order={orderWait} onRetry={session.retryOrder} />
          ) : null}
          <StageAiReading slideId={slideId} objects={objects} />
          {!ready && answersOff !== undefined ? (
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
