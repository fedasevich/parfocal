import {
  type EvaluationReport,
  reportBlockSchema,
  type TaskReportLayout,
  useGetDisagreementQueue,
  useGetEvaluationReport,
  useGetReviewTask,
  useGetTaskEvaluation,
  useGetTaskReportLayout,
  useListEvaluationChanges,
  useListReviewTasks,
  useListStudyTemplates,
} from "@parfocal/api-client";
import { Banner, InlineError } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Breadcrumbs } from "@parfocal/ui/components/flow-page";
import { Icon } from "@parfocal/ui/components/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { StatusTag } from "@parfocal/ui/components/tag";
import { FoldingZone } from "@parfocal/ui/components/zone";
import { useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useRouterLink } from "../../shell/router-link.tsx";
import { SidebarToggle } from "../../shell/sidebar-toggle.tsx";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useMockToast } from "../project/mock-toast.tsx";
import { ArrangeEditor } from "./arrange-editor.tsx";
import { LazyTaskPdf } from "./pdf-overlay-lazy.tsx";
import { type PageBlock, planOf, ReportPage } from "./report-pages.tsx";
import { ShareLinks } from "./share-links.tsx";

export type EvaluationScene = "report" | "arrange" | "pdf" | "retiredtpl" | "exportfail";

const fromLayout = (blocks: readonly object[]): PageBlock[] =>
  blocks.map((block, index) => ({
    ...reportBlockSchema.parse({ width: "full", ...block }),
    id: `${String((block as { kind: string }).kind)}-${index}`,
  }));

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function EvaluationScreen({
  taskId,
  scene,
  onScene,
}: {
  taskId: string;
  scene: EvaluationScene;
  onScene: (scene: EvaluationScene) => void;
}) {
  const report = okData(useGetEvaluationReport(taskId).data);
  const layout = okData(useGetTaskReportLayout(taskId).data);
  if (!report || !layout) return null;
  return (
    <EvaluationBody
      taskId={taskId}
      report={report}
      layout={layout}
      scene={scene}
      onScene={onScene}
    />
  );
}

