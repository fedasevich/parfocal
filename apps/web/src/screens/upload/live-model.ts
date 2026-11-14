import {
  type DropRecord,
  dirOf,
  extensionOf,
  type PairMode,
  pairResult,
  sortDrop,
  stemOf,
  totalBytes,
} from "../../upload/drop.ts";

export type LiveState = {
  removed: Record<string, true>;
  placed: Record<string, string>;
  left: Record<string, true>;
  duplicate: Record<string, "skip" | "keep">;
  pair: PairMode;
  cases: "names" | "loose";
  ruleOpen: boolean;
  shapeOpen: boolean;
  maxStep: number;
};

export const freshLiveState = (): LiveState => ({
  removed: {},
  placed: {},
  left: {},
  duplicate: {},
  pair: "auto",
  cases: "names",
  ruleOpen: false,
  shapeOpen: false,
  maxStep: 0,
});

export type LiveResult<T> = {
  item: T;
  slide: number | null;
  how: string;
  picked: boolean;
  left: boolean;
};

export function createLiveModel<T extends DropRecord>(items: readonly T[], state: LiveState) {
  const kept = items.filter((item) => !state.removed[item.path]);
  const sorted = sortDrop(kept);
  const slides = sorted.slides;
  const caseOf = (index: number) =>
    state.cases === "loose" ? null : (sorted.caseOf[index] ?? null);
  const results: LiveResult<T>[] = sorted.results.map((item) => {
    const target = state.placed[item.path];
    const pickedIndex =
      target === undefined ? -1 : slides.findIndex((slide) => slide.path === target);
    if (pickedIndex >= 0) {
      return { item, slide: pickedIndex, how: "Picked by you", picked: true, left: false };
    }
    const found = pairResult(item, slides, state.pair);
    return { item, ...found, picked: false, left: Boolean(state.left[item.path]) };
  });
  const unplaced = results.filter((result) => result.slide === null && !result.left);
  const leftOut = results.filter((result) => result.slide === null && result.left);
  const resultsOf = (slide: number) => results.filter((result) => result.slide === slide);
  const labels: (string | null)[] = [];
  slides.forEach((_, index) => {
    const label = caseOf(index);
    if (!labels.includes(label)) labels.push(label);
  });
  const groups = labels
    .toSorted((a, b) => (a === null ? 1 : b === null ? -1 : 0))
    .map((label) => ({
      label,
      slides: slides.map((_, index) => index).filter((index) => caseOf(index) === label),
    }));
  const empty = [...slides, ...results.map((result) => result.item)].filter(
    (item) => item.size === 0,
  );
  const dataFolderOf = (slide: DropRecord) => {
    const dir = dirOf(slide.path);
    return `${dir === "" ? "" : `${dir}/`}${stemOf(slide.path)}/`;
  };
  const needsDataFolder = (slide: DropRecord) =>
    extensionOf(slide.path) === "mrxs" &&
    !kept.some((item) => item.path.startsWith(dataFolderOf(slide)));
  const noDataFolder = slides.filter((slide) => slide.size > 0 && needsDataFolder(slide));
  const mrxsWaiting = noDataFolder.filter((slide) => !state.left[slide.path]);
  const mrxsLeftOut = noDataFolder.filter((slide) => state.left[slide.path]);
  const slideIsOut = (slide: DropRecord) =>
    noDataFolder.some((candidate) => candidate.path === slide.path);
  const uploadSlides = slides.filter((slide) => slide.size > 0 && !slideIsOut(slide));
  const uploadResults = results.filter((result) => {
    if (result.slide === null || result.item.size === 0) return false;
    const slide = slides[result.slide];
    return slide !== undefined && !slideIsOut(slide);
  });
  const matched = results.filter((result) => result.slide !== null).length;
  const caseCount = groups.filter((group) => group.label !== null).length;
  const looseCount = groups.find((group) => group.label === null)?.slides.length ?? 0;
  return {
    slides,
    results,
    others: sorted.others.filter(
      (item) =>
        !slides.some(
          (slide) =>
            extensionOf(slide.path) === "mrxs" && item.path.startsWith(dataFolderOf(slide)),
        ),
    ),
    groups,
    caseOf,
    resultsOf,
    unplaced,
    leftOut,
    empty,
    uploadSlides,
    uploadResults,
    matched,
    caseCount,
    looseCount,
    bytes: totalBytes(uploadSlides) + totalBytes(uploadResults.map((result) => result.item)),
    fileCount: uploadSlides.length + uploadResults.length,
    mrxsWaiting,
    mrxsLeftOut,
    dataFolderOf,
    problems: unplaced.length + empty.length + mrxsWaiting.length,
    canStart: uploadSlides.length > 0,
  };
}

export type LiveModel<T extends DropRecord = DropRecord> = ReturnType<typeof createLiveModel<T>>;
