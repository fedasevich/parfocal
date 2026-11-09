import { type DecisionNote, useListDecisionNotes } from "@parfocal/api-client";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { fromMentionTokens } from "./mention-picking.ts";
import type { Answer } from "./review-state.ts";

export const answerOfNote = (note: DecisionNote): Answer => ({
  value: note.value,
  raw: note.answer,
  reasons: note.reasons,
  note: note.note,
});

export function useOthersNotes(taskId: string, slideId: string, meId: string | undefined) {
  const notes = okData(useListDecisionNotes(taskId, slideId).data) ?? [];
  const person = usePeople();
  const nameOf = (userId: string) => person(userId)?.name;
  return (object: string) =>
    notes
      .filter((note) => note.object === object && note.author_id !== meId)
      .map((note) => ({ ...note, note: fromMentionTokens(note.note, nameOf) }));
}
