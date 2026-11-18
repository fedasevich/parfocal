import { useLingui } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { DecisionButtons } from "@parfocal/ui/components/decision-buttons";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAnswerKeys } from "../screens/review/answer-keys.ts";
import { rawFor } from "../screens/review/decision-mapping.ts";
import { answersOf } from "../screens/review/decision-style.ts";
import { coachShown, useGuidedCoach } from "../screens/review/guided-coach.ts";
import { useNoteKey } from "../screens/review/note-key.ts";
import { type ReviewSession, useReviewSession } from "../screens/review/review-data.ts";
import {
  storedType,
  type TypeOption,
  typeAnswers,
  typeChoice,
  typeOptions,
} from "../screens/review/type-bar.ts";
import { useDecisionSaves } from "../screens/review/use-decision-saves.ts";
import { DockCard } from "./inspector-slots.tsx";
import type { ViewerModule } from "./magnification-control.tsx";
import { StageCellTypeBar } from "./stage-cell-type-bar.tsx";
import { StageCellsGrid } from "./stage-cells-grid.tsx";
import { StageCoachInPanel, StageCoachOnSlide } from "./stage-coach.tsx";
import { StageFocusCard } from "./stage-focus.tsx";
import { nextOpenObject, outlineArea, placedObjects } from "./stage-geometry.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

const overlayId = "review-objects";

function ObjectOutlines({
  engine,
  module,
  objects,
  classes,
  current,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  objects: readonly ReviewObject[];
  classes: ReviewSession["classes"];
  current: string | null;
}) {
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
  const placed = useMemo(() => placedObjects(objects, projectClasses), [objects, projectClasses]);
  const drawing = useMemo(
    () => module.createObjectDrawing({ id: overlayId, host: engine }),
    [module, engine],
  );
  useEffect(() => () => drawing.clear(), [drawing]);
  useEffect(() => {
    drawing.setObjects(placed);
  }, [drawing, placed]);
  useEffect(() => {
    drawing.setCurrent(current);
  }, [drawing, current]);
  return <div hidden data-testid="review-object-outlines" data-objects={placed.length} />;
}

