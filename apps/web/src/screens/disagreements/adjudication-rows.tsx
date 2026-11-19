import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { type TaskAdjudication, useListTaskAdjudications } from "@parfocal/api-client";
import { QuotedNote } from "@parfocal/ui/components/disagreements";
import { StatusTag } from "@parfocal/ui/components/tag";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { answerTone, answerWord, rowLabel } from "./text.ts";

export function useTaskAdjudications(taskId: string): TaskAdjudication[] {
  return okData(useListTaskAdjudications(taskId).data) ?? [];
}

export function AdjudicationRows({ rows }: { rows: TaskAdjudication[] }) {
  const { t } = useLingui();
  const person = usePeople();
  return (
    <ul aria-label={t`Adjudications`} className="m-0 grid list-none gap-2 p-0">
      {rows.map((row) => (
        <li key={`${row.adjudication_id}:${row.slide_id}:${row.object}`} className="grid gap-1">
          <span className="flex flex-wrap items-center gap-2 text-body-sm">
            <b data-phi="">{rowLabel(row)}</b>
            <span className="text-fg-dim">{person(row.adjudicator_user_id)?.name ?? ""}</span>
            {row.decision ? (
              <StatusTag tone={answerTone[row.decision.value]}>
                {answerWord[row.decision.value]}
              </StatusTag>
            ) : row.declined ? (
              <StatusTag tone="warn">
                <Trans>Declined</Trans>
              </StatusTag>
            ) : (
              <StatusTag tone="accent">
                <Trans>Waiting</Trans>
              </StatusTag>
            )}
          </span>
          {row.decision?.note ? <QuotedNote>{row.decision.note}</QuotedNote> : null}
          <small className="text-caption text-fg-dim">
            {plural(row.reviewer_decisions, {
              one: "Kept beside # reviewer decision",
              other: "Kept beside # reviewer decisions",
            })}
          </small>
        </li>
      ))}
    </ul>
  );
}
