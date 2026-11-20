import {
  type ApiResponse,
  apiFetch,
  type FileKind,
  type PairBy,
  type ProjectRoom,
  type ResultDecision,
  type SortedFile,
  type Sorting,
  type SortingRequest,
} from "@parfocal/api-client";
import type { LiveModel, LiveState } from "../screens/upload/live-model.ts";
import {
  type DroppedItem,
  type DropRecord,
  dirOf,
  isMirax,
  miraxFolderOf,
  type PairMode,
  uploadNameOf,
} from "./drop.ts";
import type { UploadEngine } from "./engine.ts";
import type { FileIdentity } from "./entries.ts";
import { zipStored } from "./zip.ts";

const postJson = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const sortDroppedFiles = (request: SortingRequest) =>
  apiFetch<ApiResponse<Sorting>>("/api/uploads/sorting", postJson(request));

const applyDroppedFiles = (request: SortingRequest) =>
  apiFetch<ApiResponse<Sorting>>("/api/uploads/sorting/apply", postJson(request));

const pairUploadWithSlide = (uploadId: string, choice: { slide_upload_id: string }) =>
  apiFetch<ApiResponse<unknown>>(`/api/uploads/${uploadId}/slide`, {
    ...postJson(choice),
    method: "PUT",
  });

export type PlaceInput = {
  projectId: string;
  slides: readonly DropRecord[];
  results: readonly { item: DropRecord; slide: number | null; picked: boolean; left: boolean }[];
  caseLabels: readonly (string | null)[];
  pair: PairMode;
  cases: "names" | "loose";
  duplicates: Readonly<Record<string, "skip" | "keep">>;
  heldBack: readonly string[];
};

export type SortDifference = { path: string; browser: string; server: string };

export const placeInputOf = (
  projectId: string,
  model: LiveModel<DroppedItem>,
  state: LiveState,
): PlaceInput => ({
  projectId,
  slides: model.slides,
  results: model.results.map((result) => ({
    item: result.item,
    slide: result.slide,
    picked: result.picked,
    left: result.left,
  })),
  caseLabels: model.slides.map((_, index) => model.caseOf(index)),
  pair: state.pair,
  cases: state.cases,
  duplicates: state.duplicate,
  heldBack: [...model.mrxsWaiting, ...model.mrxsLeftOut].map((slide) => slide.path),
});

const byOf = (mode: PairMode): PairBy => (mode === "id" ? "embedded" : mode);

const fileOf = (record: DropRecord, kind: FileKind): SortedFile => ({
  path: record.path,
  kind,
  ...(record.size > 0 ? { size: record.size } : {}),
});

export function sortingRequestOf(input: PlaceInput, final = false): SortingRequest {
  const results = input.results.filter((result) => !result.left);
  const decisions: ResultDecision[] = results.flatMap((result) => {
    const slide = result.slide === null ? undefined : input.slides[result.slide];
    return result.picked && slide !== undefined
      ? [{ path: result.item.path, slide_path: slide.path }]
      : [];
  });
  return {
    project_id: input.projectId,
    cases: input.cases,
    by: byOf(input.pair),
    files: [
      ...input.slides.map((slide) => fileOf(slide, "slide")),
      ...results.map((result) => fileOf(result.item, "result")),
    ],
    result_decisions: decisions,
    slide_decisions: input.slides.flatMap((slide, index) => {
      const choice = input.duplicates[slide.path];
      const keep = choice === undefined ? {} : { keep: choice === "keep" };
      if (!final) return choice === undefined ? [] : [{ path: slide.path, ...keep }];
      const label = input.cases === "loose" ? null : (input.caseLabels[index] ?? null);
      return [
        label === null
          ? { path: slide.path, loose: true, ...keep }
          : { path: slide.path, case: label, ...keep },
      ];
    }),
  };
}

export function compareSorting(input: PlaceInput, server: Sorting): SortDifference[] {
  const differences: SortDifference[] = [];
  input.slides.forEach((slide, index) => {
    const found = server.slides.find((candidate) => candidate.path === slide.path);
    const browser = input.cases === "loose" ? null : (input.caseLabels[index] ?? null);
    if (found === undefined) {
      differences.push({ path: slide.path, browser: caseText(browser), server: "Not seen" });
      return;
    }
    if (found.outcome === "left-out" || found.duplicate_of !== null) return;
    const there = found.case?.label ?? null;
    if (there !== browser) {
      differences.push({ path: slide.path, browser: caseText(browser), server: caseText(there) });
    }
  });
  if (input.pair === "id") return differences;
  for (const result of input.results) {
    if (result.left) continue;
    const found = server.results.find((candidate) => candidate.path === result.item.path);
    const browser = result.slide === null ? null : (input.slides[result.slide]?.path ?? null);
    const paired = found?.slide ?? null;
    const there = paired === null ? null : paired.path;
    if (paired !== null && paired.path === null) {
      differences.push({
        path: result.item.path,
        browser: slideText(browser),
        server: "A slide already in the project",
      });
    } else if (there !== browser) {
      differences.push({
        path: result.item.path,
        browser: slideText(browser),
        server: slideText(there),
      });
    }
  }
  return differences;
}

