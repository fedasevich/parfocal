import {
  type EvaluationReport,
  useGetDisagreementQueue,
  useGetEvaluationReport,
  useGetReviewTask,
  useGetTaskEvaluation,
  useListStudyTemplates,
} from "@parfocal/api-client";
import { Banner, InlineError } from "@parfocal/ui/components/banner";
import { Button } from "@parfocal/ui/components/button";
import { Breadcrumbs } from "@parfocal/ui/components/flow-page";
import { Icon } from "@parfocal/ui/components/icon";
import {
  BlockCatalogue,
  BlockSettings,
  PdfPreview,
} from "@parfocal/ui/components/report-templates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@parfocal/ui/components/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@parfocal/ui/components/tabs";
import { StatusTag } from "@parfocal/ui/components/tag";
import { FoldingZone } from "@parfocal/ui/components/zone";
import { useState } from "react";
import { destinations } from "../../shell/destinations.ts";
import { useRouterLink } from "../../shell/router-link.tsx";
import { SidebarToggle } from "../../shell/sidebar-toggle.tsx";
import { blockCopy } from "../admin/templates.tsx";
import { usePeople } from "../people.ts";
import { okData } from "../placeholder.tsx";
import { useMockToast } from "../project/mock-toast.tsx";
import { type PageBlock, pageCount, ReportPage } from "./report-pages.tsx";

export type EvaluationScene = "report" | "arrange" | "pdf" | "retiredtpl" | "exportfail";

type BlockKind = PageBlock["kind"];

const fromTemplate = (report: EvaluationReport): PageBlock[] =>
  report.template.blocks.map((block, index) => ({
    id: `${block.kind}-${index}`,
    kind: block.kind,
    title: block.title,
    width: block.width,
  }));

const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1);

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
  if (!report) return null;
  return <EvaluationBody taskId={taskId} report={report} scene={scene} onScene={onScene} />;
}

