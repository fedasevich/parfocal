import {
  getDownloadSavedStudyTemplatePreviewUrl,
  getDownloadStudyTemplatePreviewUrl,
  getExportTaskEvaluationUrl,
  type ReportPreview,
  type TemplatePreviewDraft,
  usePreviewSavedStudyTemplate,
  usePreviewStudyTemplate,
  usePreviewTaskEvaluation,
} from "@parfocal/api-client";
import { PdfPreview } from "@parfocal/ui/components/report-templates";
import { useEffect, useState } from "react";
import { okData } from "../placeholder.tsx";
import { fetchPdf, paperLabel, printFile, saveFile, svgSource } from "./pdf-file.ts";

type ViewerProps = {
  preview: ReportPreview | undefined;
  loading: boolean;
  failed: boolean;
  loadPdf: () => Promise<Blob>;
  onClose: () => void;
};

function PdfViewer({ preview, loading, failed, loadPdf, onClose }: ViewerProps) {
  const [page, setPage] = useState(1);
  const [fileFailed, setFileFailed] = useState(false);
  const pages = preview?.pages ?? [];
  const name = preview?.file_name ?? "report.pdf";
  const act = (use: (blob: Blob) => void) => () => {
    loadPdf().then(use, () => setFileFailed(true));
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
        renderPage={(number) => (
          <img
            src={svgSource(pages[number - 1] ?? "")}
            alt={`Page ${number} of the report`}
            className="block bg-white shadow-pop"
          />
        )}
        renderThumbnail={(number) => (
          <img
            src={svgSource(pages[number - 1] ?? "")}
            alt=""
            className="h-full w-full object-contain"
          />
        )}
        onPrint={act(printFile)}
        onDownload={act((blob) => saveFile(blob, name))}
        onClose={onClose}
      />
    </div>
  );
}

export function TaskPdfOverlay({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const query = usePreviewTaskEvaluation(taskId, undefined);
  const preview = okData(query.data);
  const url = getExportTaskEvaluationUrl(taskId, "report.pdf");
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
