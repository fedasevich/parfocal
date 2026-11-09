import { type DecisionNote, useListDecisionNotes } from "@parfocal/api-client";
import { okData } from "../placeholder.tsx";
import type { Answer } from "./review-state.ts";

export const answerOfNote = (note: DecisionNote): Answer => ({
  value: note.value,
  raw: note.answer,
  reasons: note.reasons,
  note: note.note,
});

export function useOthersNotes(taskId: string, slideId: string, meId: string | undefined) {
  const notes = okData(useListDecisionNotes(taskId, slideId).data) ?? [];
  return (object: string) =>
    notes.filter((note) => note.object === object && note.author_id !== meId);
}
