import { Trans, useLingui } from "@lingui/react/macro";
import { useListStudyLinks, useListStudySessions } from "@parfocal/api-client";
import { okData } from "../screens/placeholder.tsx";
import { type RemoteProgress, remoteProgress } from "./study-links.ts";
import { fromServer } from "./study-results.ts";

const pollMs = 5_000;

const polling = {
  retry: false,
  refetchInterval: (query: { state: { status: string } }) =>
    query.state.status === "error" ? false : pollMs,
};

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function ProgressText({ row }: { row: RemoteProgress }) {
  switch (row.kind) {
    case "waiting":
      return <Trans>Link not opened yet, it expires at {timeOf(row.expiresAt)}</Trans>;
    case "expired":
      return <Trans>Link expired or replaced before it was opened</Trans>;
    case "joined":
      return <Trans>Joined, reading the consent screen</Trans>;
    case "working":
      return (
        <Trans>
          {row.done} of {row.total} tasks done, last update {timeOf(row.updatedAt)}
        </Trans>
      );
    case "finished":
      return <Trans>Finished all {row.total} tasks and the questions</Trans>;
  }
}

export function RemoteProgressPanel({ total }: { total: number }) {
  const { t } = useLingui();
  const links = okData(useListStudyLinks({ query: polling }).data)?.links;
  const sessions = okData(useListStudySessions({ query: polling }).data)?.sessions;
  if (links === undefined || links.length === 0) return null;
  const rows = remoteProgress(
    links,
    (sessions ?? []).map((row) => fromServer(row)),
    total,
  );
  return (
    <section className="grid gap-2" aria-label={t`Remote participants`}>
      <h2 className="font-semibold text-fg">
        <Trans>Remote participants</Trans>
      </h2>
      <ul className="grid gap-1 text-body-sm">
        {rows.map((row) => (
          <li
            key={row.code}
            className="flex flex-wrap gap-2"
            data-testid="study-remote-progress"
            data-code={row.code}
            data-kind={row.kind}
          >
            <span className="font-mono text-fg">{row.code}</span>
            <span className="text-fg-dim">
              <ProgressText row={row} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
