import type { CountsAsChange, Evaluation, EvaluationReport, QueueRow } from "@parfocal/api-client";
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
import { blockCopy } from "../admin/templates.tsx";
import { answerWord } from "../disagreements/text.ts";
import { lookUrl } from "../thumbnails.ts";
import { headlineTiles, methodsLines, opinionRows, reasonRows } from "./numbers.ts";

export type PageBlock = {
  id: string;
  kind: EvaluationReport["template"]["blocks"][number]["kind"];
  title: string;
  width: "full" | "half";
};

export const pageCount = 3;

type PagesProps = {
  report: EvaluationReport;
  evaluation: Evaluation | undefined;
  queue: QueueRow[];
  blocks: PageBlock[];
  templateVersion: number;
  nameOf: (userId: string) => string;
  countsAsChanges?: CountsAsChange[] | undefined;
  selected?: string | null | undefined;
  onSelect?: ((id: string) => void) | undefined;
};

const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function BlockBody({
  block,
  report,
  evaluation,
  nameOf,
  countsAsChanges = [],
}: {
  block: PageBlock;
  report: EvaluationReport;
  evaluation: Evaluation | undefined;
  nameOf: (userId: string) => string;
  countsAsChanges?: CountsAsChange[] | undefined;
}) {
  if (block.kind === "text" && block.title === "Methods" && evaluation) {
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
  if (block.kind === "headline-numbers") {
    return <MetricTiles tiles={evaluation ? headlineTiles(evaluation) : []} />;
  }
  if (block.kind === "confusion-matrix") {
    return (
      <ConfusionMatrix
        classes={report.confusion.classes}
        counts={report.confusion.counts}
        caption="The diagonal is agreement between the AI and the consensus."
      />
    );
  }
  if (block.kind === "disagreement-reasons") {
    return <CountBars rows={evaluation ? reasonRows(evaluation) : []} />;
  }
  if (block.kind === "opinion-answers") {
    return (
      <CountBars
        heading={report.opinion_question}
        rows={evaluation ? opinionRows(evaluation) : []}
      />
    );
  }
  if (block.kind === "worst-objects") {
    return (
      <div className="grid gap-1.5">
        <ReportObjectsTable
          people={report.reviewer_ids.map(
            (id, index) => nameOf(id) || `Reviewer ${String.fromCharCode(65 + index)}`,
          )}
          rows={report.worst.map((row, index) => ({
            object: row.object,
            what: row.what,
            answers: row.answers.map((answer) => answer.raw),
            thumb: lookUrl(index % 2 === 0 ? "mid" : "hpf"),
          }))}
        />
        <span className="text-[7.5px] text-[#666]">
          {report.worst.length} of {report.objects} objects. Every object is in the CSV with its
          full ID.
        </span>
      </div>
    );
  }
  return (
    <p className="m-0 rounded-[3px] bg-[#f6f4ef] p-2 text-[#555]">
      {blockCopy[block.kind].shows}. Filled in from {report.task_code} when the PDF is made.
    </p>
  );
}

export function ReportPage({ page, ...props }: PagesProps & { page: number }) {
  const {
    report,
    evaluation,
    queue,
    blocks,
    templateVersion,
    nameOf,
    countsAsChanges,
    selected,
    onSelect,
  } = props;
  const footer = `${report.task_code} · Evaluation v${report.version}${report.signed_at ? ` · signed ${dayMonth(report.signed_at)}` : " · draft"}`;
  if (page === 1) {
    return (
      <ReportSheet page={1} pages={pageCount} footer={footer}>
        <ReportLetterhead
          lab={report.lab}
          kind="Parfocal · research output"
          title="Evaluation report"
          lines={[
            `${report.task_code} · ${report.model}`,
            `Evaluation v${report.version}${report.signed_at ? ` · signed ${dayMonth(report.signed_at)}` : " · draft"}`,
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
        <ReportBlocks>
          {blocks.map((block) => (
            <ReportBlock
              key={block.id}
              title={block.title}
              half={block.width === "half"}
              selected={selected === block.id}
              {...(onSelect ? { onSelect: () => onSelect(block.id) } : {})}
            >
              <BlockBody
                block={block}
                report={report}
                evaluation={evaluation}
                nameOf={nameOf}
                countsAsChanges={countsAsChanges}
              />
            </ReportBlock>
          ))}
        </ReportBlocks>
      </ReportSheet>
    );
  }
  if (page === 2) {
    const leftOpen = queue.filter((row) => row.state === "left-open");
    return (
      <ReportSheet page={2} pages={pageCount} footer={footer}>
        <ReportBlocks>
          <ReportBlock title="Changes after sign-off">
            {report.changes.length ? (
              <table className="w-full border-collapse text-[8.5px]">
                <tbody>
                  {report.changes.map((change) => (
                    <tr key={`${change.object}-${change.at}`} className="border-b border-[#ddd]">
                      <td className="py-1 font-mono font-semibold">
                        {change.object} on {change.slide_label}
                      </td>
                      <td>
                        {change.text} · "{change.reason}"
                      </td>
                      <td>{nameOf(change.by_user_id)}</td>
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
          <ReportBlock title="Signature">
            <span>
              {report.signed_at && report.signed_by_user_id
                ? `Signed by ${nameOf(report.signed_by_user_id)} on ${dayMonth(report.signed_at)} at ${time(report.signed_at)}. Changes after sign-off are logged with a reason.`
                : "Not signed yet."}
            </span>
          </ReportBlock>
        </ReportBlocks>
      </ReportSheet>
    );
  }
  return (
    <ReportSheet page={3} pages={pageCount} footer={footer}>
      <ReportBlocks>
        <ReportBlock title="Appendix · queued objects and their decisions">
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
                    return <td key={id}>{answer ? answerWord[answer.raw] : ""}</td>;
                  })}
                  <td>
                    {row.decision
                      ? answerWord[row.decision.raw]
                      : row.state === "left-open"
                        ? "Left open"
                        : "Open"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportBlock>
      </ReportBlocks>
    </ReportSheet>
  );
}
