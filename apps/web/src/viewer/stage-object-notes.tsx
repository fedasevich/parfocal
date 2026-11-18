import { Trans } from "@lingui/react/macro";
import type { ReviewDecision } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useEffect, useState } from "react";
import { usePeople } from "../screens/people.ts";
import { reasonText } from "../screens/review/decision-style.ts";
import { disagreeOptions } from "../screens/review/disagree-reasons.ts";
import { fromMentionTokens } from "../screens/review/mention-picking.ts";
import {
  hasNote,
  type NoteDraft,
  reasonBody,
  toggleReason,
  withNote,
} from "../screens/review/note-model.ts";
import {
  answerLabel,
  NoteEditor,
  noteReasonsFor,
  SavedNote,
} from "../screens/review/object-card.tsx";
import { ObjectComments } from "../screens/review/object-comments.tsx";
import { answerOfNote, useOthersNotes } from "../screens/review/others-notes.ts";
import { useReviewSession } from "../screens/review/review-data.ts";
import type { Answer } from "../screens/review/review-state.ts";
import { useDecisionSaves } from "../screens/review/use-decision-saves.ts";

export const answerOfDecision = (decision: ReviewDecision): Answer => ({
  value: decision.value,
  raw: decision.answer,
  reasons: decision.reasons,
  note: decision.note,
});

export type NoteRequest = { readonly object: string; readonly count: number };

export function StageObjectNotes({
  taskId,
  slideId,
  object,
  editRequest = 0,
  onAllComments,
}: {
  taskId: string;
  slideId: string;
  object: string;
  editRequest?: number;
  onAllComments: () => void;
}) {
  const session = useReviewSession(taskId, slideId);
  const saves = useDecisionSaves(session, session.style);
  const othersOn = useOthersNotes(taskId, slideId, session.meId);
  const person = usePeople();
  const nameOf = (userId: string) => person(userId)?.name;
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const item = session.objects.find((entry) => entry.object === object);
  const decision = session.decisions.get(object);
  const kept = decision ? answerOfDecision(decision) : undefined;
  const shown = kept
    ? {
        ...kept,
        reasons: kept.reasons.map((code) => {
          const option =
            kept.value === "disagree" && item !== undefined
              ? disagreeOptions(item.kind, item.class_name, session.classes).find(
                  (entry) =>
                    entry.code === code &&
                    (entry.classId === null || entry.classId === decision?.reason_class_id),
                )
              : undefined;
          return option?.label ?? reasonText[code] ?? code;
        }),
        note: kept.note === null ? null : fromMentionTokens(kept.note, nameOf),
      }
    : undefined;
  const own = shown && hasNote(kept) ? shown : undefined;
  const others = othersOn(object);
  const openNote = () => {
    if (shown) setDraft({ reasons: shown.reasons, text: shown.note ?? "" });
  };
  const [handled, setHandled] = useState(0);
  useEffect(() => {
    if (editRequest <= handled || shown === undefined) return;
    setHandled(editRequest);
    setDraft({ reasons: shown.reasons, text: shown.note ?? "" });
  }, [editRequest, handled, shown]);
  const saveNote = () => {
    if (shown === undefined || item === undefined || draft === null) return;
    const next = withNote(shown, draft);
    saves.save(
      object,
      next.raw,
      next.value,
      reasonBody(next.reasons, next.value, item, session.classes),
      next.note,
    );
    setDraft(null);
  };
  const editor =
    draft !== null && item !== undefined ? (
      <NoteEditor
        object={object}
        reasons={noteReasonsFor(item, kept?.value, session.classes)}
        chosen={draft.reasons}
        text={draft.text}
        offReason={undefined}
        meId={session.meId}
        onReason={(reason) => setDraft(toggleReason(draft, reason))}
        onText={(text) => setDraft({ ...draft, text })}
        onSave={saveNote}
        onCancel={() => setDraft(null)}
      />
    ) : null;
  const mine =
    editor ??
    (own ? (
      <SavedNote
        answer={own}
        label={answerLabel(session.style, own, session.classes)}
        author={person(session.meId)}
        onEdit={openNote}
      />
    ) : shown ? (
      <Button size="sm" variant="secondary" className="justify-self-start" onClick={openNote}>
        <Trans>Add a note</Trans>
      </Button>
    ) : null);
  const notes =
    mine || others.length > 0 ? (
      <>
        {mine}
        {others.map((entry) => (
          <SavedNote
            key={entry.author_id}
            answer={answerOfNote(entry)}
            label={answerLabel(session.style, answerOfNote(entry), session.classes)}
            author={person(entry.author_id)}
          />
        ))}
      </>
    ) : null;
  return (
    <div data-testid="stage-object-notes" className="grid gap-3 p-3">
      <Button size="sm" variant="secondary" className="justify-self-start" onClick={onAllComments}>
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
