import { useLingui } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { DecisionButtons } from "@parfocal/ui/components/decision-buttons";
import { ObjectIdTag } from "@parfocal/ui/components/tag";
import { useEffect, useMemo, useRef, useState } from "react";
import { answersOf } from "../screens/review/decision-style.ts";
import { type ReviewSession, useReviewSession } from "../screens/review/review-data.ts";
import { useDecisionSaves } from "../screens/review/use-decision-saves.ts";
import { DockCard } from "./inspector-slots.tsx";
import type { ViewerModule } from "./magnification-control.tsx";
import { nextOpenObject, outlineArea, placedObjects } from "./stage-geometry.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

const overlayId = "review-objects";

function ObjectOutlines({
  engine,
  module,
  objects,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  objects: readonly ReviewObject[];
}) {
  const placed = useMemo(() => placedObjects(objects), [objects]);
  const drawing = useMemo(
    () => module.createObjectDrawing({ id: overlayId, host: engine }),
    [module, engine],
  );
  useEffect(() => () => drawing.clear(), [drawing]);
  useEffect(() => {
    drawing.setObjects(placed);
  }, [drawing, placed]);
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
      <Button size="sm" variant="ghost" className="justify-self-start" onClick={onComments}>
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
  onComments,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  taskId: string;
  slideId: string;
  object: string | undefined;
  guided?: boolean;
  onComments: (object: string) => void;
}) {
  const { t } = useLingui();
  const session = useReviewSession(taskId, slideId);
  const saves = useDecisionSaves(session, session.style);
  const objects = session.objects;
  const order = objects.map((item) => item.object);
  const decided = new Set(session.decisions.keys());
  const [chosen, setCurrent] = useState<string | null>(object ?? null);
  const current =
    chosen ?? (guided ? (nextOpenObject(order, decided, null) ?? order[0] ?? null) : null);
  const flyTo = (id: string | null) => {
    const area = outlineArea(objects.find((item) => item.object === id)?.outline);
    if (area !== null) void engine.flyToArea(area);
  };
  const pick = (id: string | null) => {
    if (id === null) return;
    setCurrent(id);
    flyTo(id);
  };
  const ready = session.ready;
  const opening = useRef(current);
  useEffect(() => {
    if (!ready || opening.current === null) return;
    const area = outlineArea(objects.find((item) => item.object === opening.current)?.outline);
    opening.current = null;
    if (area !== null) void engine.flyToArea(area);
  }, [ready, objects, engine]);
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
  const index = current === null ? -1 : order.indexOf(current);
  const shown = guided ? objects.filter((item) => item.object === current) : objects;
  return (
    <>
      <ObjectOutlines engine={engine} module={module} objects={objects} />
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
          {guided ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={index <= 0}
                onClick={() => pick(order[index - 1] ?? null)}
              >
                {t`Previous`}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={index < 0 || index >= order.length - 1}
                onClick={() => pick(order[index + 1] ?? null)}
              >
                {t`Next`}
              </Button>
            </div>
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