function EvaluationBody({
  taskId,
  report,
  scene,
  onScene,
}: {
  taskId: string;
  report: EvaluationReport;
  scene: EvaluationScene;
  onScene: (scene: EvaluationScene) => void;
}) {
  const evaluation = okData(useGetTaskEvaluation(taskId).data);
  const countsAsChanges = okData(useGetReviewTask(taskId).data)?.counts_as_changes;
  const queue = okData(useGetDisagreementQueue(taskId).data)?.rows ?? [];
  const templates = okData(useListStudyTemplates().data) ?? [];
  const person = usePeople();
  const nameOf = (userId: string) => person(userId)?.name ?? "";
  const renderLink = useRouterLink();
  const toast = useMockToast();
  const [blocks, setBlocks] = useState<PageBlock[]>(() => fromTemplate(report));
  const [arranged, setArranged] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState(report.template.name);
  const [version, setVersion] = useState(report.template.version);
  const [format, setFormat] = useState(report.formats[0]?.key ?? "pdf");
  const [failed, setFailed] = useState(scene === "exportfail");
  const [page, setPage] = useState(1);
  const arranging = scene === "arrange";
  const retired = report.template.retired_on !== null && version === report.template.version;
  const current = blocks.find((block) => block.id === selected) ?? null;
  const file = `${report.task_code}_evaluation_v${report.version}`;
  const projectHref = destinations.project(report.project.id);
  const pageProps = {
    report,
    evaluation,
    queue,
    blocks,
    templateVersion: version,
    nameOf,
    countsAsChanges,
  };

  const change = (next: PageBlock[]) => {
    setBlocks(next);
    setArranged(true);
  };
  const add = (kind: BlockKind) => {
    const block: PageBlock = {
      id: `${kind}-${Date.now()}`,
      kind,
      title: blockCopy[kind].name,
      width: "full",
    };
    const at = current ? blocks.indexOf(current) + 1 : blocks.length;
    change([...blocks.slice(0, at), block, ...blocks.slice(at)]);
    setSelected(block.id);
  };
  const move = (step: -1 | 1) => {
    if (!current) return;
    const at = blocks.indexOf(current);
    const to = at + step;
    if (to < 0 || to >= blocks.length) return;
    const next = [...blocks];
    next.splice(at, 1);
    next.splice(to, 0, current);
    change(next);
  };
  const remove = () => {
    if (!current) return;
    const before = blocks;
    change(blocks.filter((block) => block !== current));
    setSelected(null);
    toast.show(`Removed ${current.title}`, () => setBlocks(before));
  };
  const download = () => {
    if (failed || (scene === "exportfail" && format === "pdf")) {
      setFailed(true);
      return;
    }
    toast.show(
      `${file}.${format === "docx" ? "docx" : format === "pdf" ? "pdf" : "csv"} saved to Downloads`,
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
        id: `${block.kind}-${index}`,
        kind: block.kind,
        title: block.title,
        width: (block as { width?: "full" | "half" }).width ?? "full",
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
      {pageNumbers.map((number) => (
        <ReportPage
          key={number}
          page={number}
          {...pageProps}
          {...(arranging ? { selected, onSelect: setSelected } : {})}
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
            <h1 className="m-0 text-[20px] font-semibold text-fg">
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
            {report.changes.length ? (
              <StatusTag tone="warn">
                {report.changes.length} change{report.changes.length === 1 ? "" : "s"} after
                sign-off
              </StatusTag>
            ) : null}
            {arranging ? (
              <span className="text-body-sm text-fg-dim">Arranging · {blocks.length} blocks</span>
            ) : null}
          </div>
        </div>
      </header>
      {arranging ? (
        <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)_300px] gap-4">
          <aside className="grid content-start gap-2 overflow-auto rounded-zone bg-surf-panel p-3.5">
            <b className="text-body font-semibold">Blocks</b>
            <p className="m-0 text-body-sm text-fg-dim">
              Drag one onto the page, or click it to add it after the selected block.
            </p>
            <BlockCatalogue
              aria-label="Block catalogue"
              blocks={(Object.keys(blockCopy) as BlockKind[]).map((kind) => ({
                id: kind,
                name: blockCopy[kind].name,
                shows: blockCopy[kind].shows,
              }))}
              onAdd={(id) => add(id as BlockKind)}
            />
          </aside>
          <section
            aria-label="Report pages"
            className="min-h-0 overflow-auto rounded-zone bg-canvas"
          >
            {pages}
          </section>
          <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
            <Tabs defaultValue="block" className="min-h-0 overflow-auto">
              <TabsList>
                <TabsTrigger value="block">Block</TabsTrigger>
                <TabsTrigger value="format">Page and format</TabsTrigger>
              </TabsList>
              <TabsContent value="block" className="grid content-start gap-3 pt-3">
                {current ? (
                  <div className="grid content-start gap-3 rounded-zone bg-surf-panel p-3.5">
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={() => move(-1)}>
                        Up
                      </Button>
                      <Button size="sm" onClick={() => move(1)}>
                        Down
                      </Button>
                      <Button size="sm" variant="destructive" onClick={remove}>
                        Remove
                      </Button>
                    </div>
                    <BlockSettings
                      key={current.id}
                      block={{
                        id: current.id,
                        name: current.title,
                        shows: blockCopy[current.kind].shows,
                      }}
                    />
                  </div>
                ) : null}
                <section className="grid content-start gap-2 rounded-zone bg-surf-panel p-3.5">
                  <div className="flex items-center justify-between">
                    <b className="text-body font-semibold">Outline</b>
                    <span className="text-body-sm text-fg-dim">{blocks.length} blocks</span>
                  </div>
                  <p className="m-0 text-body-sm text-fg-dim">
                    Click a block on the page to change it. Drag blocks on the page or in this
                    outline to move them.
                  </p>
                  <ol className="m-0 grid list-none gap-1 p-0">
                    {blocks.map((block, index) => (
                      <li key={block.id}>
                        <button
                          type="button"
                          aria-pressed={selected === block.id}
                          onClick={() => setSelected(block.id)}
                          className="grid w-full cursor-pointer grid-cols-[20px_minmax(0,1fr)] gap-2 rounded-ctl border-0 bg-transparent px-2 py-1.5 text-left text-body-sm text-fg hover:bg-chrome-2 aria-pressed:bg-accent-soft"
                        >
                          <span className="text-fg-dim">{index + 1}</span>
                          <span className="grid">
                            <b className="font-medium">{block.title}</b>
                            <small className="text-caption text-fg-dim">
                              {blockCopy[block.kind].name}
                              {block.width === "half" ? " · half width" : ""}
                            </small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              </TabsContent>
              <TabsContent value="format" className="grid gap-2 pt-3 text-body-sm text-fg-dim">
                A4, portrait, the lab's logo, page numbers and the signature block, as{" "}
                {templateName} v{version} sets them.
              </TabsContent>
            </Tabs>
            <div className="grid gap-2">
              <Button variant="primary" onClick={() => onScene("report")}>
                Done
              </Button>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Button
                  onClick={() =>
                    toast.show(`Offered to the library as ${templateName} for ${report.task_code}`)
                  }
                >
                  <Icon name="file" />
                  Save as template
                </Button>
                <Button
                  variant="ghost"
                  disabled={!arranged}
                  title={arranged ? undefined : "Nothing changed"}
                  onClick={() => {
                    setBlocks(fromTemplate(report));
                    setArranged(false);
                    setSelected(null);
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>
          </aside>
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
              summary={report.formats.find((item) => item.key === format)?.label}
              defaultOpen
            >
              <span className="text-body-sm font-semibold">Format</span>
              <Select value={format} onValueChange={(value) => setFormat(String(value))}>
                <SelectTrigger aria-label="Format" className="w-full">
                  <SelectValue>
                    {report.formats.find((item) => item.key === format)?.label}
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
            <FoldingZone title="Compare and share" summary="RT-15 or a read-only link">
              <Button onClick={() => toast.show("Puts RT-15, PathoSAM v1.2, next to this one")}>
                <Icon name="slides" />
                Compare with RT-15, PathoSAM v1.2
              </Button>
              <Button
                onClick={() => toast.show("A read-only link for co-authors, no slides included")}
              >
                <Icon name="link" />
                Read-only link
              </Button>
            </FoldingZone>
          </aside>
        </div>
      )}
      {scene === "pdf" ? (
        <div
          className="fixed inset-x-0 top-12 bottom-0 z-40 bg-page"
          role="dialog"
          aria-label="PDF preview"
        >
          <PdfPreview
            className="h-full rounded-none border-0"
            title={file}
            meta={`A4 · portrait · ${pageCount} pages`}
            pages={pageCount}
            current={page}
            onCurrentChange={setPage}
            renderPage={(number) => <ReportPage page={number} {...pageProps} />}
            onPrint={() => toast.show(`Opens the print dialog for ${file}.pdf`)}
            onDownload={() => toast.show(`${file}.pdf saved to Downloads`)}
            onClose={() => onScene("report")}
          />
        </div>
      ) : null}
      {toast.node}
    </main>
  );
}
