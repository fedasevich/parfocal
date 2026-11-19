import { Trans, useLingui } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useState } from "react";
import { cellCropUrl } from "../screens/cell-crop-url.ts";
import { usePeople } from "../screens/people.ts";
import type { ReviewConfidence } from "../screens/review/ai-wording.ts";
import { useSetName } from "../screens/review/cells-on-slide.tsx";
import { cardText, reasonText } from "../screens/review/decision-style.ts";
import type { ReviewSession } from "../screens/review/review-data.ts";
import { type Answer, countAnswers } from "../screens/review/review-state.ts";
import {
  AiSays,
  type ListFilter,
  ObjectList,
  ObjectsSummary,
} from "../screens/review/viewer-frame.tsx";
import { MeasurementFoot, ObjectFoot } from "../screens/viewer/objects-panel.tsx";
import { DockCard } from "./inspector-slots.tsx";
import type { StageRuler } from "./stage-measurements.tsx";
import { answerOfDecision } from "./stage-object-notes.tsx";

const closedNote = { open: false, reasons: [], text: "" };

export function reviewConfidenceOf(session: ReviewSession): ReviewConfidence {
  const hidden = session.display?.locks.some(
    (lock) => lock.setting === "confidence" && String(lock.value) === "hidden",
  );
  return hidden ? "hidden" : "number";
}

export function sessionAnswer(session: ReviewSession) {
  return (object: string): Answer | undefined => {
    const decision = session.decisions.get(object);
    if (!decision) return undefined;
    const kept = answerOfDecision(decision);
    return { ...kept, reasons: kept.reasons.map((code) => reasonText[code] ?? code) };
  };
}

function CellCrop({ slideId, cell }: { slideId: string; cell: ReviewObject }) {
  const { t } = useLingui();
  return (
    <img
      data-testid="object-foot-crop"
      src={cellCropUrl(slideId, cell.number)}
      alt={t`Cell ${cell.object}`}
      className="size-20 rounded-ctl border border-line object-cover"
    />
  );
}

export function StageObjectsPanel({
  session,
  current,
  onPick,
  onAnswer,
  onNote,
  onOpenCells,
  cellTyped,
  rulers = [],
  onRemoveRuler,
  answersOff,
}: {
  session: ReviewSession;
  current: string | null;
  onPick: (object: string | null) => void;
  onAnswer: (object: ReviewObject, raw: string) => void;
  onNote: (object: string) => void;
  onOpenCells: () => void;
  cellTyped: boolean;
  rulers?: readonly StageRuler[];
  onRemoveRuler?: (ruler: StageRuler) => void;
  answersOff?: string | undefined;
}) {
  const person = usePeople();
  const setName = useSetName(session);
  const [filter, setFilter] = useState<ListFilter>("all");
  const objects = session.objects;
  const answer = sessionAnswer(session);
  const counts = countAnswers(objects, answer);
  const confidence = reviewConfidenceOf(session);
  const slideLabel = session.slideName.split(" · ")[0] ?? "";
  const currentItem = objects.find((item) => item.object === current);
  const firstOpen = objects.find((item) => answer(item.object) === undefined)?.object;
  const hasCells = objects.some((item) => item.kind === "cell");
  const ruler = rulers.find((item) => item.label === current);
  const foot = ruler ? (
    <div data-testid="object-foot" data-object={ruler.label}>
      <MeasurementFoot
        object={ruler.label}
        mm={0}
        across=""
        length={ruler.length}
        onClose={() => onPick(null)}
        onRemove={() => {
          onPick(null);
          onRemoveRuler?.(ruler);
        }}
      />
    </div>
  ) : currentItem ? (
    <div data-testid="object-foot" data-object={currentItem.object} className="grid gap-2.5">
      {currentItem.kind === "cell" ? (
        <CellCrop slideId={session.slideId} cell={currentItem} />
      ) : null}
      <ObjectFoot
        object={currentItem}
        text={cardText(session.style, currentItem, confidence)}
        style={session.style}
        classes={session.classes}
        answer={answer(currentItem.object)}
        disabledReason={answersOff}
        author={person(session.meId)}
        note={closedNote}
        saveOffReason={undefined}
        onNote={() => onNote(currentItem.object)}
        onSaveNote={() => onNote(currentItem.object)}
        onAnswer={(raw) => onAnswer(currentItem, raw)}
        onClose={() => onPick(null)}
        cellButtons={!cellTyped}
      />
    </div>
  ) : firstOpen ? (
    <Button variant="primary" className="w-full" onClick={() => onPick(firstOpen)}>
      <Trans>Go to {firstOpen}, the first open object</Trans>
    </Button>
  ) : null;
  return (
    <>
      <ObjectsSummary
        slideLabel={slideLabel}
        counts={counts}
        added={session.added.map((item) => item.object)}
      />
      <AiSays setName={setName} objects={objects} />
      <ObjectList
        objects={objects}
        counts={counts}
        answer={answer}
        current={current ?? undefined}
        onPick={onPick}
        filter={filter}
        onFilterChange={setFilter}
        showScore={confidence !== "hidden"}
        added={session.added.map((item) => ({
          object: item.object,
          size: "",
          note: item.note,
        }))}
        {...(hasCells ? { onOpenCells } : {})}
        measurements={rulers.map((item) => ({
          object: item.label,
          mm: 0,
          across: "",
          length: item.length,
        }))}
      />
      {foot === null ? null : (
        <DockCard section="foot">
          <div data-testid="objects-foot">{foot}</div>
        </DockCard>
      )}
    </>
  );
}
