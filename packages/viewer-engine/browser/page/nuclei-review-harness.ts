import {
  type CellRect,
  type ClassName,
  fadeAlpha,
  httpCellSource,
  isUnsureCall,
  outlineModeOverlays,
  PagedCells,
  type PagedStats,
} from "../../src/index.ts";

export interface ReviewConfig {
  readonly origin: string;
  readonly slideWidth: number;
  readonly slideHeight: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly galleryLimit: number;
  readonly awayViews: number;
  readonly vertexBudget: number;
}

export interface FadeCheck {
  readonly outlines: number;
  readonly polygons: number;
  readonly wrongAlphas: number;
  readonly distinctAlphas: number;
}

export interface ReviewedCell {
  readonly number: number;
  readonly decision: "agree" | "retype" | "not-a-nucleus";
  readonly top: number;
  readonly second: number;
  readonly probs: readonly number[];
}

export interface ReviewReport {
  readonly paged: boolean;
  readonly cells: number;
  readonly classes: number;
  readonly openMs: number;
  readonly firstViewMs: number;
  readonly galleryMs: number;
  readonly fadeFirst: FadeCheck;
  readonly fadeBack: FadeCheck;
  readonly gallery: number;
  readonly galleryAllUnsure: boolean;
  readonly galleryLeastSureFirst: boolean;
  readonly reviewed: readonly ReviewedCell[];
  readonly lookupsMatchedGallery: boolean;
  readonly firstChunkEvicted: boolean;
  readonly probsSurvivedEviction: boolean;
  readonly decisionsSurvivedEviction: boolean;
  readonly removedLeftGallery: boolean;
  readonly afterReview: PagedStats;
  readonly longestTaskMs: number;
}

export interface ReviewHarness {
  run(config: ReviewConfig): Promise<ReviewReport>;
  heldBytes(): number;
}

declare global {
  interface Window {
    reviewHarness: ReviewHarness;
  }
}

const classNames: readonly ClassName[] = ["tumor", "stroma", "immune", "other"];
const classNameOf = (index: number) => classNames[index] ?? null;

let open: PagedCells | null = null;

function checkFade(cells: PagedCells): FadeCheck {
  const outlines = cells.outlines(classNameOf);
  const [overlay] = outlineModeOverlays({ id: "review", mode: "fade", outlines });
  const colors = overlay?.shapes.polygons?.colors ?? new Uint8Array();
  const polygons = colors.length / 4;
  let wrongAlphas = 0;
  const distinct = new Set<number>();
  outlines.forEach((outline, index) => {
    const alpha = colors[index * 4 + 3] ?? -1;
    distinct.add(alpha);
    if (alpha !== Math.round(255 * fadeAlpha(outline.top))) wrongAlphas++;
  });
  return { outlines: outlines.length, polygons, wrongAlphas, distinctAlphas: distinct.size };
}

function liveClasses(cells: PagedCells, numbers: ReadonlySet<number>): Map<number, number> {
  const found = new Map<number, number>();
  cells.forEachLive((chunk, local, classIndex) => {
    const number = chunk.number[local] ?? 0;
    if (numbers.has(number)) found.set(number, classIndex);
  });
  return found;
}

