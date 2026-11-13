import type { DecisionReason, ReviewObject } from "@parfocal/api-client";
import type { ProjectClass } from "@parfocal/ui/components/decision-buttons";
import { reasonText } from "./decision-style.ts";
import { disagreeOptions, reasonDraft } from "./disagree-reasons.ts";
import type { Answer } from "./review-state.ts";

export type NoteDraft = { reasons: string[]; text: string };

export const noteLimit = 500;

export const emptyNote: NoteDraft = { reasons: [], text: "" };

export const draftFrom = (kept: Answer | undefined): NoteDraft => ({
  reasons: kept?.reasons ?? [],
  text: kept?.note ?? "",
});

export const toggleReason = (draft: NoteDraft, reason: string): NoteDraft => ({
  ...draft,
  reasons: draft.reasons.includes(reason)
    ? draft.reasons.filter((item) => item !== reason)
    : [...draft.reasons, reason],
});

export const withNote = (kept: Answer, draft: NoteDraft): Answer => ({
  ...kept,
  reasons: draft.reasons,
  note: draft.text.trim() || null,
});

export const tooLong = (draft: NoteDraft) => draft.text.trim().length > noteLimit;

export const hasNote = (answer: Answer | undefined) =>
  Boolean(answer && (answer.note || answer.reasons.length));

export type NoteKeyAction = "save" | "cancel" | "none";

export function noteKeyAction(
  key: string,
  shift: boolean,
  composing: boolean,
  pickerOpen: boolean,
): NoteKeyAction {
  if (composing || pickerOpen) return "none";
  if (key === "Escape") return "cancel";
  if (key === "Enter" && !shift) return "save";
  return "none";
}

const unsureCodes = [
  "need_deeper_level",
  "need_ihc",
  "border_unclear",
  "out_of_focus",
  "need_second_look",
] as const satisfies readonly DecisionReason[];

export type ReasonBody = { reasons: DecisionReason[]; reason_class_id: string | null };

export function reasonBody(
  labels: string[],
  value: Answer["value"],
  object: ReviewObject,
  classes: ProjectClass[],
): ReasonBody {
  if (value === "disagree") {
    return reasonDraft(labels, disagreeOptions(object.kind, object.class_name, classes));
  }
  if (value === "unsure") {
    return {
      reasons: unsureCodes.filter((code) => labels.includes(reasonText[code] ?? "")),
      reason_class_id: null,
    };
  }
  return { reasons: [], reason_class_id: null };
}
