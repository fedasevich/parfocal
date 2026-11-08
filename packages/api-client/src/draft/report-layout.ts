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
