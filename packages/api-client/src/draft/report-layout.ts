import { z } from "zod";

export const ReportBlockKind = {
  headline: "headline-numbers",
  regions: "region-metrics",
  confusion: "confusion-matrix",
  agreement: "reviewer-agreement",
  reasons: "disagreement-reasons",
  opinions: "opinion-answers",
  worst: "worst-objects",
  slides: "slide-table",
  figure: "slide-figure",
  text: "text",
  comparison: "comparison",
  aiChanges: "ai-changes",
} as const;

export const reportBlockSchema = z.object({
  kind: z.enum(ReportBlockKind),
  title: z.string(),
  width: z.enum(["full", "half"]),
  show_title: z.boolean().default(true),
  page_break: z.boolean().default(false),
  metrics: z.array(z.string()).optional(),
  columns: z.array(z.string()).optional(),
  rows: z.number().int().nullable().optional(),
  top: z.number().int().nullable().optional(),
  body: z.string().optional(),
  caption: z.string().optional(),
  slide_id: z.string().nullable().optional(),
  object_id: z.string().nullable().optional(),
  task_id: z.string().nullable().optional(),
});

export type EvaluationReportBlock = z.infer<typeof reportBlockSchema>;

export const reportFormatSchema = z.object({
  paper: z.enum(["a4", "letter"]).default("a4"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  text_size: z.enum(["small", "normal", "large"]).default("normal"),
  running_header: z.boolean().default(true),
  page_numbers: z.enum(["none", "page", "page-of"]).default("page-of"),
  draft_watermark: z.boolean().default(true),
  signature: z.boolean().default(true),
  label_language: z.enum(["en", "cs", "de"]).default("en"),
  decimals: z.number().int().min(0).max(4).default(2),
  appendices: z.array(z.enum(["objects", "decisions", "methods"])).default(["objects"]),
});

export type EvaluationReportFormat = z.infer<typeof reportFormatSchema>;

export type LayoutBlock = {
  kind: string;
  width?: "full" | "half" | undefined;
  page_break?: boolean | undefined;
};

export type LayoutFormat = {
  paper?: "a4" | "letter" | undefined;
  orientation?: "portrait" | "landscape" | undefined;
  text_size?: "small" | "normal" | "large" | undefined;
  appendices?: readonly ("objects" | "decisions" | "methods")[] | undefined;
};

export type LayoutPage = {
  rows: number[][];
  closing: boolean;
  appendix: "objects" | "decisions" | "methods" | null;
};

const pageUnits: Record<string, number> = {
  "a4 portrait": 24,
  "a4 landscape": 16,
  "letter portrait": 23,
  "letter landscape": 17,
};

const textScale: Record<string, number> = { small: 1.25, normal: 1, large: 0.8 };

export const blockUnits: Record<string, number> = {
  "headline-numbers": 4,
  "region-metrics": 5,
  "confusion-matrix": 6,
  "reviewer-agreement": 4,
  "disagreement-reasons": 4,
  "opinion-answers": 4,
  "worst-objects": 7,
  "slide-table": 5,
  "slide-figure": 7,
  text: 3,
  comparison: 4,
  "ai-changes": 5,
};

const firstPageUnits = 5;
const closingUnits = 5;

export function reportPages(blocks: readonly LayoutBlock[], format: LayoutFormat): LayoutPage[] {
  const paper = format.paper ?? "a4";
  const orientation = format.orientation ?? "portrait";
  const capacity = Math.floor(
    (pageUnits[`${paper} ${orientation}`] ?? 24) * (textScale[format.text_size ?? "normal"] ?? 1),
  );
  const pages: LayoutPage[] = [];
  let rows: number[][] = [];
  let used = firstPageUnits;
  const turn = (closing = false) => {
    pages.push({ rows, closing, appendix: null });
    rows = [];
    used = 0;
  };
  const place = (height: number, freshPage: boolean) => {
    if (rows.length > 0 && (freshPage || used + height > capacity)) turn();
  };
  let at = 0;
  while (at < blocks.length) {
    const block = blocks[at] as LayoutBlock;
    const following = blocks[at + 1];
    const row =
      block.width === "half" && following?.width === "half" && !following.page_break
        ? [at, at + 1]
        : [at];
    const height = Math.max(...row.map((index) => blockUnits[blocks[index]?.kind ?? ""] ?? 4));
    place(height, block.page_break === true);
    rows.push(row);
    used += height;
    at += row.length;
  }
  place(closingUnits, false);
  turn(true);
  return [
    ...pages,
    ...(format.appendices ?? ["objects"]).map((appendix) => ({
      rows: [],
      closing: false,
      appendix,
    })),
  ];
}
