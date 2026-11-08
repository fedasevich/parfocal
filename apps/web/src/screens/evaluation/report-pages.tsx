import {
  type CountsAsChange,
  type Evaluation,
  type EvaluationChange,
  type EvaluationReport,
  type EvaluationReportBlock,
  type EvaluationReportFormat,
  type LayoutPage,
  type QueueRow,
  reportPages,
  useGetEvaluationReport,
  useGetTaskEvaluation,
} from "@parfocal/api-client";
import {
  ConfusionMatrix,
  CountBars,
  MetricTiles,
  ReportBlock,
  ReportBlocks,
  ReportFacts,
  ReportLetterhead,
  ReportObjectsTable,
  ReportSheet,
} from "@parfocal/ui/components/evaluation-report";
import type { ReactNode } from "react";
import { answerOf, answerWord } from "../disagreements/text.ts";
import { okData } from "../placeholder.tsx";
import { lookUrl } from "../thumbnails.ts";
import {
  comparisonRows,
  fixed,
  headlineMetrics,
  headlineTiles,
  methodsLines,
  opinionRows,
  reasonRows,
} from "./numbers.ts";

export type PageBlock = EvaluationReportBlock & { id: string };

export const planOf = (blocks: PageBlock[], format: EvaluationReportFormat) =>
  reportPages(blocks, format);

type PagesProps = {
  report: EvaluationReport;
  evaluation: Evaluation | undefined;
  queue: QueueRow[];
  changes: EvaluationChange[];
  blocks: PageBlock[];
  format: EvaluationReportFormat;
  templateVersion: number;
  nameOf: (userId: string) => string;
  countsAsChanges?: CountsAsChange[] | undefined;
  selected?: string | null | undefined;
  onSelect?: ((id: string) => void) | undefined;
};

const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const changedLine = (count: number, version: number) =>
  `Changed after sign-off · ${count} change${count === 1 ? "" : "s"} listed at the end · the checksum is of v${version} as signed`;

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const metricName: Record<string, string> = {
  sensitivity: "Sensitivity",
  precision: "Precision",
  dice: "Dice",
};

function Empty({ children }: { children: ReactNode }) {
  return (
    <p data-slot="report-empty" className="m-0 rounded-[3px] bg-[#f6f4ef] p-2 text-[#555]">
      {children}
    </p>
  );
}

function PaperTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full border-collapse text-[8.5px]">
      <thead>
        <tr className="border-b border-[#222] text-left [&>th]:pb-1">
          {head.map((cell) => (
            <th key={cell} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.join("|")} className="border-b border-[#ddd] [&>td]:py-1">
            {row.map((cell, index) => (
              <td key={`${head[index]}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function slideRows(queue: QueueRow[]) {
  const counts = new Map<string, { objects: number; disagreements: number }>();
  for (const row of queue) {
    const found = counts.get(row.slide_label) ?? { objects: 0, disagreements: 0 };
    found.objects += 1;
    if (row.answers.some((answer) => answer.raw === "disagree")) found.disagreements += 1;
    counts.set(row.slide_label, found);
  }
  return [...counts.entries()];
}

function BlockBody({
  block,
  report,
  evaluation,
  queue,
  format,
  nameOf,
  countsAsChanges = [],
}: {
  block: PageBlock;
  report: EvaluationReport;
  evaluation: Evaluation | undefined;
  queue: QueueRow[];
  format: EvaluationReportFormat;
  nameOf: (userId: string) => string;
  countsAsChanges?: CountsAsChange[] | undefined;
}) {
  const decimals = format.decimals;
  switch (block.kind) {
    case "headline-numbers":
      return (
        <MetricTiles
          tiles={
            evaluation ? headlineTiles(evaluation, block.metrics ?? headlineMetrics, decimals) : []
          }
        />
      );
    case "region-metrics": {
      const columns = block.columns ?? ["sensitivity", "precision", "dice"];
      const regions = (evaluation?.classes ?? []).filter((row) => row.kind === "region");
      if (!regions.length) return <Empty>This task has no regions to measure.</Empty>;
      const value = (row: (typeof regions)[number], column: string) =>
        column === "dice"
          ? fixed(evaluation?.dice[row.class_name]?.value, decimals)
          : fixed(row[column as "sensitivity" | "precision"].value, decimals);
      return (
        <PaperTable
          head={["Class", ...columns.map((column) => metricName[column] ?? column)]}
          rows={regions
            .slice(0, block.rows ?? regions.length)
            .map((row) => [row.class_name, ...columns.map((column) => value(row, column))])}
        />
      );
    }
    case "confusion-matrix":
      if (!report.confusion.classes.length)
        return <Empty>This task has no cells, so there are no cell types to compare.</Empty>;
      return (
        <ConfusionMatrix
          classes={report.confusion.classes}
          counts={report.confusion.counts}
          caption="The diagonal is agreement between the AI and the consensus."
        />
      );
    case "reviewer-agreement": {
      const values: [string, number | null | undefined][] = [
        ["Fleiss kappa", evaluation?.fleiss_kappa],
        ["Cohen kappa", evaluation?.mean_kappa],
        ["Cell agreement between reviewers", evaluation?.cell_agreement_between_reviewers.value],
      ];
      if (values.every(([, value]) => value == null))
        return <Empty>Agreement needs two reviewers who answered the same objects.</Empty>;
      return (
        <PaperTable
          head={["Measure", "Value"]}
          rows={values.map(([name, value]) => [name, fixed(value, decimals)])}
        />
      );
    }
    case "disagreement-reasons": {
      const rows = evaluation ? reasonRows(evaluation) : [];
      if (!rows.length) return <Empty>No reviewer gave a reason for disagreeing.</Empty>;
      return <CountBars rows={rows.slice(0, block.top ?? rows.length)} />;
    }
    case "opinion-answers": {
      const rows = evaluation ? opinionRows(evaluation) : [];
      if (!rows.length) return <Empty>No reviewer answered the opinion form.</Empty>;
      return <CountBars heading={report.opinion_question} rows={rows} />;
    }
    case "worst-objects": {
      if (!report.worst.length) return <Empty>No object has a decision yet.</Empty>;
      const rows = report.worst.slice(0, block.rows ?? report.worst.length);
      return (
        <div className="grid gap-1.5">
          <ReportObjectsTable
            people={report.reviewer_ids.map(
              (id, index) => nameOf(id) || `Reviewer ${String.fromCharCode(65 + index)}`,
            )}
            rows={rows.map((row, index) => ({
              object: row.object,
              what: row.what,
              answers: row.answers.map((answer) => answer.raw),
              thumb: lookUrl(index % 2 === 0 ? "mid" : "hpf"),
            }))}
          />
          <span className="text-[7.5px] text-[#666]">
            {rows.length} of {report.objects} objects. Every object is in the CSV with its full ID.
          </span>
        </div>
      );
    }
    case "slide-table": {
      const rows = slideRows(queue);
      if (!rows.length) return <Empty>No slide in this task has objects to review.</Empty>;
      const columns = block.columns ?? ["objects", "disagreements"];
      const names: Record<string, string> = {
        objects: "Objects",
        disagreements: "Disagreements",
        time: "Review time",
      };
      return (
        <PaperTable
          head={["Slide", ...columns.map((column) => names[column] ?? column)]}
          rows={rows.map(([label, counts]) => [
            label,
            ...columns.map((column) =>
              column === "time" ? "Not recorded" : counts[column as "objects" | "disagreements"],
            ),
          ])}
        />
      );
    }
    case "slide-figure":
      if (!block.slide_id) return <Empty>Pick a slide for this figure.</Empty>;
      return (
        <figure className="m-0 grid gap-1">
          <img src={lookUrl("mid")} alt={block.caption || block.title} className="w-full" />
          <figcaption className="text-[7.5px] text-[#666]">
            {block.object_id ? `${block.object_id} · ` : ""}
            {block.caption}
          </figcaption>
        </figure>
      );
    case "text":
      if (block.title === "Methods" && !block.body && evaluation) {
        return (
          <div className="grid gap-1" data-methods="">
            {methodsLines(evaluation, countsAsChanges, nameOf).map((line) => (
              <p key={line} className="m-0">
                {line}
              </p>
            ))}
          </div>
        );
      }
      if (!block.body) return <Empty>This text block is empty.</Empty>;
      return <p className="m-0 whitespace-pre-line">{block.body}</p>;
    case "comparison":
      if (!block.task_id) return <Empty>Pick a review task to compare with.</Empty>;
      return (
        <ComparisonBlock
          taskId={block.task_id}
          report={report}
          evaluation={evaluation}
          decimals={decimals}
        />
      );
    case "ai-changes":
      return <Empty>Only an annotate task counts how the experts changed the AI.</Empty>;
  }
}

function ComparisonBlock({
  taskId,
  report,
  evaluation,
  decimals,
}: {
  taskId: string;
  report: EvaluationReport;
  evaluation: Evaluation | undefined;
  decimals: number;
}) {
  const otherReport = okData(useGetEvaluationReport(taskId).data);
  const otherEvaluation = okData(useGetTaskEvaluation(taskId).data);
  if (!evaluation || !otherReport || !otherEvaluation)
    return <Empty>The review task to compare with is not available.</Empty>;
  const head = (side: EvaluationReport) => `${side.task_code}, ${side.model}`;
  return (
    <div className="grid gap-1.5" data-slot="comparison">
      <PaperTable
        head={["Measure", head(report), head(otherReport), "Change"]}
        rows={comparisonRows(evaluation, otherEvaluation, decimals).map((row) => [
          row.label,
          row.left,
          row.right,
          row.change,
        ])}
      />
      <span className="text-[7.5px] text-[#666]">
        Change is {otherReport.task_code} minus {report.task_code}. Both tasks cover the same
        slides.
      </span>
    </div>
  );
}

function Closing({ report, queue, changes, format, nameOf }: PagesProps) {
  const leftOpen = queue.filter((row) => row.state === "left-open");
  return (
    <>
      <ReportBlock title="Changes after sign-off">
        {changes.length ? (
          <table className="w-full border-collapse text-[8.5px]">
            <tbody>
              {changes.map((change) => (
                <tr
                  key={`${change.version}-${change.object}-${change.at}`}
                  className="border-b border-[#ddd]"
                >
                  <td className="py-1 font-mono font-semibold">
                    {change.object} on {change.slide_label}
                  </td>
                  <td>
                    {change.text} · "{change.reason}"
                  </td>
                  <td>{change.by_user_id ? nameOf(change.by_user_id) : ""}</td>
                  <td className="text-right">
                    {dayMonth(change.at)}, {time(change.at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <span className="text-[#555]">Nothing changed after sign-off.</span>
        )}
      </ReportBlock>
      <ReportBlock title="Left open on purpose">
        <span>
          {leftOpen.length
            ? leftOpen.map((row) => `${row.object} on ${row.slide_label}`).join(", ")
            : "Every queued object was decided."}
        </span>
      </ReportBlock>
      {format.signature ? (
        <ReportBlock title="Signature">
          <span>
            {report.signed_at && report.signed_by_user_id
              ? `Signed by ${nameOf(report.signed_by_user_id)} on ${dayMonth(report.signed_at)} at ${time(report.signed_at)}. Changes after sign-off are logged with a reason.`
              : "Not signed yet."}
          </span>
        </ReportBlock>
      ) : null}
    </>
  );
}

function Appendix({
  name,
  report,
  queue,
  evaluation,
  nameOf,
  countsAsChanges = [],
}: PagesProps & { name: NonNullable<LayoutPage["appendix"]> }) {
  if (name === "methods") {
    return (
      <ReportBlock title="Appendix: methods">
        {evaluation ? (
          <div className="grid gap-1">
            {methodsLines(evaluation, countsAsChanges, nameOf).map((line) => (
              <p key={line} className="m-0">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </ReportBlock>
    );
  }
  if (name === "decisions") {
    return (
      <ReportBlock title="Appendix: decisions">
        <PaperTable
          head={["ID", "Slide", "Reviewer", "Decision"]}
          rows={queue.flatMap((row) =>
            row.answers.map((answer) => [
              row.object,
              row.slide_label,
              nameOf(answer.user_id),
              answerWord[answerOf(answer.raw)],
            ]),
          )}
        />
      </ReportBlock>
    );
  }
  return (
    <ReportBlock title="Appendix: objects">
      <table className="w-full border-collapse text-[8.5px]">
        <thead>
          <tr className="border-b border-[#222] text-left [&>th]:pb-1">
            <th scope="col">ID</th>
            <th scope="col">Slide</th>
            {report.reviewer_ids.map((id) => (
              <th key={id} scope="col">
                {nameOf(id)}
              </th>
            ))}
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((row) => (
            <tr key={row.key} className="border-b border-[#ddd] [&>td]:py-1">
              <td className="font-mono font-semibold">{row.object}</td>
              <td>{row.slide_label}</td>
              {report.reviewer_ids.map((id) => {
                const answer = row.answers.find((item) => item.user_id === id);
                return <td key={id}>{answer ? answerWord[answerOf(answer.raw)] : ""}</td>;
              })}
              <td>
                {row.decision
                  ? answerWord[answerOf(row.decision.raw)]
                  : row.state === "left-open"
                    ? "Left open"
                    : "Open"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ReportBlock>
  );
}

export function ReportPage({
  page,
  plan,
  pages,
  ...props
}: PagesProps & { page: number; plan: LayoutPage; pages: number }) {
  const { report, changes, blocks, format, templateVersion, nameOf, selected, onSelect } = props;
  const status = report.signed_at ? ` · signed ${dayMonth(report.signed_at)}` : " · draft";
  const footer = `${report.task_code} · Evaluation v${report.version}${status}`;
  return (
    <ReportSheet
      page={page}
      pages={pages}
      footer={footer}
      numbering={format.page_numbers}
      landscape={format.orientation === "landscape"}
      header={
        format.running_header && page > 1
          ? `${report.task_code} · Evaluation report v${report.version}`
          : undefined
      }
      watermark={format.draft_watermark && !report.signed_at ? "DRAFT" : undefined}
      data-paper={format.paper}
      data-text-size={format.text_size}
    >
      {page === 1 ? (
        <>
          <ReportLetterhead
            lab={report.lab}
            kind="Parfocal · research output"
            title="Evaluation report"
            lines={[
              `${report.task_code} · ${report.model}`,
              `Evaluation v${report.version}${status}`,
              ...(changes[0] ? [changedLine(changes.length, changes[0].version)] : []),
            ]}
          />
          <ReportFacts
            facts={[
              { label: "Project", value: `${report.project.name} (${report.project.code})` },
              { label: "Task", value: `${report.task_code} · ${report.round_name}` },
              { label: "Model", value: report.model },
              { label: "Slides", value: `${report.slides} slides · ${report.objects} objects` },
              {
                label: "Reviewers",
                value: `${report.reviewer_ids.length} blind reviewers, ${report.adjudicators} adjudicator`,
              },
              { label: "Template", value: `${report.template.name} v${templateVersion}` },
            ]}
          />
        </>
      ) : null}
      <ReportBlocks>
        {plan.rows.flat().map((index) => {
          const block = blocks[index];
          if (!block) return null;
          return (
            <ReportBlock
              key={block.id}
              title={block.show_title ? block.title : null}
              half={block.width === "half"}
              selected={selected === block.id}
              data-kind={block.kind}
              data-title={block.title}
              {...(onSelect ? { onSelect: () => onSelect(block.id) } : {})}
            >
              <BlockBody
                block={block}
                report={report}
                evaluation={props.evaluation}
                queue={props.queue}
                format={format}
                nameOf={nameOf}
                countsAsChanges={props.countsAsChanges}
              />
            </ReportBlock>
          );
        })}
        {plan.closing ? <Closing {...props} /> : null}
        {plan.appendix ? <Appendix {...props} name={plan.appendix} /> : null}
      </ReportBlocks>
    </ReportSheet>
  );
}