function EvaluationBody({
  taskId,
  report,
  layout,
  scene,
  onScene,
}: {
  taskId: string;
  report: EvaluationReport;
  layout: TaskReportLayout;
  scene: EvaluationScene;
  onScene: (scene: EvaluationScene) => void;
}) {
  const evaluation = okData(useGetTaskEvaluation(taskId).data);
  const countsAsChanges = okData(useGetReviewTask(taskId).data)?.counts_as_changes;
  const queue = okData(useGetDisagreementQueue(taskId).data)?.rows ?? [];
  const logged = okData(useListEvaluationChanges(taskId).data);
  const changes = (logged?.changes ?? []).filter(
    (change) => change.version === logged?.signed_version,
  );
  const templates = okData(useListStudyTemplates().data) ?? [];
  const others = (okData(useListReviewTasks(report.project.id).data) ?? []).filter(
    (other) => other.id !== taskId,
  );
  const person = usePeople();
  const nameOf = (userId: string) => person(userId)?.name ?? "";
  const renderLink = useRouterLink();
  const toast = useMockToast();
  const [blocks, setBlocks] = useState<PageBlock[]>(() => fromLayout(layout.blocks));
  const [arranged, setArranged] = useState(layout.own);
  const [format, setFormat] = useState(
    () => (layout.format ?? report.template.format) as typeof report.template.format,
  );
  const [templateName, setTemplateName] = useState(report.template.name);
  const [version, setVersion] = useState(report.template.version);
  const [fileKind, setFileKind] = useState(report.formats[0]?.key ?? "pdf");
  const [failed, setFailed] = useState(scene === "exportfail");
  const arranging = scene === "arrange";
  const retired = report.template.retired_on !== null && version === report.template.version;
  const file = `${report.task_code}_evaluation_v${report.version}`;
  const projectHref = destinations.project(report.project.id);
  const plan = planOf(blocks, format);
  const pageCount = plan.length;
  const pageProps = {
    report,
    evaluation,
    queue,
    changes,
    blocks,
    format,
    pages: pageCount,
    templateVersion: version,
    nameOf,
    countsAsChanges,
  };

  const change = (next: PageBlock[]) => {
    setBlocks(next);
    setArranged(true);
  };
  const pickedBlock = blocks.find((block) => block.kind === "comparison" && block.task_id);
  const offered = others.find((other) => other.id === pickedBlock?.task_id) ?? others[0] ?? null;
  const compare = () => {
    const shown = blocks.find((block) => block.kind === "comparison" && block.task_id);
    if (shown) return;
    if (!offered) return;
    const block: PageBlock = {
      id: `comparison-${Date.now()}`,
      kind: "comparison",
      title: "Comparison",
      width: "full",
      show_title: true,
      page_break: false,
      task_id: offered.id,
    };
    change([...blocks, block]);
    toast.show(`${offered.code}, ${offered.name}, is now next to this one`, () =>
      setBlocks(blocks),
    );
  };
  const download = () => {
    if (failed || (scene === "exportfail" && fileKind === "pdf")) {
      setFailed(true);
      return;
    }
    toast.show(
      `${file}.${fileKind === "docx" ? "docx" : fileKind === "pdf" ? "pdf" : "csv"} saved to Downloads`,
    );
  };
  const switchTemplate = (id: string | null) => {
    const picked = templates.find((item) => item.id === id);
    if (!picked) return;
    const before = { blocks, name: templateName, version };
    setTemplateName(picked.name);
    setVersion(picked.version);
    setBlocks(
      picked.blocks.map((block, index) => ({
        ...reportBlockSchema.parse({ width: "full", ...block }),
        id: `${block.kind}-${index}`,
      })),
    );
    setArranged(false);
    toast.show(`The report now uses ${picked.name} v${picked.version}`, () => {
      setBlocks(before.blocks);
      setTemplateName(before.name);
      setVersion(before.version);
    });
  };

  const crumbs = [
    { label: report.project.name, href: projectHref },
    { label: "Review tasks", href: `${projectHref}?tab=tasks` },
    { label: `${report.task_code} · ${report.round_name}`, href: `${projectHref}?tab=tasks` },
    arranging
      ? { label: "Evaluation report", href: `/tasks/${taskId}/evaluation` }
      : { label: "Evaluation report" },
    ...(arranging ? [{ label: "Arrange blocks and format" }] : []),
  ];
  const pages = (
    <div className="grid justify-items-center gap-6 py-6">
      {plan.map((layout, index) => (
        <ReportPage
          key={`${layout.appendix ?? "page"}-${layout.rows.flat().join(".")}-${layout.closing}`}
          page={index + 1}
          plan={layout}
          {...pageProps}
        />
      ))}
    </div>
  );

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-(--density-flow-gap) px-7 pt-4 pb-5">
      <header className="grid gap-2">
        <Breadcrumbs start={<SidebarToggle />} renderLink={renderLink} items={crumbs} />
        <div className="flex items-end justify-between gap-4">
          <div className="grid gap-1">
            <h1 className="m-0 text-title font-semibold text-fg">
              {report.round_name} · {report.model}
            </h1>
            <p className="m-0 text-body-sm text-fg-dim">
              {report.project.name} ({report.project.code}) · task {report.task_code} · {pageCount}{" "}
              pages
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag tone="research">Research output</StatusTag>
            {report.signed_at ? (
              <StatusTag tone="accent">
                Evaluation v{report.version} · signed {shortDay(report.signed_at)}
              </StatusTag>
            ) : (
              <StatusTag tone="neutral">Evaluation v{report.version} · draft</StatusTag>
            )}
            {changes.length ? (
              <StatusTag tone="warn">
                Changed after sign-off · {changes.length} change{changes.length === 1 ? "" : "s"}
              </StatusTag>
            ) : null}
            {arranging ? (
              <span className="text-body-sm text-fg-dim">Arranging · {blocks.length} blocks</span>
            ) : null}
          </div>
        </div>
      </header>
      {arranging ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-zone">
          <ArrangeEditor
            taskId={taskId}
            report={report}
            notify={(message) => toast.show(message)}
            onSaved={(saved) => {
              setBlocks(
                saved.blocks.map((block, index) => ({
                  ...reportBlockSchema.parse({ width: "full", ...block }),
                  id: `${String(block.kind)}-${index}`,
                })),
              );
              setFormat(saved.format);
              setArranged(true);
              onScene("report");
            }}
            onBack={() => onScene("report")}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-4">
          <section
            aria-label="Report pages"
            className="min-h-0 overflow-auto rounded-zone bg-canvas"
          >
            {pages}
          </section>
          <aside className="grid content-start gap-3 overflow-auto">
            <FoldingZone title="Layout" summary={`${templateName} v${version}`} defaultOpen>
              <span className="text-body-sm font-semibold">Template</span>
              {retired ? (
                <>
                  <span className="flex items-center gap-2 text-body-sm font-medium text-fg">
                    {templateName} v{version} <StatusTag>Retired</StatusTag>
                  </span>
                  <Banner inline tone="info" className="items-start">
                    <span className="grid justify-items-start gap-2">
                      <span>
                        <b>
                          {templateName} v{version} was retired on{" "}
                          {shortDay(`${report.template.retired_on}T12:00:00`)}.
                        </b>{" "}
                        This report keeps it. New tasks use v{report.template.latest_version}.
                      </span>
                      <Button
                        size="sm"
                        onClick={() => {
                          setVersion(report.template.latest_version);
                          toast.show(
                            `The report now uses ${templateName} v${report.template.latest_version}`,
                          );
                        }}
                      >
                        Switch to v{report.template.latest_version}
                      </Button>
                    </span>
                  </Banner>
                </>
              ) : (
                <Select
                  value={templates.find((item) => item.name === templateName)?.id ?? null}
                  onValueChange={switchTemplate}
                >
                  <SelectTrigger aria-label="Template" className="w-full">
                    <SelectValue>
                      {templateName} v{version}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {templates
                      .filter((item) => item.retired_at === null)
                      .map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} v{item.name === templateName ? version : item.version}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
              <span className="text-body-sm text-fg-dim">
                {arranged
                  ? "Arranged for this task. The template itself has not changed."
                  : "Blocks and format come from the template."}{" "}
                {blocks.length} blocks on {pageCount} pages.
              </span>
              <Button variant="primary" onClick={() => onScene("pdf")}>
                <Icon name="eye" />
                Preview the PDF
              </Button>
              <Button onClick={() => onScene("arrange")}>
                <Icon name="sliders" />
                Arrange blocks and format
              </Button>
            </FoldingZone>
            <FoldingZone
              title="Download"
              summary={report.formats.find((item) => item.key === fileKind)?.label}
              defaultOpen
            >
              <span className="text-body-sm font-semibold">Format</span>
              <Select value={fileKind} onValueChange={(value) => setFileKind(String(value))}>
                <SelectTrigger aria-label="Format" className="w-full">
                  <SelectValue>
                    {report.formats.find((item) => item.key === fileKind)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {report.formats.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={download}>
                <Icon name="download" />
                Download
              </Button>
              {failed ? (
                <InlineError
                  actions={
                    <>
                      <button
                        type="button"
                        className="cursor-pointer border-0 bg-transparent p-0 text-body-sm text-accent hover:underline"
                        onClick={() => {
                          setFailed(false);
                          toast.show(`${file}.pdf saved to Downloads`);
                        }}
                      >
                        Try again
                      </button>
                      <button
                        type="button"
                        className="cursor-pointer border-0 bg-transparent p-0 text-body-sm text-accent hover:underline"
                        onClick={() => toast.show("2 CSV files saved to Downloads")}
                      >
                        Download CSV only
                      </button>
                    </>
                  }
                >
                  The PDF could not be made. Try again, or download the CSV files now.
                </InlineError>
              ) : null}
            </FoldingZone>
            <FoldingZone
              title="Compare and share"
              summary={offered ? `${offered.code} or a read-only link` : "A read-only link"}
            >
              <Button onClick={compare} disabled={!offered}>
                <Icon name="slides" />
                {offered
                  ? `Compare with ${offered.code}, ${offered.name}`
                  : "No other task to compare"}
              </Button>
              <ShareLinks taskId={taskId} taskCode={report.task_code} />
            </FoldingZone>
          </aside>
        </div>
      )}
      {scene === "pdf" ? <LazyTaskPdf taskId={taskId} onClose={() => onScene("report")} /> : null}
      {toast.node}
    </main>
  );
}
