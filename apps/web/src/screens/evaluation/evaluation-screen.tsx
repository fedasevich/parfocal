import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  type EvaluationReport,
  type EvaluationReportFormat,
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
import { AdjudicationRows, useTaskAdjudications } from "../disagreements/adjudication-rows.tsx";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useScreenToast } from "../project/screen-toast.tsx";
import { ArrangeEditor } from "./arrange-editor.tsx";
import { downloadExport, hasExport } from "./download-export.ts";
import { LazyTaskPdf } from "./pdf-overlay-lazy.tsx";
import { type PageBlock, planOf, ReportPage } from "./report-pages.tsx";
import { ShareLinks } from "./share-links.tsx";

export type EvaluationScene = "report" | "arrange" | "retiredtpl" | "exportfail";

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
  previewing = false,
  onPreview = () => undefined,
}: {
  taskId: string;
  scene: EvaluationScene;
  onScene: (scene: EvaluationScene) => void;
  previewing?: boolean;
  onPreview?: (open: boolean) => void;
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
      previewing={previewing}
      onPreview={onPreview}
    />
  );
}

function EvaluationBody({
  taskId,
  report,
  layout,
  scene,
  onScene,
  previewing,
  onPreview,
}: {
  taskId: string;
  report: EvaluationReport;
  layout: TaskReportLayout;
  scene: EvaluationScene;
  onScene: (scene: EvaluationScene) => void;
  previewing: boolean;
  onPreview: (open: boolean) => void;
}) {
  const { t } = useLingui();

  const evaluation = okData(useGetTaskEvaluation(taskId).data);
  const countsAsChanges = okData(useGetReviewTask(taskId).data)?.counts_as_changes;
  const queue = okData(useGetDisagreementQueue(taskId).data)?.rows ?? [];
  const adjudicated = useTaskAdjudications(taskId);
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
  const toast = useScreenToast();
  const [blocks, setBlocks] = useState<PageBlock[]>(() => fromLayout(layout.blocks));
  const [arranged, setArranged] = useState(layout.own);
  const [format, setFormat] = useState(
    () => (layout.format ?? report.template.format) as EvaluationReportFormat,
  );
  const [templateName, setTemplateName] = useState(report.template.name);
  const [version, setVersion] = useState(report.template.version);
  const [fileKind, setFileKind] = useState(report.formats[0]?.key ?? "pdf");
  const [failed, setFailed] = useState(scene === "exportfail");
  const arranging = scene === "arrange";
  const retired = report.template.retired_on !== null && version === report.template.version;
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
      title: t`Comparison`,
      width: "full",
      show_title: true,
      page_break: false,
      task_id: offered.id,
    };
    change([...blocks, block]);
    toast.show(t`${offered.code}, ${offered.name}, is now next to this one`, () =>
      setBlocks(blocks),
    );
  };
  const download = async (format = fileKind) => {
    if (failed || (scene === "exportfail" && format === "pdf")) {
      setFailed(true);
      return;
    }
    const saved = await downloadExport(taskId, format);
    if (saved === null) {
      setFailed(true);
      return;
    }
    toast.show(t`${saved} saved to Downloads`);
  };
  const downloadCsv = async () => {
    const saved = await Promise.all([
      downloadExport(taskId, "decisions"),
      downloadExport(taskId, "objects"),
    ]);
    if (saved.some((name) => name === null)) {
      setFailed(true);
      return;
    }
    toast.show(t`2 CSV files saved to Downloads`);
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
    toast.show(t`The report now uses ${picked.name} v${picked.version}`, () => {
      setBlocks(before.blocks);
      setTemplateName(before.name);
      setVersion(before.version);
    });
  };

  const crumbs = [
    { label: report.project.name, href: projectHref },
    { label: t`Review tasks`, href: `${projectHref}?tab=tasks` },
    { label: `${report.task_code} · ${report.round_name}`, href: `${projectHref}?tab=tasks` },
    arranging
      ? { label: t`Evaluation report`, href: `/tasks/${taskId}/evaluation` }
      : { label: t`Evaluation report` },
    ...(arranging ? [{ label: t`Arrange blocks and format` }] : []),
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
              {report.project.name} (
              <Trans>
                {report.project.code}) · task {report.task_code}
              </Trans>{" "}
              · <Trans>{pageCount} pages</Trans>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag tone="research">
              <Trans>Research output</Trans>
            </StatusTag>
            {report.signed_at ? (
              <StatusTag tone="accent">
                <Trans>
                  Evaluation v{report.version} · signed {shortDay(report.signed_at)}
                </Trans>
              </StatusTag>
            ) : (
              <StatusTag tone="neutral">
                <Trans>Evaluation v{report.version} · draft</Trans>
              </StatusTag>
            )}
            {changes.length ? (
              <StatusTag tone="warn">
                <Trans>Changed after sign-off · {changes.length} change</Trans>
                {changes.length === 1 ? "" : t`s`}
              </StatusTag>
            ) : null}
            {arranging ? (
              <span className="text-body-sm text-fg-dim">
                <Trans>Arranging · {blocks.length} blocks</Trans>
              </span>
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
            aria-label={t`Report pages`}
            className="min-h-0 overflow-auto rounded-zone bg-canvas"
          >
            {pages}
          </section>
          <aside className="grid content-start gap-3 overflow-auto">
            <FoldingZone title={t`Layout`} summary={`${templateName} v${version}`} defaultOpen>
              <span className="text-body-sm font-semibold">
                <Trans>Template</Trans>
              </span>
              {retired ? (
                <>
                  <span className="flex items-center gap-2 text-body-sm font-medium text-fg">
                    <Trans>
                      {templateName} v{version}{" "}
                    </Trans>
                    <StatusTag>
                      <Trans>Retired</Trans>
                    </StatusTag>
                  </span>
                  <Banner inline tone="info" className="items-start">
                    <span className="grid justify-items-start gap-2">
                      <span>
                        <b>
                          <Trans>
                            {templateName} v{version} was retired on{" "}
                            {shortDay(`${report.template.retired_on}T12:00:00`)}
                          </Trans>
                          .
                        </b>
                        <Trans>
                          {" "}
                          This report keeps it. New tasks use v{report.template.latest_version}
                        </Trans>
                        .
                      </span>
                      <Button
                        size="sm"
                        onClick={() => {
                          setVersion(report.template.latest_version);
                          toast.show(
                            t`The report now uses ${templateName} v${report.template.latest_version}`,
                          );
                        }}
                      >
                        <Trans>Switch to v{report.template.latest_version}</Trans>
                      </Button>
                    </span>
                  </Banner>
                </>
              ) : (
                <Select
                  value={templates.find((item) => item.name === templateName)?.id ?? null}
                  onValueChange={switchTemplate}
                >
                  <SelectTrigger aria-label={t`Template`} className="w-full">
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
                  ? t`Arranged for this task. The template itself has not changed.`
                  : t`Blocks and format come from the template.`}
                <Trans>
                  {" "}
                  {blocks.length} blocks on {pageCount} pages.
                </Trans>
              </span>
              <Button variant="primary" onClick={() => onPreview(true)}>
                <Icon name="eye" />
                <Trans>Preview the PDF</Trans>
              </Button>
              <Button onClick={() => onScene("arrange")}>
                <Icon name="sliders" />
                <Trans>Arrange blocks and format</Trans>
              </Button>
            </FoldingZone>
            <FoldingZone
              title={t`Download`}
              summary={report.formats.find((item) => item.key === fileKind)?.label}
              defaultOpen
            >
              <span className="text-body-sm font-semibold">
                <Trans>Format</Trans>
              </span>
              <Select value={fileKind} onValueChange={(value) => setFileKind(String(value))}>
                <SelectTrigger aria-label={t`Format`} className="w-full">
                  <SelectValue>
                    {report.formats.find((item) => item.key === fileKind)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {report.formats
                    .filter((item) => hasExport(item.key))
                    .map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button onClick={() => void download()}>
                <Icon name="download" />
                <Trans>Download</Trans>
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
                          void downloadExport(taskId, "pdf").then((saved) => {
                            if (saved === null) setFailed(true);
                            else toast.show(t`${saved} saved to Downloads`);
                          });
                        }}
                      >
                        <Trans>Try again</Trans>
                      </button>
                      <button
                        type="button"
                        className="cursor-pointer border-0 bg-transparent p-0 text-body-sm text-accent hover:underline"
                        onClick={() => void downloadCsv()}
                      >
                        <Trans>Download CSV only</Trans>
                      </button>
                    </>
                  }
                >
                  <Trans>
                    The PDF could not be made. Try again, or download the CSV files now.
                  </Trans>
                </InlineError>
              ) : null}
            </FoldingZone>
            <FoldingZone
              title={t`Compare and share`}
              summary={offered ? t`${offered.code} or a read-only link` : t`A read-only link`}
            >
              <Button onClick={compare} disabled={!offered}>
                <Icon name="slides" />
                {offered
                  ? t`Compare with ${offered.code}, ${offered.name}`
                  : t`No other task to compare`}
              </Button>
              <ShareLinks taskId={taskId} taskCode={report.task_code} />
            </FoldingZone>
            {adjudicated.length ? (
              <FoldingZone
                title={t`Adjudications`}
                summary={plural(adjudicated.length, { one: "# object", other: "# objects" })}
                defaultOpen
              >
                <AdjudicationRows rows={adjudicated} />
              </FoldingZone>
            ) : null}
          </aside>
        </div>
      )}
      {previewing ? <LazyTaskPdf taskId={taskId} onClose={() => onPreview(false)} /> : null}
      {toast.node}
    </main>
  );
}
