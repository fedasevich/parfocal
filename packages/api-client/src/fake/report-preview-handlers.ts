import { HttpResponse, http, type RequestHandler } from "msw";
import { type LayoutBlock, type LayoutFormat, reportPages } from "../draft/report-layout.ts";
import { toEvaluationReport } from "./adjudication-handlers.ts";
import { listedStudyTemplates } from "./task-handlers.ts";

const sizes: Record<string, [number, number]> = { a4: [595, 842], letter: [612, 792] };
const PREVIEW_PAGES = 4;
const emptyPdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n";

type PreviewDraft = { name: string; blocks: LayoutBlock[]; format?: LayoutFormat };

const svgPage = (title: string, page: number, pages: number, format: LayoutFormat) => {
  const [short, long] = sizes[format.paper ?? "a4"] ?? [595, 842];
  const landscape = format.orientation === "landscape";
  const width = landscape ? long : short;
  const height = landscape ? short : long;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="57" y="80" font-size="22" font-family="sans-serif">${title}</text>`,
    `<text x="57" y="${height - 40}" font-size="10" font-family="sans-serif">${page} / ${pages}</text>`,
    "</svg>",
  ].join("");
};

const previewOf = (
  fileName: string,
  title: string,
  blocks: LayoutBlock[],
  format: LayoutFormat,
) => {
  const count = Math.max(1, reportPages(blocks, format).length);
  return {
    title,
    file_name: fileName,
    paper: format.paper ?? "a4",
    orientation: format.orientation ?? "portrait",
    page_count: count,
    sample: false,
    pages: Array.from({ length: count }, (_, index) => svgPage(title, index + 1, count, format)),
  };
};

const safeStem = (name: string) =>
  name
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .concat("") || "template";

export function reportPreviewHandlers(): RequestHandler[] {
  return [
    http.get<{ taskId: string }>(
      "*/api/review-tasks/:taskId/evaluation/preview",
      ({ params, request }) => {
        const report = toEvaluationReport(params.taskId);
        const search = new URL(request.url).searchParams;
        const offset = Number(search.get("offset") ?? 0);
        const limit = Number(search.get("limit") ?? PREVIEW_PAGES);
        const whole = previewOf(
          `evaluation_v${report.version}_report.pdf`,
          `${report.task_code} evaluation`,
          report.template.blocks,
          report.template.format,
        );
        return HttpResponse.json({
          ...whole,
          offset,
          pages: whole.pages.slice(offset, offset + limit),
        });
      },
    ),
    http.get("*/api/study-templates/:templateId/preview", ({ params }) => {
      const template = listedStudyTemplates().find((item) => item.id === params.templateId);
      if (!template) return HttpResponse.json({ status: 404, title: "Not found" }, { status: 404 });
      return HttpResponse.json({
        ...previewOf(
          `${safeStem(template.name)}_sample.pdf`,
          template.name,
          template.blocks,
          template.format ?? {},
        ),
        sample: true,
      });
    }),
    http.get("*/api/study-templates/:templateId/preview/pdf", () =>
      HttpResponse.text(emptyPdf, { headers: { "content-type": "application/pdf" } }),
    ),
    http.post("*/api/study-templates/preview/pdf", () =>
      HttpResponse.text(emptyPdf, { headers: { "content-type": "application/pdf" } }),
    ),
    http.post("*/api/study-templates/preview", async ({ request }) => {
      const draft = (await request.json()) as PreviewDraft;
      return HttpResponse.json({
        ...previewOf(
          `${safeStem(draft.name)}_sample.pdf`,
          draft.name,
          draft.blocks,
          draft.format ?? {},
        ),
        sample: true,
      });
    }),
    http.get("*/api/review-tasks/:taskId/evaluation/exports/report.pdf", () =>
      HttpResponse.text(emptyPdf, { headers: { "content-type": "application/pdf" } }),
    ),
  ];
}