async function run(config: ReviewConfig): Promise<ReviewReport> {
  const longTasks: number[] = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  }).observe({ entryTypes: ["longtask"] });

  const started = performance.now();
  const cells = await PagedCells.open(
    httpCellSource(`${config.origin}/summary`, (index) => `${config.origin}/chunk/${index}`),
    { vertexBudget: config.vertexBudget },
  );
  open = cells;
  const openMs = performance.now() - started;

  const centreX = config.slideWidth / 2;
  const centreY = config.slideHeight / 2;
  const view: CellRect = [
    centreX - config.viewWidth / 2,
    centreY - config.viewHeight / 2,
    centreX + config.viewWidth / 2,
    centreY + config.viewHeight / 2,
  ];
  const viewStart = performance.now();
  await cells.show(view);
  const firstViewMs = performance.now() - viewStart;
  const fadeFirst = checkFade(cells);
  const [resident] = cells.cache.chunks();
  const firstChunk = resident?.index ?? -1;

  const galleryStart = performance.now();
  const gallery = cells.unsureIn(view, config.galleryLimit);
  const galleryMs = performance.now() - galleryStart;
  const tops = gallery.map((cell) => cell.confidence?.top ?? 0);
  const galleryLeastSureFirst = tops.every(
    (top, index) => index === 0 || top >= (tops[index - 1] ?? 0),
  );
  const galleryAllUnsure = gallery.every(
    (cell) => cell.confidence !== null && isUnsureCall(cell.confidence.top, cell.confidence.second),
  );

  const decisions = ["agree", "retype", "not-a-nucleus"] as const;
  const reviewed: ReviewedCell[] = [];
  let lookupsMatchedGallery = true;
  for (const [index, item] of gallery.slice(0, 6).entries()) {
    const found = await cells.cell(item.number);
    const confidence = found?.confidence ?? null;
    if (
      found?.probs?.length !== cells.summary.classes ||
      confidence === null ||
      confidence.top !== item.confidence?.top ||
      confidence.second !== item.confidence?.second
    ) {
      lookupsMatchedGallery = false;
    }
    const decision = decisions[index % decisions.length] ?? "agree";
    if (decision === "retype") {
      const runnerUp = confidence?.shares.findIndex(
        (share, at) => at !== confidence.topClass && share === confidence.second,
      );
      cells.edits.promote(item.number, runnerUp ?? 0);
    }
    if (decision === "not-a-nucleus") cells.edits.remove(item.number);
    reviewed.push({
      number: item.number,
      decision,
      top: confidence?.top ?? -1,
      second: confidence?.second ?? -1,
      probs: [...(found?.probs ?? [])],
    });
  }

  for (let step = 0; step < config.awayViews; step++) {
    const left = (step % 2) * (config.slideWidth - config.viewWidth);
    const top = (Math.floor(step / 2) % 2) * (config.slideHeight - config.viewHeight);
    await cells.show([left, top, left + config.viewWidth, top + config.viewHeight]);
  }
  const firstChunkEvicted = !cells.cache.has(firstChunk);

  await cells.show(view);
  const fadeBack = checkFade(cells);
  let probsSurvivedEviction = true;
  for (const item of reviewed) {
    const again = await cells.cell(item.number);
    if (JSON.stringify([...(again?.probs ?? [])]) !== JSON.stringify(item.probs)) {
      probsSurvivedEviction = false;
    }
  }
  const classes = liveClasses(cells, new Set(reviewed.map((item) => item.number)));
  const decisionsSurvivedEviction = reviewed.every((item) => {
    if (item.decision === "not-a-nucleus") return !classes.has(item.number);
    if (item.decision === "retype")
      return classes.get(item.number) === cells.edits.classOf(item.number, -1);
    return classes.has(item.number);
  });
  const removed = new Set(
    reviewed.filter((item) => item.decision === "not-a-nucleus").map((item) => item.number),
  );
  const removedLeftGallery = !cells
    .unsureIn(view, config.galleryLimit)
    .some((item) => removed.has(item.number));

  return {
    paged: cells.paged,
    cells: cells.summary.count,
    classes: cells.summary.classes,
    openMs,
    firstViewMs,
    galleryMs,
    fadeFirst,
    fadeBack,
    gallery: gallery.length,
    galleryAllUnsure,
    galleryLeastSureFirst,
    reviewed,
    lookupsMatchedGallery,
    firstChunkEvicted,
    probsSurvivedEviction,
    decisionsSurvivedEviction,
    removedLeftGallery,
    afterReview: cells.stats(),
    longestTaskMs: Math.max(0, ...longTasks),
  };
}

window.reviewHarness = {
  run,
  heldBytes: () => open?.stats().heldBytes ?? 0,
};
