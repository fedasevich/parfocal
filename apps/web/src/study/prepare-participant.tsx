import { Trans, useLingui } from "@lingui/react/macro";
import {
  ApiError,
  type PreparedStudyParticipant,
  useGetMe,
  usePrepareStudyParticipant,
  useRemoveStudyParticipant,
  useSwitchWorkspace,
} from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { okData } from "../screens/placeholder.tsx";
import { freshRun, readRun, writeRun } from "./participant-run.ts";

const codePattern = /^[A-Za-z0-9-]{1,32}$/;

type Outcome =
  | { kind: "prepared"; prepared: PreparedStudyParticipant }
  | { kind: "removed"; code: string; removed: number }
  | { kind: "refused" }
  | { kind: "failed" };

const outcomeOfError = (error: unknown): Outcome =>
  error instanceof ApiError && error.status === 403 ? { kind: "refused" } : { kind: "failed" };

export function PrepareParticipant() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const me = okData(useGetMe().data);
  const [code, setCode] = useState(() => readRun()?.code ?? "");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const prepare = usePrepareStudyParticipant();
  const remove = useRemoveStudyParticipant();
  const switching = useSwitchWorkspace({
    mutation: { onSuccess: () => queryClient.resetQueries() },
  });
  const typed = code.trim().toUpperCase();
  const valid = codePattern.test(typed);
  const busy = prepare.isPending || remove.isPending;

  const onPrepare = () => {
    if (!valid) return;
    setOutcome(null);
    prepare.mutate(
      { code: typed },
      {
        onSuccess: (response) => {
          const made = okData(response);
          if (made === undefined) {
            setOutcome({ kind: "failed" });
            return;
          }
          const run = readRun();
          if (run === undefined || run.phase === "consent" || run.phase === "done") {
            writeRun(freshRun(made.code));
          }
          setOutcome({ kind: "prepared", prepared: made });
          void queryClient.invalidateQueries();
        },
        onError: (error) => setOutcome(outcomeOfError(error)),
      },
    );
  };

  const onRemove = () => {
    if (!valid) return;
    setOutcome(null);
    remove.mutate(
      { code: typed },
      {
        onSuccess: (response) => {
          const gone = okData(response);
          setOutcome(
            gone === undefined
              ? { kind: "failed" }
              : { kind: "removed", code: gone.code, removed: gone.removed },
          );
          void queryClient.invalidateQueries();
        },
        onError: (error) => setOutcome(outcomeOfError(error)),
      },
    );
  };

  const prepared = outcome?.kind === "prepared" ? outcome.prepared : undefined;
  const elsewhere = prepared !== undefined && prepared.workspace_id !== me?.active_tenant_id;

  return (
    <section className="grid gap-3" aria-label={t`Prepare the participant`}>
      <h2 className="font-semibold text-fg">
        <Trans>Prepare the participant</Trans>
      </h2>
      <p className="text-body-sm text-fg-dim">
        <Trans>
          Type or accept the code the participant page shows. Preparing seeds a fresh project for
          that code, with you as its seat, and replaces an earlier one.
        </Trans>
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          className="rounded border border-line bg-surf-field px-2 py-1 font-mono text-fg"
          aria-label={t`Code to prepare`}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t`P-ABCD`}
        />
        <Button variant="primary" size="sm" disabled={!valid || busy} onClick={onPrepare}>
          <Trans>Prepare the participant</Trans>
        </Button>
        <Button size="sm" disabled={!valid || busy} onClick={onRemove}>
          <Trans>Remove the project</Trans>
        </Button>
      </div>
      <p className="text-body-sm text-fg" data-testid="study-prepare-status" role="status">
        {prepare.isPending ? (
          <Trans>Preparing {typed}. This takes up to a minute.</Trans>
        ) : remove.isPending ? (
          <Trans>Removing the project of {typed}.</Trans>
        ) : outcome?.kind === "prepared" ? (
          <Trans>
            Study {outcome.prepared.code} is ready in {outcome.prepared.workspace_name}.
          </Trans>
        ) : outcome?.kind === "removed" ? (
          outcome.removed > 0 ? (
            <Trans>The project of {outcome.code} is removed.</Trans>
          ) : (
            <Trans>{outcome.code} had no project to remove.</Trans>
          )
        ) : outcome?.kind === "refused" ? (
          <Trans>Only a workspace admin can prepare or remove a participant.</Trans>
        ) : outcome?.kind === "failed" ? (
          <Trans>That did not work. Try again in a moment.</Trans>
        ) : null}
      </p>
      {elsewhere && prepared !== undefined ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="study-prepare-switch">
          <span className="text-body-sm text-fg-dim">
            <Trans>The participant page only finds it in {prepared.workspace_name}.</Trans>
          </span>
          <Button
            size="sm"
            disabled={switching.isPending}
            onClick={() => switching.mutate({ data: { tenant_id: prepared.workspace_id } })}
          >
            <Trans>Switch to {prepared.workspace_name}</Trans>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