function ObjectRow({
  session,
  object,
  current,
  onPick,
  onAnswer,
  onComments,
}: {
  session: ReviewSession;
  object: ReviewObject;
  current: boolean;
  onPick: () => void;
  onAnswer: (raw: string) => void;
  onComments: () => void;
}) {
  const { t } = useLingui();
  const decision = session.decisions.get(object.object);
  return (
    <li
      data-testid="stage-review-object"
      data-object={object.object}
      data-decision={decision?.value ?? ""}
      data-current={current}
      className={`flex flex-col gap-1.5 rounded-ctl border p-2 ${current ? "border-accent" : "border-line"}`}
    >
      <button
        type="button"
        onClick={onPick}
        className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-body-sm text-fg"
      >
        <ObjectIdTag>{object.object}</ObjectIdTag>
        <span className="min-w-0 flex-1 truncate">{object.class_name}</span>
        <span className="text-caption text-fg-dim">{Math.round(object.score * 100)}%</span>
      </button>
      <DecisionButtons
        decisionStyle={session.style.kind}
        size="compact"
        value={decision?.answer}
        onValueChange={onAnswer}
        classes={session.classes}
        aiClass={object.class_name}
        label={t`Your answer on ${object.object}`}
      />
      <Button size="sm" variant="secondary" className="justify-self-start" onClick={onComments}>
        {t`Notes and comments`}
      </Button>
    </li>
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
  focus = null,
  onComments,
  onNote,
  onCurrent,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  taskId: string;
  slideId: string;
  object: string | undefined;
  guided?: boolean;
  cellsGrid?: boolean;
  focus?: { onShowUi: () => void } | null;
  onComments: (object: string) => void;
  onNote?: (object: string) => void;
  onCurrent?: (object: string | null) => void;
}) {
  const { t } = useLingui();
  const session = useReviewSession(taskId, slideId);
  const saves = useDecisionSaves(session, session.style);
  const objects = session.objects;
  const order = objects.map((item) => item.object);
  const decided = new Set(session.decisions.keys());
  const [chosen, setCurrent] = useState<string | null>(object ?? null);
  const [gridOpen, setGridOpen] = useState(cellsGrid);
  const hasCells = objects.some((item) => item.kind === "cell");
  const current =
    chosen ??
    (guided || focus !== null ? (nextOpenObject(order, decided, null) ?? order[0] ?? null) : null);
  useNoteKey(() => {
    if (current !== null && decided.has(current)) onNote?.(current);
  });
  const flyTo = (id: string | null) => {
    const area = outlineArea(objects.find((item) => item.object === id)?.outline);
    if (area !== null) void engine.flyToArea(area);
  };
  const pick = (id: string | null) => {
    if (id === null) return;
    setCurrent(id);
    flyTo(id);
  };
  const ready = session.ready && objects.length > 0;
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
  const answer = (item: ReviewObject, raw: string) => {
    const option = answersOf(session.style, session.classes, item).find(
      (entry) => entry.raw === raw,
    );
    const value = option?.countsAs;
    if (value === undefined) return;
    saves.save(item.object, raw, value);
    if (guided) pick(nextOpenObject(order, new Set([...decided, item.object]), item.object));
    else setCurrent(item.object);
  };
  const currentItem = objects.find((item) => item.object === current);
  const typedCell =
    currentItem?.kind === "cell" && outlineArea(currentItem.outline) !== null ? currentItem : null;
  const decideType = (cell: ReviewObject, id: string) => {
    const option = typeOptions.find((item) => item.id === id);
    if (option === undefined) {
      if (id === "unsure") saves.save(cell.object, rawFor(session.style, "unsure", cell), "unsure");
    } else {
      const choice = typeChoice(session.style, option, cell, session.classes);
      saves.save(cell.object, choice.raw, choice.value, choice.draft);
    }
    if (guided) pick(nextOpenObject(order, new Set([...decided, cell.object]), cell.object));
  };
  useAnswerKeys(
    typeAnswers,
    (raw) => {
      if (typedCell !== null) decideType(typedCell, raw);
    },
    ready && typedCell !== null,
  );
  const index = current === null ? -1 : order.indexOf(current);
  const shown = guided ? objects.filter((item) => item.object === current) : objects;
  return (
    <>
      <ObjectOutlines
        engine={engine}
        module={module}
        objects={objects}
        classes={session.classes}
        current={current}
      />
      {coachOn && focus === null ? <StageCoachOnSlide /> : null}
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
          session={session}
          saves={saves}
          slideId={slideId}
          current={current}
          onPick={pick}
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
          className="flex flex-col gap-2"
        >
          <h3 className="m-0 text-body-sm font-semibold">
            {guided
              ? t`Object ${index + 1} of ${objects.length} · ${decided.size} decided`
              : t`AI objects · ${objects.length}`}
          </h3>
          {coachOn ? (
            <StageCoachInPanel
              keys={answersOf(session.style, session.classes, currentItem).map((item) => item.key)}
              onStart={coach.dismiss}
            />
          ) : null}
          {guided ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={index <= 0}
                onClick={() => pick(order[index - 1] ?? null)}
              >
                {t`Previous`}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={index < 0 || index >= order.length - 1}
                onClick={() => pick(order[index + 1] ?? null)}
              >
                {t`Next`}
              </Button>
              {coachOn ? null : (
                <Button size="sm" variant="secondary" onClick={coach.reopen}>
                  {t`How guided review works`}
                </Button>
              )}
            </div>
          ) : null}
          {hasCells ? (
            <Button
              size="sm"
              variant="secondary"
              className="justify-self-start"
              aria-pressed={gridOpen}
              onClick={() => setGridOpen((open) => !open)}
            >
              {gridOpen ? t`Hide the cells grid` : t`Show the cells grid`}
            </Button>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {shown.map((item) => (
              <ObjectRow
                key={item.object}
                session={session}
                object={item}
                current={current === item.object}
                onPick={() => pick(item.object)}
                onAnswer={(raw) => answer(item, raw)}
                onComments={() => onComments(item.object)}
              />
            ))}
          </ul>
        </section>
      </DockCard>
    </>
  );
}
