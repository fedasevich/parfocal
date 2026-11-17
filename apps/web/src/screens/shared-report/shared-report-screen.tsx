import type { MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ApiError, type SharedReport, useGetSharedReport } from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import { CountBars, MetricTiles } from "@parfocal/ui/components/evaluation-report";
import { SkeletonPanel } from "@parfocal/ui/components/skeleton";
import { StatusTag } from "@parfocal/ui/components/tag";
import { lazyText } from "@parfocal/ui/lib/lazy-text";
import type { ReactNode } from "react";
import {
  answerSpread,
  fixed,
  headlineTiles,
  opinionRows,
  reasonRows,
} from "../evaluation/numbers.ts";
import { okData } from "../placeholder.tsx";

const longDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const kindName: Record<string, string> = lazyText(() => ({ region: t`Regions`, cell: t`Cells` }));

const refusals: Record<number, { title: MessageDescriptor; body: MessageDescriptor }> = {
  404: {
    title: msg`This link does not lead to a report`,
    body: msg`Check that the whole link was copied, or ask the person who shared it for a new one.`,
  },
  410: {
    title: msg`This link was revoked or has expired`,
    body: msg`Ask the person who shared it for a new link.`,
  },
  429: {
    title: msg`This link was opened too often just now`,
    body: msg`Wait a minute and open it again.`,
  },
};

const unknownRefusal = {
  title: msg`The report could not be loaded`,
  body: msg`Try again in a moment.`,
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto grid w-full max-w-4xl content-start gap-6 px-4 py-8 sm:px-8">
      {children}
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-3 rounded-zone bg-surf-panel p-4">
      <h2 className="m-0 text-body font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function NumberTable({
  label,
  head,
  rows,
}: {
  label: string;
  head: string[];
  rows: { key: string; cells: (string | number)[] }[];
}) {
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="w-full border-collapse text-body-sm">
        <thead>
          <tr>
            {head.map((name, index) => (
              <th
                key={name}
                scope="col"
                className={`border-b border-line px-2 py-1.5 font-semibold text-fg-dim ${index === 0 ? "text-left" : "text-right"}`}
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {head.map((name, index) => (
                <td
                  key={name}
                  className={`border-b border-line px-2 py-1.5 ${index === 0 ? "text-left text-fg" : "text-right font-mono text-fg"}`}
                >
                  {row.cells[index]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Report({ shared }: { shared: SharedReport }) {
  const { t } = useLingui();

  const evaluation = shared.evaluation;
  const reasons = reasonRows(evaluation);
  const opinions = opinionRows(evaluation);
  const classes = [
    ...evaluation.overall.map((row) => ({
      key: `all-${row.kind}`,
      label: `All ${(kindName[row.kind] ?? row.kind).toLowerCase()}`,
      row,
    })),
    ...evaluation.classes.map((row) => ({
      key: `${row.kind}-${row.class_name}`,
      label: row.class_name,
      row,
    })),
  ];
  return (
    <Shell>
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusTag tone="research">
            <Trans>Research output</Trans>
          </StatusTag>
          <StatusTag>
            <Trans>Read-only</Trans>
          </StatusTag>
          {evaluation.sample ? (
            <StatusTag tone="warn">
              <Trans>Sample data</Trans>
            </StatusTag>
          ) : null}
        </div>
        <h1 className="m-0 text-title font-semibold text-fg">{shared.task_name}</h1>
        <p className="m-0 text-body-sm text-fg-dim">
          <Trans>
            {shared.project_name} · evaluation report · this link works until{" "}
            {longDay(shared.expires_at)}
          </Trans>
        </p>
      </header>
      <MetricTiles variant="panel" tiles={headlineTiles(evaluation)} />
      <Section title={t`Decisions`}>
        <p className="m-0 text-body-sm text-fg-dim">
          {answerSpread(evaluation) || t`No decisions yet.`}
        </p>
      </Section>
      <Section title={t`Precision and sensitivity`}>
        <NumberTable
          label={t`Precision and sensitivity`}
          head={[
            t`Class`,
            t`True positives`,
            t`False positives`,
            t`False negatives`,
            t`Not sure`,
            t`Precision`,
            t`Sensitivity`,
          ]}
          rows={classes.map(({ key, label, row }) => ({
            key,
            cells: [
              label,
              row.true_positives,
              row.false_positives,
              row.false_negatives,
              row.unsure,
              fixed(row.precision.value),
              fixed(row.sensitivity.value),
            ],
          }))}
        />
      </Section>
      <Section title={t`Agreement between reviewers`}>
        <NumberTable
          label={t`Agreement between reviewers`}
          head={[t`Pair`, "Cohen's κ", t`Objects`]}
          rows={evaluation.kappa.map((pair) => ({
            key: `${pair.first}-${pair.second}`,
            cells: [t`${pair.first} and ${pair.second}`, fixed(pair.value), pair.objects],
          }))}
        />
        <p className="m-0 text-body-sm text-fg-dim">
          <Trans>
            Mean κ {fixed(evaluation.mean_kappa)} · Fleiss κ {fixed(evaluation.fleiss_kappa)} ·
            cells agreed between reviewers{" "}
            {fixed(evaluation.cell_agreement_between_reviewers.value)}
          </Trans>
        </p>
      </Section>
      {Object.keys(evaluation.dice).length ? (
        <Section title={t`Dice`}>
          <NumberTable
            label={t`Dice`}
            head={[t`Class`, t`Dice`]}
            rows={Object.entries(evaluation.dice).map(([name, rate]) => ({
              key: name,
              cells: [name, fixed(rate.value)],
            }))}
          />
        </Section>
      ) : null}
      {reasons.length ? (
        <Section title={t`Why reviewers disagreed`}>
          <CountBars rows={reasons} />
        </Section>
      ) : null}
      {opinions.length ? (
        <Section title={t`Opinion scores`}>
          <CountBars rows={opinions} />
        </Section>
      ) : null}
      <p className="m-0 text-caption text-fg-dim">
        <Trans>
          Shared from Parfocal. This page shows numbers only: no slides, images, names or comments.
        </Trans>
      </p>
    </Shell>
  );
}

export function SharedReportScreen({ token }: { token: string }) {
  const { t } = useLingui();

  const query = useGetSharedReport(token, { query: { retry: false, refetchOnWindowFocus: false } });
  const shared = okData(query.data);
  if (shared) return <Report shared={shared} />;
  if (!query.error) {
    return (
      <Shell>
        <SkeletonPanel label={t`Loading the report`} sections={4} />
      </Shell>
    );
  }
  const status = query.error instanceof ApiError ? query.error.status : 0;
  const refusal = refusals[status] ?? unknownRefusal;
  return (
    <Shell>
      <Banner tone="warn">
        <span className="grid gap-1">
          <b>{t(refusal.title)}</b>
          <span>{t(refusal.body)}</span>
        </span>
      </Banner>
    </Shell>
  );
}
