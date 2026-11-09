export type BlockKind =
  | "headline-numbers"
  | "region-metrics"
  | "confusion-matrix"
  | "reviewer-agreement"
  | "disagreement-reasons"
  | "opinion-answers"
  | "worst-objects"
  | "slide-table"
  | "slide-figure"
  | "text"
  | "comparison"
  | "ai-changes";

export type EditorBlock = {
  id: string;
  kind: BlockKind;
  title: string;
  show_title: boolean;
  width: "full" | "half";
  page_break: boolean;
  [field: string]: unknown;
};

export type FormatSettings = {
  paper: "a4" | "letter";
  orientation: "portrait" | "landscape";
  text_size: "small" | "normal" | "large";
  logo: boolean;
  title: string;
  subtitle: string;
  running_header: boolean;
  page_numbers: "none" | "page" | "page-of";
  draft_watermark: boolean;
  signature: boolean;
  label_language: "en" | "cs" | "de";
  decimals: number;
  appendices: ("objects" | "decisions" | "methods")[];
  downloads: ("pdf" | "docx" | "html" | "decisions" | "objects" | "geojson" | "json")[];
};

export const defaultFormat: FormatSettings = {
  paper: "a4",
  orientation: "portrait",
  text_size: "normal",
  logo: true,
  title: "Evaluation report",
  subtitle: "{task} · {model} {version}",
  running_header: true,
  page_numbers: "page-of",
  draft_watermark: true,
  signature: true,
  label_language: "en",
  decimals: 2,
  appendices: ["objects"],
  downloads: ["pdf", "docx", "decisions", "objects", "geojson"],
};

export type BlockCopy = { name: string; shows: string };

export const blockCopy: Record<BlockKind, BlockCopy> = {
  "headline-numbers": { name: "Headline numbers", shows: "The metrics you pick, as tiles" },
  "region-metrics": {
    name: "Region metrics per slide",
    shows: "Sensitivity, precision and Dice on each slide",
  },
  "confusion-matrix": {
    name: "Cell type confusion matrix",
    shows: "What the AI said against the consensus",
  },
  "reviewer-agreement": {
    name: "Agreement between reviewers",
    shows: "Cohen's κ for regions, cells and the form",
  },
  "disagreement-reasons": { name: "Why reviewers disagreed", shows: "Reason codes, largest first" },
  "opinion-answers": { name: "Opinion answers", shows: "The questions you pick from the form" },
  "worst-objects": {
    name: "Objects, worst first",
    shows: "The objects reviewers disagreed with most",
  },
  "slide-table": {
    name: "Per-slide table",
    shows: "Objects, disagreements and time on each slide",
  },
  "slide-figure": {
    name: "Slide figure",
    shows: "An object on its slide with the reviewed layer",
  },
  text: { name: "Text", shows: "Methods, notes or a caption you write" },
  comparison: { name: "Compare two result sets", shows: "This task next to a second one" },
  "ai-changes": {
    name: "How the experts changed the AI",
    shows: "Confirmed, edited, deleted, unchecked and added objects per class",
  },
};

export const blockKinds = Object.keys(blockCopy) as BlockKind[];

const blockDefaults: Record<BlockKind, Record<string, unknown>> = {
  "headline-numbers": {
    metrics: ["sensitivity", "precision", "dice"],
    confidence_intervals: false,
  },
  "region-metrics": {
    columns: ["sensitivity", "precision", "dice"],
    sort_by: "dice",
    rows: null,
  },
  "confusion-matrix": { classes: null, values: "count" },
  "reviewer-agreement": { parts: ["regions", "cells", "form"] },
  "disagreement-reasons": { top: null, style: "bars" },
  "opinion-answers": { questions: null, style: "bars" },
  "worst-objects": { rows: 10, thumbnails: true },
  "slide-table": { columns: ["objects", "disagreements", "time"], sort_by: "disagreements" },
  "slide-figure": { slide_id: null, object_id: null, layers: ["ai", "reviewed"], caption: "" },
  text: { body: "" },
  comparison: { task_id: null, metrics: ["sensitivity", "precision", "dice"] },
  "ai-changes": { group_by: "class", people: true },
};

let counter = 0;

export const newBlockId = (kind: string) => {
  counter += 1;
  return `${kind}-${counter}`;
};

export function createBlock(kind: BlockKind): EditorBlock {
  return {
    id: newBlockId(kind),
    kind,
    title: blockCopy[kind].name,
    show_title: true,
    width: "full",
    page_break: false,
    ...structuredClone(blockDefaults[kind]),
  };
}

export function toEditorBlocks(blocks: readonly { kind: string; title: string }[]): EditorBlock[] {
  return blocks.map((block) => {
    const kind = block.kind as BlockKind;
    const base = createBlock(kind);
    return { ...base, ...structuredClone(block) } as EditorBlock;
  });
}

