import { ApiError, type SharedReport, useGetSharedReport } from "@parfocal/api-client";
import { Banner } from "@parfocal/ui/components/banner";
import { CountBars, MetricTiles } from "@parfocal/ui/components/evaluation-report";
import { StatusTag } from "@parfocal/ui/components/tag";
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

const kindName: Record<string, string> = { region: "Regions", cell: "Cells" };

const refusals: Record<number, { title: string; body: string }> = {
  404: {
    title: "This link does not lead to a report",
    body: "Check that the whole link was copied, or ask the person who shared it for a new one.",
  },
  410: {
    title: "This link was revoked or has expired",
    body: "Ask the person who shared it for a new link.",
  },
  429: {
    title: "This link was opened too often just now",
    body: "Wait a minute and open it again.",
  },
};

const unknownRefusal = {
  title: "The report could not be loaded",
  body: "Try again in a moment.",
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
          <StatusTag tone="research">Research output</StatusTag>
          <StatusTag>Read-only</StatusTag>
          {evaluation.sample ? <StatusTag tone="warn">Sample data</StatusTag> : null}
        </div>
        <h1 className="m-0 text-title font-semibold text-fg">{shared.task_name}</h1>
        <p className="m-0 text-body-sm text-fg-dim">
          {shared.project_name} · evaluation report · this link works until{" "}
          {longDay(shared.expires_at)}
        </p>
      </header>
      <MetricTiles variant="panel" tiles={headlineTiles(evaluation)} />
      <Section title="Decisions">
        <p className="m-0 text-body-sm text-fg-dim">
          {answerSpread(evaluation) || "No decisions yet."}
        </p>
      </Section>
      <Section title="Precision and sensitivity">
        <NumberTable
          label="Precision and sensitivity"
          head={[
            "Class",
            "True positives",
            "False positives",
            "False negatives",
            "Not sure",
            "Precision",
            "Sensitivity",
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
      <Section title="Agreement between reviewers">
        <NumberTable
          label="Agreement between reviewers"
          head={["Pair", "Cohen's κ", "Objects"]}
          rows={evaluation.kappa.map((pair) => ({
            key: `${pair.first}-${pair.second}`,
            cells: [`${pair.first} and ${pair.second}`, fixed(pair.value), pair.objects],
          }))}
        />
        <p className="m-0 text-body-sm text-fg-dim">
          Mean κ {fixed(evaluation.mean_kappa)} · Fleiss κ {fixed(evaluation.fleiss_kappa)} · cells
          agreed between reviewers {fixed(evaluation.cell_agreement_between_reviewers.value)}
        </p>
      </Section>
      {Object.keys(evaluation.dice).length ? (
        <Section title="Dice">
          <NumberTable
            label="Dice"
            head={["Class", "Dice"]}
            rows={Object.entries(evaluation.dice).map(([name, rate]) => ({
              key: name,
              cells: [name, fixed(rate.value)],
            }))}
          />
        </Section>
      ) : null}
      {reasons.length ? (
        <Section title="Why reviewers disagreed">
          <CountBars rows={reasons} />
        </Section>
      ) : null}
      {opinions.length ? (
        <Section title="Opinion scores">
          <CountBars rows={opinions} />
        </Section>
      ) : null}
      <p className="m-0 text-caption text-fg-dim">
        Shared from Parfocal. This page shows numbers only: no slides, images, names or comments.
      </p>
    </Shell>
  );
}

export function SharedReportScreen({ token }: { token: string }) {
  const query = useGetSharedReport(token, { query: { retry: false, refetchOnWindowFocus: false } });
  const shared = okData(query.data);
  if (shared) return <Report shared={shared} />;
  if (!query.error) {
    return (
      <Shell>
        <p className="m-0 text-body-sm text-fg-dim">Loading the report</p>
      </Shell>
    );
  }
  const status = query.error instanceof ApiError ? query.error.status : 0;
  const refusal = refusals[status] ?? unknownRefusal;
  return (
    <Shell>
      <Banner tone="warn">
        <span className="grid gap-1">
          <b>{refusal.title}</b>
          <span>{refusal.body}</span>
        </span>
      </Banner>
    </Shell>
  );
}
