import { Trans, useLingui } from "@lingui/react/macro";
import type { ReviewObject } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { Keycap } from "@parfocal/ui/components/keycap";
import type { ReactNode } from "react";
import { reviewConfidence } from "../screens/review/ai-wording.ts";
import { cardText } from "../screens/review/decision-style.ts";
import { noteAction } from "../screens/review/note-key.ts";
import { ObjectCard, ObjectDots } from "../screens/review/object-card.tsx";
import { nextObjectAction, previousObjectAction } from "../screens/review/object-keys.ts";
import type { ReviewSession } from "../screens/review/review-data.ts";
import { answerFromDecision } from "../screens/review/review-state.ts";
import { useResolvedSettings } from "../shell/resolved-settings.ts";

export function StageGuidedCard({
  session,
  object,
  position,
  coach,
  onAnswer,
  onJump,
  onPrevious,
  onSkip,
  onNote,
  onAddMissed,
}: {
  session: ReviewSession;
  object: ReviewObject;
  position: number;
  coach: ReactNode;
  onAnswer: (raw: string) => void;
  onJump: (object: string) => void;
  onPrevious: () => void;
  onSkip: () => void;
  onNote: () => void;
  onAddMissed: () => void;
}) {
  const { t } = useLingui();
  const wording = useResolvedSettings()?.confidence_wording ?? "numbers";
  const confidence = reviewConfidence(session.display, null, [], wording);
  const objects = session.objects;
  const answer = (id: string) => {
    const decision = session.decisions.get(id);
    return decision === undefined
      ? undefined
      : answerFromDecision(
          decision,
          session.style,
          objects.find((item) => item.object === id),
          session.classes,
        );
  };
  const kept = answer(object.object);
  const note = kept ? (
    <button
      type="button"
      onClick={onNote}
      className="inline-flex w-fit cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-body-sm font-medium text-fg-dim hover:text-fg"
    >
      <Icon name="comment" />
      {kept.note || kept.reasons.length ? <Trans>Decision notes</Trans> : <Trans>Add a note</Trans>}
      <Keycap action={noteAction} size="sm" />
    </button>
  ) : null;
  return (
    <div
      data-testid="stage-review-object"
      data-object={object.object}
      data-decision={kept?.value ?? ""}
      data-current="true"
      className="flex flex-col gap-5"
    >
      <ObjectCard
        position={position}
        total={objects.length}
        object={object}
        dots={
          <ObjectDots
            regions={objects.filter((item) => item.kind === "region")}
            cells={objects.filter((item) => item.kind === "cell")}
            current={object.object}
            answer={answer}
            skipped={[]}
            onJump={onJump}
          />
        }
        text={cardText(session.style, object, confidence)}
        style={session.style}
        classes={session.classes}
        answer={kept}
        pending={null}
        lockLine={null}
        disabled={false}
        disagreeOpen={false}
        note={note}
        coach={coach}
        onAnswer={onAnswer}
        onReason={() => undefined}
        onBackToAnswers={() => undefined}
        onFix={() => undefined}
        redrawPoints={null}
        onFinishRedraw={() => undefined}
        onCancelRedraw={() => undefined}
        onAddMissed={onAddMissed}
      />
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="secondary"
          disabled={position <= 1}
          title={position <= 1 ? t`This is the first object` : undefined}
          onClick={onPrevious}
        >
          <Icon name="back" />
          <Trans>Previous</Trans>
          <Keycap action={previousObjectAction} size="sm" />
        </Button>
        <Button variant="secondary" onClick={onSkip}>
          {kept ? t`Next` : t`Skip for now`}
          <Keycap action={nextObjectAction} size="sm" />
          <Icon name="next" />
        </Button>
      </div>
    </div>
  );
}
