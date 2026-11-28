import { ExportKind, getExportTaskEvaluationUrl } from "@parfocal/api-client";
import { readerZone } from "../clinical-report/pdf-link.ts";

const kindOfFormat: Record<string, ExportKind> = {
  pdf: ExportKind.reportpdf,
  decisions: ExportKind.decisionscsv,
  objects: ExportKind.objectscsv,
  geojson: ExportKind.annotationsgeojson,
  json: ExportKind.annotationsjson,
};

export const hasExport = (format: string) => format in kindOfFormat;

export const exportUrl = (taskId: string, kind: ExportKind, zone: string = readerZone()) =>
  getExportTaskEvaluationUrl(taskId, kind, kind === ExportKind.reportpdf ? { zone } : undefined);

const fileNameOf = (response: Response, fallback: string) => {
  const header = response.headers.get("Content-Disposition") ?? "";
  return /filename="([^"]+)"/.exec(header)?.[1] ?? fallback;
};

export async function downloadExport(taskId: string, format: string): Promise<string | null> {
  const kind = kindOfFormat[format];
  if (kind === undefined) return null;
  const response = await fetch(exportUrl(taskId, kind), {
    credentials: "same-origin",
  });
  if (!response.ok) return null;
  const name = fileNameOf(response, kind);
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return name;
}
