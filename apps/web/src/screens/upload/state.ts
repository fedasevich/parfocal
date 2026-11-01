import type { UploadBatch } from "@parfocal/api-client";

export type UploadScene =
  | "drop"
  | "empty"
  | "files"
  | "link"
  | "remote"
  | "check"
  | "allgood"
  | "progress"
  | "done"
  | "tray"
  | "viewer"
  | "api"
  | "dup"
  | "storagefull"
  | "unmatched"
  | "sourceoff";

export type PairRule = "auto" | "name" | "id";

export type UploadState = {
  removedSlides: Record<number, boolean>;
  removedResults: Record<number, boolean>;
  added: Record<number, boolean>;
  pair: PairRule;
  cases: "names" | "loose";
  ruleOpen: boolean;
  shapeOpen: boolean;
  placed: Record<number, number>;
  fixed: Record<number, boolean>;
  left: Record<number, boolean>;
  duplicate: "skip" | "replace";
  trimmed: boolean;
  unmatchedOut: boolean;
  sourceBack: boolean;
  openSteps: Record<number, boolean>;
  readMode: "place" | "copy";
  checked: { link: boolean; remote: boolean };
  leaveBare: boolean;
};

export const freshState = (): UploadState => ({
  removedSlides: {},
  removedResults: {},
  added: {},
  pair: "auto",
  cases: "names",
  ruleOpen: false,
  shapeOpen: false,
  placed: {},
  fixed: {},
  left: {},
  duplicate: "skip",
  trimmed: false,
  unmatchedOut: false,
  sourceBack: false,
  openSteps: { 1: true },
  readMode: "place",
  checked: { link: false, remote: false },
  leaveBare: false,
});

const allFixed = (batch: UploadBatch) =>
  Object.fromEntries(batch.problems.map((_, index) => [index, true]));

export function stateForScene(scene: UploadScene, batch: UploadBatch): UploadState {
  const state = freshState();
  if (scene === "check") return { ...state, placed: { 2: 2 } };
  if (scene === "allgood") return { ...state, placed: { 2: 2 }, fixed: allFixed(batch) };
  if (scene === "storagefull") return { ...state, placed: { 2: 2 }, fixed: allFixed(batch) };
  if (scene === "unmatched") return { ...state, fixed: allFixed(batch) };
  if (scene === "dup") return { ...state, placed: { 2: 2 } };
  if (scene === "link" || scene === "remote") {
    return { ...state, checked: { ...state.checked, [scene]: true } };
  }
  if (scene === "progress" || scene === "sourceoff" || scene === "done") {
    return { ...state, placed: { 2: 2 }, fixed: allFixed(batch) };
  }
  return state;
}

export const stepOf = (scene: UploadScene) =>
  scene === "check" || scene === "allgood" || scene === "storagefull" || scene === "unmatched"
    ? 1
    : scene === "progress" || scene === "sourceoff" || scene === "done"
      ? 2
      : 0;

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export const gb = (value: number) => `${value.toFixed(1)} GB`;

export const shortName = (name: string) => /_(A\d)_/.exec(name)?.[1] ?? name.replace(/\.\w+$/, "");

export const joinAnd = (items: string[]) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;

export function createUploadModel(batch: UploadBatch, state: UploadState) {
  const slideIn = (index: number) => !state.removedSlides[index];
  const resultIn = (index: number) => !state.removedResults[index];
  const addedIn = (index: number) => slideIn(index) && Boolean(state.added[index]);
  const problemIn = (index: number) => {
    const problem = batch.problems[index];
    return problem !== undefined && resultIn(problem.result);
  };
  const resultTo = (index: number) => {
    const placed = state.placed[index];
    if (placed !== undefined) return { slide: placed, how: "Picked by you", warn: null };
    const result = batch.results[index];
    return result ? result.pairings[state.pair] : { slide: null, how: "", warn: null };
  };
  const slides = batch.slides.map((_, index) => index).filter(slideIn);
  const results = batch.results.map((_, index) => index).filter(resultIn);
  const added = slides.filter(addedIn);
  const sizeGb = slides.reduce((sum, index) => sum + (batch.slides[index]?.size_gb ?? 0), 0);
  const resultCount = results.length + added.length;
  const leftOut = batch.problems
    .map((problem, index) => ({ problem, index }))
    .filter(({ problem, index }) => resultIn(problem.result) && state.left[index])
    .map(({ problem }) => problem.result);
  const matched = results.filter((index) => resultTo(index).slide !== null).length + added.length;
  const openProblems = batch.problems.filter(
    (_, index) => problemIn(index) && !state.fixed[index] && !state.left[index],
  ).length;
  const leftCount = Object.entries(state.left).filter(
    ([index, on]) => on && problemIn(Number(index)),
  ).length;
  const inCase = slides.filter((index) => batch.slides[index]?.case_label !== null);
  const loose = slides.filter((index) => batch.slides[index]?.case_label === null);
  const unmatched = results.filter((index) => resultTo(index).slide === null);
  const resultsOf = (slide: number) => [
    ...results
      .filter((index) => resultTo(index).slide === slide)
      .map((index) => ({ index, kind: "result" as const })),
    ...(addedIn(slide) ? [{ index: slide, kind: "added" as const }] : []),
  ];
  const openIn = (scene: UploadScene) => {
    if (scene === "unmatched") return resultTo(2).slide === null && !state.unmatchedOut ? 1 : 0;
    if (scene === "storagefull") return 0;
    return openProblems;
  };
  const withOf = (slide: number) =>
    [
      ...(slide < batch.results.length && resultIn(slide) && !leftOut.includes(slide)
        ? [batch.results[slide]?.name ?? ""]
        : []),
      ...(addedIn(slide) ? [batch.slides[slide]?.extra_result.name ?? ""] : []),
    ].join(" and ");
  const bare = slides.filter(
    (slide) =>
      !(slide < batch.results.length && resultIn(slide) && !leftOut.includes(slide)) &&
      !addedIn(slide),
  );
  return {
    slideIn,
    resultIn,
    addedIn,
    problemIn,
    resultTo,
    slides,
    results,
    added,
    sizeGb,
    resultCount,
    uploadingResults: resultCount - leftOut.length,
    files: slides.length + resultCount,
    matched,
    openProblems,
    leftCount,
    inCase,
    loose,
    unmatched,
    resultsOf,
    openIn,
    withOf,
    bare,
  };
}

export type UploadModel = ReturnType<typeof createUploadModel>;
