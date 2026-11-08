import { HttpResponse, http, type RequestHandler } from "msw";
import {
  CaseRule,
  CasesFrom,
  Certainty,
  FileKind,
  IngestStatus,
  Outcome,
  PairBy,
  type ResultPairing,
  Rule,
  type SlideChoice,
  SlideOutcome,
  type SortedSlide,
  type Sorting,
  type SortingRequest,
  UploadKind,
  type UploadState,
  UploadStatus,
} from "../generated/api.ts";
import { cases, projects, slides, uuid } from "./scenario.ts";

const slideExtensions = new Set([
  "svs",
  "ndpi",
  "scn",
  "mrxs",
  "vms",
  "vmu",
  "bif",
  "tif",
  "tiff",
  "czi",
  "vsi",
  "qptiff",
  "isyntax",
  "dcm",
]);
const resultExtensions = new Set([
  "geojson",
  "json",
  "csv",
  "tsv",
  "png",
  "jpg",
  "jpeg",
  "parquet",
  "npy",
  "npz",
]);

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const stemOf = (path: string) => {
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
};
const extensionOf = (path: string) => {
  const name = nameOf(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
};

const kindOf = (path: string, given: FileKind | null | undefined): FileKind => {
  if (given) return given;
  if (slideExtensions.has(extensionOf(path))) return FileKind.slide;
  if (resultExtensions.has(extensionOf(path))) return FileKind.result;
  return FileKind.other;
};

const sameStem = (result: string, slide: string) => {
  const a = result.toLowerCase();
  const b = slide.toLowerCase();
  if (a === b) return true;
  return a.startsWith(b) && /[^a-z0-9]/.test(a.charAt(b.length));
};

const longest = (paths: string[]) =>
  paths.toSorted((a, b) => stemOf(b).length - stemOf(a).length)[0] ?? null;

const pairOf = (
  path: string,
  slidePaths: string[],
  by: PairBy,
): { slide: string | null; rule: Rule | null } => {
  if (by === PairBy.embedded) return { slide: null, rule: null };
  const stem = stemOf(path);
  const dir = dirOf(path);
  if (by === PairBy.auto) {
    const beside = longest(
      slidePaths.filter((slide) => dirOf(slide) === dir && sameStem(stem, stemOf(slide))),
    );
    if (beside !== null) return { slide: beside, rule: Rule["next-to-slide"] };
    const folder = nameOf(dir).toLowerCase();
    const inFolder = slidePaths.find(
      (slide) =>
        folder !== "" && dirOf(slide) === dirOf(dir) && stemOf(slide).toLowerCase() === folder,
    );
    if (inFolder !== undefined) return { slide: inFolder, rule: Rule["folder-named-like-slide"] };
  }
  const named = longest(slidePaths.filter((slide) => sameStem(stem, stemOf(slide))));
  return named === null ? { slide: null, rule: null } : { slide: named, rule: Rule["file-name"] };
};

const commonRoot = (paths: string[]) => {
  const first = paths[0]?.split("/")[0];
  if (first === undefined || first === "") return "";
  return paths.every((path) => path.includes("/") && path.split("/")[0] === first) ? first : "";
};

const sortFiles = (request: SortingRequest): Sorting => {
  const kinds = new Map(request.files.map((file) => [file.path, kindOf(file.path, file.kind)]));
  const paths = request.files.map((file) => file.path);
  const slidePaths = paths.filter((path) => kinds.get(path) === FileKind.slide);
  const root = commonRoot(paths);
  const deeper = slidePaths.some((path) => dirOf(path) !== "" && dirOf(path) !== root);
  const labelOf = (path: string): string | null => {
    const decision = request.slide_decisions?.find((item) => item.path === path);
    if (decision?.loose) return null;
    if (decision?.case) return decision.case;
    if (request.cases === CasesFrom.loose) return null;
    const dir = dirOf(path);
    if (dir === "" || (dir === root && deeper)) return null;
    return nameOf(dir);
  };
  const project = projects.find((candidate) => candidate.id === request.project_id);
  const slides: SortedSlide[] = slidePaths.map((path) => {
    const label = labelOf(path);
    const known =
      label === null
        ? undefined
        : cases.find((item) => item.label === label && item.project === project?.code);
    return {
      path,
      outcome: label === null ? SlideOutcome.loose : SlideOutcome["in-case"],
      case: label === null ? null : { label, case_id: known?.id ?? null },
      rule: label === null ? null : CaseRule.folder,
      duplicate_of: null,
    };
  });
  const results: ResultPairing[] = paths
    .filter((path) => kinds.get(path) === FileKind.result)
    .map((path) => {
      const picked = request.result_decisions?.find((item) => item.path === path);
      const found =
        picked?.slide_path != null
          ? { slide: picked.slide_path, rule: Rule.picked }
          : pairOf(path, slidePaths, request.by ?? PairBy.auto);
      return {
        path,
        outcome: found.slide === null ? Outcome.unmatched : Outcome.paired,
        slide: found.slide === null ? null : { path: found.slide, slide_id: null },
        rule: found.rule,
        certainty: found.slide === null ? null : Certainty.sure,
        candidates: [],
      };
    });
  const others = paths.filter((path) => kinds.get(path) === FileKind.other);
  return { slides, results, others, new_cases: [] };
};

const apply = (request: SortingRequest): Sorting => {
  const sorting = sortFiles(request);
  const project = projects.find((candidate) => candidate.id === request.project_id);
  if (project === undefined) return sorting;
  const fresh: string[] = [];
  for (const slide of sorting.slides) {
    if (slide.case === null) continue;
    const label = slide.case.label;
    let item = cases.find(
      (candidate) => candidate.label === label && candidate.project === project.code,
    );
    if (item === undefined) {
      item = {
        id: uuid(4, 100 + cases.length),
        label,
        project: project.code,
        specimen: "",
        folder: "",
      };
      cases.push(item);
      project.counts.cases += 1;
      fresh.push(label);
    }
    slide.case = { label, case_id: item.id };
  }
  return { ...sorting, new_cases: fresh };
};

const stateOf = (uploadId: string, choice: SlideChoice): UploadState => ({
  upload_id: uploadId,
  project_id: projects[0]?.id ?? "",
  case_id: null,
  kind: UploadKind.result,
  status: IngestStatus.uploading,
  upload_status: UploadStatus.open,
  job_id: null,
  step: null,
  slide_id: choice.slide_id ?? null,
  reason: null,
  failure_class: null,
  message: null,
  notices: [],
  result_format: null,
  slide_upload_id: choice.slide_upload_id ?? null,
  pairing_rule: Rule.picked,
  pairing_certainty: Certainty.sure,
  result_set_id: null,
});

const ingestLadder: { status: IngestStatus; step: string | null }[] = [
  { status: IngestStatus.waiting, step: null },
  { status: IngestStatus.processing, step: "tiles" },
  { status: IngestStatus.processing, step: "tissue" },
  { status: IngestStatus.processing, step: "results" },
  { status: IngestStatus.processing, step: "place" },
  { status: IngestStatus.processing, step: "place" },
  { status: IngestStatus.processing, step: "place" },
  { status: IngestStatus.ready, step: null },
];

const polls = new Map<string, number>();

const statusOf = (uploadId: string): UploadState => {
  const count = polls.get(uploadId) ?? 0;
  polls.set(uploadId, count + 1);
  const rung = ingestLadder[Math.min(count, ingestLadder.length - 1)];
  return {
    ...stateOf(uploadId, {}),
    kind: UploadKind.slide,
    upload_status: UploadStatus.completed,
    status: rung?.status ?? IngestStatus.ready,
    step: rung?.step ?? null,
    slide_id: slides[0]?.id ?? null,
  };
};

export const uploadHandlers = (): RequestHandler[] => [
  http.get<{ uploadId: string }>("*/api/uploads/:uploadId/status", ({ params }) =>
    HttpResponse.json(statusOf(params.uploadId)),
  ),
  http.post("*/api/uploads/sorting", async ({ request }) =>
    HttpResponse.json(sortFiles((await request.json()) as SortingRequest)),
  ),
  http.post("*/api/uploads/sorting/apply", async ({ request }) =>
    HttpResponse.json(apply((await request.json()) as SortingRequest)),
  ),
  http.put<{ uploadId: string }>("*/api/uploads/:uploadId/slide", async ({ params, request }) =>
    HttpResponse.json(stateOf(params.uploadId, (await request.json()) as SlideChoice)),
  ),
];