const caseText = (label: string | null) => (label === null ? "Loose, no case" : `Case ${label}`);

const slideText = (path: string | null) => (path === null ? "No slide" : `Slide ${path}`);

export type SortCheck = {
  differences: SortDifference[];
  duplicates: Duplicate[];
  room: ProjectRoom;
};

export type Shortfall = { needed: number; left: number; allowance: number };

export function shortfallOf(room: ProjectRoom | null): Shortfall | null {
  if (room === null || room.allowance_bytes === null) return null;
  const left = Math.max(0, room.allowance_bytes - room.used_bytes);
  return room.needed_bytes > left
    ? { needed: room.needed_bytes, left, allowance: room.allowance_bytes }
    : null;
}

export type Duplicate = { path: string; of: string };

export function duplicatesOf(server: Sorting): Duplicate[] {
  return server.slides.flatMap((slide) =>
    slide.duplicate_of === null ? [] : [{ path: slide.path, of: slide.duplicate_of }],
  );
}

export async function checkSorting(input: PlaceInput): Promise<SortCheck> {
  const response = await sortDroppedFiles(sortingRequestOf(input));
  return {
    differences: compareSorting(input, response.data),
    duplicates: duplicatesOf(response.data),
    room: response.data.room,
  };
}

type Waiting = { promise: Promise<string | null>; settle: (uploadId: string | null) => void };

function waiting(): Waiting {
  let settle: (uploadId: string | null) => void = () => undefined;
  const promise = new Promise<string | null>((done) => {
    settle = done;
  });
  return { promise, settle };
}

const WAIT_MS = 60_000;

export async function placeAndUpload(
  engine: UploadEngine,
  input: PlaceInput,
  items: readonly DroppedItem[],
  onPlaced: (identities: FileIdentity[]) => void,
): Promise<void> {
  const response = await applyDroppedFiles(sortingRequestOf(input, true));
  const sorting = response.data;
  const packed = new Map<string, DroppedItem>();
  const itemOf = (path: string) => packed.get(path) ?? items.find((item) => item.path === path);
  const caseIds = new Map<string, string | null>();
  const slideItems: DroppedItem[] = [];
  for (const slide of input.slides) {
    const sorted = sorting.slides.find((candidate) => candidate.path === slide.path);
    const item = itemOf(slide.path);
    if (item === undefined || slide.size === 0) continue;
    if (sorted?.outcome === "left-out") continue;
    if (input.heldBack.includes(slide.path)) continue;
    caseIds.set(slide.path, sorted?.case?.case_id ?? null);
    slideItems.push(item);
  }
  for (const [index, slide] of slideItems.entries()) {
    if (!isMirax(slide.path)) continue;
    const folder = miraxFolderOf(slide.path);
    const base = dirOf(slide.path) === "" ? 0 : dirOf(slide.path).length + 1;
    const sources = [
      { name: slide.path.slice(base), file: slide.file },
      ...items
        .filter((item) => item.path.startsWith(folder))
        .map((item) => ({ name: item.path.slice(base), file: item.file })),
    ];
    const file = await zipStored(sources, uploadNameOf(slide.path));
    const zipped = { path: slide.path, size: file.size, file };
    packed.set(slide.path, zipped);
    slideItems[index] = zipped;
  }
  const resultItems: { item: DroppedItem; slide: DroppedItem }[] = [];
  for (const result of input.results) {
    const slide = result.slide === null ? undefined : input.slides[result.slide];
    const item = itemOf(result.item.path);
    const slideItem = slide === undefined ? undefined : itemOf(slide.path);
    if (item === undefined || slideItem === undefined || result.item.size === 0) continue;
    if (!caseIds.has(slideItem.path)) continue;
    caseIds.set(item.path, caseIds.get(slideItem.path) ?? null);
    resultItems.push({ item, slide: slideItem });
  }
  onPlaced(
    [...slideItems, ...resultItems.map((result) => result.item)].map((item) => ({
      projectId: input.projectId,
      caseId: caseIds.get(item.path) ?? null,
      name: item.file.name,
      size: item.file.size,
      lastModified: item.file.lastModified,
    })),
  );
  const waits = new Map<Blob, Waiting>();
  const wait = (file: Blob) => {
    let found = waits.get(file);
    if (found === undefined) {
      found = waiting();
      waits.set(file, found);
      const mine = found;
      setTimeout(() => mine.settle(null), WAIT_MS);
    }
    return found;
  };
  const add = (item: DroppedItem) => {
    wait(item.file);
    return engine.addFiles(
      [item.file],
      { projectId: input.projectId, caseId: caseIds.get(item.path) ?? null },
      (uploadId) => wait(item.file).settle(uploadId),
    );
  };
  for (const item of slideItems) await add(item);
  const links: Promise<void>[] = [];
  for (const result of resultItems) {
    await add(result.item);
    links.push(link(wait(result.item.file).promise, wait(result.slide.file).promise));
  }
  await Promise.all(links);
}

async function link(result: Promise<string | null>, slide: Promise<string | null>) {
  const [resultId, slideId] = await Promise.all([result, slide]);
  if (resultId === null || slideId === null) return;
  await pairUploadWithSlide(resultId, { slide_upload_id: slideId }).catch(() => undefined);
}