export function toApiBlocks(blocks: readonly EditorBlock[]): Record<string, unknown>[] {
  return blocks.map(({ id: _id, ...rest }) => structuredClone(rest));
}

export const insertionIndex = (blocks: readonly EditorBlock[], selected: string | null) => {
  const at = blocks.findIndex((block) => block.id === selected);
  return at < 0 ? blocks.length : at + 1;
};

export function addBlock(
  blocks: readonly EditorBlock[],
  kind: BlockKind,
  at: number,
): { blocks: EditorBlock[]; added: EditorBlock } {
  const added = createBlock(kind);
  const index = Math.max(0, Math.min(at, blocks.length));
  return { blocks: [...blocks.slice(0, index), added, ...blocks.slice(index)], added };
}

export function moveBlock(blocks: readonly EditorBlock[], id: string, step: -1 | 1) {
  const from = blocks.findIndex((block) => block.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= blocks.length) return [...blocks];
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

export function moveBlockTo(blocks: readonly EditorBlock[], id: string, at: number) {
  const from = blocks.findIndex((block) => block.id === id);
  if (from < 0) return [...blocks];
  const next = [...blocks];
  const [moved] = next.splice(from, 1);
  if (!moved) return [...blocks];
  const target = at > from ? at - 1 : at;
  next.splice(Math.max(0, Math.min(target, next.length)), 0, moved);
  return next;
}

export function duplicateBlock(blocks: readonly EditorBlock[], id: string) {
  const from = blocks.findIndex((block) => block.id === id);
  const source = blocks[from];
  if (!source) return { blocks: [...blocks], added: null };
  const added: EditorBlock = { ...structuredClone(source), id: newBlockId(source.kind) };
  return {
    blocks: [...blocks.slice(0, from + 1), added, ...blocks.slice(from + 1)],
    added,
  };
}

export function removeBlock(blocks: readonly EditorBlock[], id: string) {
  return blocks.filter((block) => block.id !== id);
}

export function setBlockField(
  blocks: readonly EditorBlock[],
  id: string,
  field: string,
  value: unknown,
) {
  return blocks.map((block) => (block.id === id ? { ...block, [field]: value } : block));
}

export function toggleIn<T>(values: readonly T[], value: T, order: readonly T[], keepOne: boolean) {
  const present = values.includes(value);
  if (present && keepOne && values.length === 1) return [...values];
  const next = present ? values.filter((item) => item !== value) : [...values, value];
  return order.filter((item) => next.includes(item));
}

export type PageOf = { blocks: EditorBlock[] };

export function paginate(blocks: readonly EditorBlock[]): PageOf[] {
  const pages: PageOf[] = [{ blocks: [] }];
  blocks.forEach((block, index) => {
    if (block.page_break && index > 0) pages.push({ blocks: [] });
    pages[pages.length - 1]?.blocks.push(block);
  });
  return pages;
}

export type FieldOption = { value: string; label: string };

export type BlockField =
  | { kind: "checks"; key: string; label: string; options: FieldOption[]; keepOne: boolean }
  | { kind: "select"; key: string; label: string; options: FieldOption[]; nullAs?: string }
  | { kind: "segment"; key: string; label: string; options: FieldOption[] }
  | { kind: "toggle"; key: string; label: string }
  | { kind: "text"; key: string; label: string; rows: number };

const metricOptions: FieldOption[] = [
  { value: "sensitivity", label: "Sensitivity" },
  { value: "precision", label: "Precision" },
  { value: "dice", label: "Dice" },
  { value: "kappa", label: "Cohen's κ" },
  { value: "cell-agreement", label: "Cells agreed" },
];

const rowCounts = (counts: number[], unit: string): FieldOption[] =>
  counts.map((count) => ({ value: String(count), label: `${count} ${unit}` }));

export const blockFields: Record<BlockKind, BlockField[]> = {
  "headline-numbers": [
    { kind: "checks", key: "metrics", label: "Metrics", options: metricOptions, keepOne: true },
    { kind: "toggle", key: "confidence_intervals", label: "95% confidence intervals" },
  ],
  "region-metrics": [
    {
      kind: "checks",
      key: "columns",
      label: "Columns",
      options: metricOptions.slice(0, 3),
      keepOne: true,
    },
    {
      kind: "select",
      key: "sort_by",
      label: "Order",
      options: [
        { value: "dice", label: "Lowest Dice first" },
        { value: "sensitivity", label: "Lowest sensitivity first" },
        { value: "precision", label: "Lowest precision first" },
      ],
    },
    {
      kind: "select",
      key: "rows",
      label: "Rows",
      nullAs: "all",
      options: [{ value: "all", label: "All slides" }, ...rowCounts([4, 6, 12], "slides")],
    },
  ],
  "confusion-matrix": [
    {
      kind: "segment",
      key: "values",
      label: "Cells show",
      options: [
        { value: "count", label: "Counts" },
        { value: "share", label: "Share of row" },
      ],
    },
  ],
  "reviewer-agreement": [
    {
      kind: "checks",
      key: "parts",
      label: "Agreement on",
      keepOne: true,
      options: [
        { value: "regions", label: "Regions" },
        { value: "cells", label: "Cells" },
        { value: "form", label: "Opinion form" },
      ],
    },
  ],
  "disagreement-reasons": [
    {
      kind: "select",
      key: "top",
      label: "Show",
      nullAs: "all",
      options: [
        { value: "all", label: "Every reason" },
        { value: "3", label: "Top 3" },
        { value: "5", label: "Top 5" },
      ],
    },
    {
      kind: "segment",
      key: "style",
      label: "As",
      options: [
        { value: "bars", label: "Bars" },
        { value: "table", label: "Table" },
      ],
    },
  ],
  "opinion-answers": [
    {
      kind: "segment",
      key: "style",
      label: "As",
      options: [
        { value: "bars", label: "Bars" },
        { value: "table", label: "Table" },
      ],
    },
  ],
  "worst-objects": [
    {
      kind: "select",
      key: "rows",
      label: "Rows",
      options: rowCounts([3, 6, 10, 20], "objects"),
    },
    { kind: "toggle", key: "thumbnails", label: "Thumbnail of each object" },
  ],
  "slide-table": [
    {
      kind: "checks",
      key: "columns",
      label: "Columns",
      keepOne: true,
      options: [
        { value: "objects", label: "Objects" },
        { value: "disagreements", label: "Disagreements" },
        { value: "time", label: "Review time" },
      ],
    },
    {
      kind: "select",
      key: "sort_by",
      label: "Order",
      options: [
        { value: "disagreements", label: "Most disagreements first" },
        { value: "objects", label: "Most objects first" },
        { value: "time", label: "Longest review first" },
      ],
    },
  ],
  "slide-figure": [
    {
      kind: "checks",
      key: "layers",
      label: "Layers",
      keepOne: true,
      options: [
        { value: "ai", label: "AI result" },
        { value: "reviewed", label: "Reviewed layer" },
      ],
    },
    { kind: "text", key: "caption", label: "Caption", rows: 3 },
  ],
  text: [{ kind: "text", key: "body", label: "Text", rows: 8 }],
  comparison: [
    {
      kind: "checks",
      key: "metrics",
      label: "Metrics",
      options: metricOptions,
      keepOne: true,
    },
  ],
  "ai-changes": [
    {
      kind: "segment",
      key: "group_by",
      label: "Group by",
      options: [
        { value: "class", label: "Class" },
        { value: "slide", label: "Slide" },
      ],
    },
    { kind: "toggle", key: "people", label: "Split by person" },
  ],
};

export const metricOrder = metricOptions.map((option) => option.value);

export function fieldValueText(field: BlockField, block: EditorBlock): string {
  const value = block[field.key];
  if (value === null || value === undefined)
    return field.kind === "select" ? (field.nullAs ?? "") : "";
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function selectedValue(field: BlockField, raw: string): unknown {
  if (field.kind === "select" && field.nullAs !== undefined && raw === field.nullAs) return null;
  if (field.kind === "select" && /^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export const paperSize = (format: Pick<FormatSettings, "paper" | "orientation">) => {
  const portrait = format.paper === "letter" ? { w: 216, h: 279 } : { w: 210, h: 297 };
  return format.orientation === "landscape" ? { w: portrait.h, h: portrait.w } : portrait;
};

export const appendixOptions: { value: FormatSettings["appendices"][number]; label: string }[] = [
  { value: "objects", label: "Every object with its full ID" },
  { value: "decisions", label: "Decisions with their comments" },
  { value: "methods", label: "How each metric is computed" },
];

export const downloadOptions: { value: FormatSettings["downloads"][number]; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word" },
  { value: "html", label: "Web page" },
  { value: "decisions", label: "Decisions as CSV" },
  { value: "objects", label: "Objects as CSV" },
  { value: "geojson", label: "GeoJSON" },
  { value: "json", label: "Evaluation JSON" },
];

export const sampleNumbers = {
  slides: 12,
  objects: 660,
  sensitivity: 0.86,
  precision: 0.81,
  dice: 0.77,
  kappa: 0.72,
  "cell-agreement": 0.83,
} as const;

export function sampleValue(metric: string, decimals: number) {
  const value = sampleNumbers[metric as keyof typeof sampleNumbers];
  return typeof value === "number" ? value.toFixed(decimals) : "";
}
