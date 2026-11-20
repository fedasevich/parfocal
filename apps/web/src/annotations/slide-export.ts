import { t } from "@lingui/core/macro";
import {
  getExportSlideObjectsUrl,
  ParfocalApiAnnotationExportsExportFormat,
} from "@parfocal/api-client";

export type SlideExportFormat =
  (typeof ParfocalApiAnnotationExportsExportFormat)[keyof typeof ParfocalApiAnnotationExportsExportFormat];

export type SlideExportChoice = {
  readonly format: SlideExportFormat;
  readonly label: string;
  readonly line: string;
};

export function slideExportChoices(): SlideExportChoice[] {
  return [
    {
      format: ParfocalApiAnnotationExportsExportFormat.geojson,
      label: t`GeoJSON`,
      line: t`Every drawn shape with its type and layer, readable by QuPath and most map tools`,
    },
    {
      format: ParfocalApiAnnotationExportsExportFormat.flatgeobuf,
      label: t`FlatGeobuf`,
      line: t`The same shapes in a compact binary file that opens fast with very many objects`,
    },
    {
      format: ParfocalApiAnnotationExportsExportFormat.parfocal,
      label: t`Parfocal JSON`,
      line: t`The shapes with their groups, notes and cell calls, which Parfocal can import again`,
    },
  ];
}

const fileNameOf = (response: Response, fallback: string) => {
  const header = response.headers.get("Content-Disposition") ?? "";
  return /filename="([^"]+)"/.exec(header)?.[1] ?? fallback;
};

export async function downloadSlideExport(
  slideId: string,
  format: SlideExportFormat,
  taskId: string | undefined,
): Promise<string | null> {
  const url = getExportSlideObjectsUrl(slideId, {
    format,
    ...(taskId === undefined ? {} : { task_id: taskId }),
  });
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) return null;
  return saveResponse(response, `parfocal-export.${format}`);
}

export async function saveResponse(response: Response, fallback: string): Promise<string> {
  const name = fileNameOf(response, fallback);
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
