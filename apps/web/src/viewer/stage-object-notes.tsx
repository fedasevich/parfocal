import { Trans } from "@lingui/react/macro";
import type { ReviewDecision } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { usePeople } from "../screens/people.ts";
import { fromMentionTokens } from "../screens/review/mention-picking.ts";
import { hasNote } from "../screens/review/note-model.ts";
import { answerLabel, SavedNote } from "../screens/review/object-card.tsx";
import { ObjectComments } from "../screens/review/object-comments.tsx";
import { answerOfNote, useOthersNotes } from "../screens/review/others-notes.ts";
import { useReviewSession } from "../screens/review/review-data.ts";
import type { Answer } from "../screens/review/review-state.ts";

export const answerOfDecision = (decision: ReviewDecision): Answer => ({
  value: decision.value,
  raw: decision.answer,
  reasons: decision.reasons,
  note: decision.note,
});

export function StageObjectNotes({
  taskId,
  slideId,
  object,
  onAllComments,
}: {
  taskId: string;
  slideId: string;
  object: string;
  onAllComments: () => void;
}) {
  const session = useReviewSession(taskId, slideId);
  const othersOn = useOthersNotes(taskId, slideId, session.meId);
  const person = usePeople();
  const nameOf = (userId: string) => person(userId)?.name;
  const decision = session.decisions.get(object);
  const kept = decision ? answerOfDecision(decision) : undefined;
  const own =
    kept && hasNote(kept)
      ? { ...kept, note: kept.note === null ? null : fromMentionTokens(kept.note, nameOf) }
      : undefined;
  const others = othersOn(object);
  const notes =
    own || others.length > 0 ? (
      <>
        {own ? (
          <SavedNote
            answer={own}
            label={answerLabel(session.style, own, session.classes)}
            author={person(session.meId)}
          />
        ) : null}
        {others.map((item) => (
          <SavedNote
            key={item.author_id}
            answer={answerOfNote(item)}
            label={answerLabel(session.style, answerOfNote(item), session.classes)}
            author={person(item.author_id)}
          />
        ))}
      </>
    ) : null;
  return (
    <div data-testid="stage-object-notes" className="grid gap-3 p-3">
      <Button size="sm" variant="ghost" className="justify-self-start" onClick={onAllComments}>
        <Trans>All comments on this slide</Trans>
      </Button>
      <ObjectComments
        taskId={taskId}
        slideId={slideId}
        object={object}
        decisionNotes={notes}
        threads={session.threads}
        meId={session.meId}
        blind={session.task?.blinded ?? false}
        blindReviewers={[]}
      />
    </div>
  );
}
