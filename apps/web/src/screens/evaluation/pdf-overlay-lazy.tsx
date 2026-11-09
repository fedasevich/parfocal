import type { TemplatePreviewDraft } from "@parfocal/api-client";
import { lazy, Suspense } from "react";

const TaskOverlay = lazy(async () => ({
  default: (await import("./pdf-overlay.tsx")).TaskPdfOverlay,
}));
const TemplateOverlay = lazy(async () => ({
  default: (await import("./pdf-overlay.tsx")).TemplatePdfOverlay,
}));

const SavedTemplateOverlay = lazy(async () => ({
  default: (await import("./pdf-overlay.tsx")).SavedTemplatePdfOverlay,
}));

export function LazySavedTemplatePdf({
  templateId,
  onClose,
}: {
  templateId: string;
  onClose: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <SavedTemplateOverlay templateId={templateId} onClose={onClose} />
    </Suspense>
  );
}

export function LazyTaskPdf({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  return (
    <Suspense fallback={null}>
      <TaskOverlay taskId={taskId} onClose={onClose} />
    </Suspense>
  );
}

export function LazyTemplatePdf({
  draft,
  onClose,
}: {
  draft: TemplatePreviewDraft;
  onClose: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <TemplateOverlay draft={draft} onClose={onClose} />
    </Suspense>
  );
}
