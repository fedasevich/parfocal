import {
  getDownloadSavedStudyTemplatePreviewUrl,
  getDownloadStudyTemplatePreviewUrl,
  getExportTaskEvaluationUrl,
  previewTaskEvaluation,
  type ReportPreview,
  type TemplatePreviewDraft,
  usePreviewSavedStudyTemplate,
  usePreviewStudyTemplate,
  usePreviewTaskEvaluation,
} from "@parfocal/api-client";
import { PdfPreview } from "@parfocal/ui/components/report-templates";
import { useEffect, useRef, useState } from "react";
import { okData } from "../placeholder.tsx";
import { fetchPdf, paperLabel, printFile, saveFile, svgSource } from "./pdf-file.ts";

type ViewerProps = {
  preview: ReportPreview | undefined;
  loading: boolean;
  failed: boolean;
  loadPdf: () => Promise<Blob>;
  loadPages?: (offset: number) => Promise<string[]>;
  onClose: () => void;
};

const PAGES_AHEAD = 2;

function useLaterPages(
  preview: ReportPreview | undefined,
  reading: number,
  loadPages: ViewerProps["loadPages"],
) {
  const [later, setLater] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [stuck, setStuck] = useState(false);
  const pages = [...(preview?.pages ?? []), ...later];
  const wanted = Math.min(preview?.page_count ?? 0, reading + PAGES_AHEAD);
  const have = pages.length;
  useEffect(() => {
    if (!loadPages || asking || stuck || have >= wanted) return;
    setAsking(true);
    loadPages(have).then(
      (more) => {
        if (more.length) setLater((known) => [...known, ...more]);
        else setStuck(true);
        setAsking(false);
      },
      () => {
        setStuck(true);
        setAsking(false);
      },
    );
  }, [loadPages, asking, stuck, have, wanted]);
  return pages;
}

function PdfViewer({ preview, loading, failed, loadPdf, loadPages, onClose }: ViewerProps) {
  const [page, setPage] = useState(1);
  const [fileFailed, setFileFailed] = useState(false);
  const file = useRef<Promise<Blob> | null>(null);
  const pages = useLaterPages(preview, page, loadPages);
  const name = preview?.file_name ?? "report.pdf";
  const landscape = preview?.orientation === "landscape";
  const act = (use: (blob: Blob) => void) => () => {
    file.current ??= loadPdf();
    file.current.then(use, () => {
      file.current = null;
      setFileFailed(true);
    });
  };
  return (
    <div
      className="fixed inset-x-0 top-12 bottom-0 z-40 bg-page"
      role="dialog"
      aria-label="PDF preview"
    >
      <PdfPreview
        className="h-full rounded-none border-0"
        title={name.replace(/\.pdf$/, "")}
        meta={
          preview
            ? `${paperLabel(preview.paper)} · ${preview.orientation} · ${preview.page_count} ${preview.page_count === 1 ? "page" : "pages"}${preview.sample ? " · sample numbers" : ""}`
            : undefined
        }
        pages={Math.max(1, preview?.page_count ?? 1)}
        current={page}
        onCurrentChange={setPage}
        loading={loading}
        failed={failed || fileFailed}
        renderPage={(number) => {
          const svg = pages[number - 1];
          return svg === undefined ? (
            <div
              aria-busy="true"
              className={`block max-w-full bg-white shadow-pop ${landscape ? "aspect-[297/210] w-[1123px]" : "aspect-[210/297] w-[794px]"}`}
            >
              <span className="sr-only">Page {number} is loading</span>
            </div>
          ) : (
            <img
              src={svgSource(svg)}
              alt={`Page ${number} of the report`}
              className="block bg-white shadow-pop"
            />
          );
        }}
        renderThumbnail={(number) => {
          const svg = pages[number - 1];
          return svg === undefined ? null : (
            <img src={svgSource(svg)} alt="" className="h-full w-full object-contain" />
          );
        }}
        onPrint={act(printFile)}
        onDownload={act((blob) => saveFile(blob, name))}
        onClose={onClose}
      />
    </div>
  );
}

const laterPagesOf = (taskId: string) => async (offset: number) => {
  const found = okData(await previewTaskEvaluation(taskId, { offset }));
  if (!found) throw new Error("The pages could not be loaded");
  return found.pages;
};

export function TaskPdfOverlay({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const query = usePreviewTaskEvaluation(taskId, undefined);
  const preview = okData(query.data);
  const url = getExportTaskEvaluationUrl(taskId, "report.pdf");
  const [loadPages] = useState(() => laterPagesOf(taskId));
  return (
    <PdfViewer
      preview={preview}
      loading={query.isPending}
      failed={query.isError || (query.data !== undefined && preview === undefined)}
      loadPdf={() => fetchPdf(() => fetch(url, { credentials: "same-origin" }))}
      loadPages={loadPages}
      onClose={onClose}
    />
  );
}

export function TemplatePdfOverlay({
  draft,
  onClose,
}: {
  draft: TemplatePreviewDraft;
  onClose: () => void;
}) {
  const made = usePreviewStudyTemplate();
  const [asked] = useState(draft);
  const { mutate } = made;
  useEffect(() => {
    mutate({ data: asked });
  }, [mutate, asked]);
  const preview = okData(made.data);
  const url = getDownloadStudyTemplatePreviewUrl();
  return (
    <PdfViewer
      preview={preview}
      loading={made.isPending || made.isIdle}
      failed={made.isError}
      loadPdf={() =>
        fetchPdf(() =>
          fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(asked),
          }),
        )
      }
      onClose={onClose}
    />
  );
}

export function SavedTemplatePdfOverlay({
  templateId,
  onClose,
}: {
  templateId: string;
  onClose: () => void;
}) {
  const query = usePreviewSavedStudyTemplate(templateId, undefined);
  const preview = okData(query.data);
  const url = getDownloadSavedStudyTemplatePreviewUrl(templateId);
  return (
    <PdfViewer
      preview={preview}
      loading={query.isPending}
      failed={query.isError || (query.data !== undefined && preview === undefined)}
      loadPdf={() => fetchPdf(() => fetch(url, { credentials: "same-origin" }))}
      onClose={onClose}
    />
  );
}
