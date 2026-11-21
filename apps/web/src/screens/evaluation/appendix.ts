import type { QueueAnswerRecord, QueueRow } from "@parfocal/api-client";
import { styledWord } from "../disagreements/text.ts";
import type { ReviewStyle } from "../review/decision-mapping.ts";

export const appendixWord = (style: ReviewStyle, raw: string, row: Pick<QueueRow, "ai">) =>
  styledWord(style, raw, [], row.ai.class_name);

export function reviewerCells(
  row: Pick<QueueRow, "ai" | "answers">,
  reviewerIds: readonly string[],
  style: ReviewStyle,
): string[] {
  return reviewerIds.map((id) => {
    const answer = row.answers.find((item: QueueAnswerRecord) => item.user_id === id);
    return answer ? appendixWord(style, answer.raw, row) : "";
  });
}

export const decisionCell = (row: Pick<QueueRow, "ai" | "decision">, style: ReviewStyle) =>
  row.decision ? appendixWord(style, row.decision.raw, row) : null;
