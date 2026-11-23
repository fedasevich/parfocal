import { HttpResponse, http, type RequestHandler } from "msw";
import { annotateStubTaskId } from "./scenario-review.ts";
import { taskHasSignedOffSlide } from "./shared-layer-handlers.ts";

const zipHeaders = (name: string) => ({
  "content-type": "application/zip",
  "content-disposition": `attachment; filename="${name}"`,
});

const cuttingPolls = 1;
const storageKey = "parfocal.fake.patch-exports";

type StoredExport = {
  job_id: string;
  task_id: string;
  format: "masks" | "coco";
  dataset_version: number | null;
  polls: number;
  started_at: string;
  finished_at: string | null;
};

let memory: StoredExport[] = [];

const session = (): Storage | null =>
  typeof sessionStorage === "undefined" ? null : sessionStorage;

function readExports(): StoredExport[] {
  const stored = session()?.getItem(storageKey);
  if (stored === null || stored === undefined) return memory;
  return JSON.parse(stored) as StoredExport[];
}

function writeExports(next: StoredExport[]): void {
  memory = next;
  session()?.setItem(storageKey, JSON.stringify(next));
}

const exportOf = (jobId: string) => readExports().find((item) => item.job_id === jobId);

const pollOnce = (jobId: string): StoredExport | undefined => {
  const all = readExports();
  const found = all.find((item) => item.job_id === jobId);
  if (found === undefined) return undefined;
  found.polls += 1;
  if (found.polls > cuttingPolls && found.finished_at === null) {
    found.finished_at = new Date().toISOString();
  }
  writeExports(all);
  return found;
};

const entryOf = (item: StoredExport) => ({
  job_id: item.job_id,
  started_by: "Dana Hale",
  dataset_version: item.dataset_version,
  format: item.format,
  state: item.finished_at === null ? "cutting" : "done",
  bytes: item.finished_at === null ? null : 48_213,
  started_at: item.started_at,
  finished_at: item.finished_at,
});

const refused = (code: string, title: string) =>
  HttpResponse.json(
    { type: `https://parfocal.eu/problems/${code}`, title, status: 409, code },
    { status: 409, headers: { "content-type": "application/problem+json" } },
  );

const nothingSignedOff = () =>
  refused(
    "nothing-signed-off",
    "Sign off at least one slide of this task before exporting the dataset",
  );

const unsigned = (taskId: string) =>
  taskId === annotateStubTaskId && !taskHasSignedOffSlide(taskId);

export const taskExportHandlers = (): RequestHandler[] => [
  http.get<{ taskId: string }>("*/api/review-tasks/:taskId/training-dataset", ({ params }) => {
    if (unsigned(params.taskId)) return nothingSignedOff();
    return new HttpResponse(`PK fake training dataset of ${params.taskId}`, {
      headers: zipHeaders("parfocal-AT-1-dataset.zip"),
    });
  }),
  http.post<{ taskId: string }>(
    "*/api/review-tasks/:taskId/patch-exports",
    async ({ params, request }) => {
      if (unsigned(params.taskId)) return nothingSignedOff();
      const body = (await request.json()) as { format?: string; dataset_version?: number };
      const jobId = crypto.randomUUID();
      writeExports([
        ...readExports(),
        {
          job_id: jobId,
          task_id: params.taskId,
          format: body.format === "coco" ? "coco" : "masks",
          dataset_version: body.dataset_version ?? null,
          polls: 0,
          started_at: new Date().toISOString(),
          finished_at: null,
        },
      ]);
      return HttpResponse.json({ job_id: jobId }, { status: 202 });
    },
  ),
  http.get<{ taskId: string }>("*/api/review-tasks/:taskId/patch-exports", ({ params }) =>
    HttpResponse.json(
      readExports()
        .filter((item) => item.task_id === params.taskId)
        .reverse()
        .map(entryOf),
    ),
  ),
  http.get<{ taskId: string; jobId: string }>(
    "*/api/review-tasks/:taskId/patch-exports/:jobId/status",
    ({ params }) => {
      const state = pollOnce(params.jobId)?.finished_at === null ? "cutting" : "done";
      return HttpResponse.json({ job_id: params.jobId, state });
    },
  ),
  http.get<{ taskId: string; jobId: string }>(
    "*/api/review-tasks/:taskId/patch-exports/:jobId",
    ({ params }) => {
      const found = exportOf(params.jobId);
      if (found === undefined || found.finished_at === null) {
        return refused("patch-export-not-ready", "The patches of this task are still being cut");
      }
      const coco = found.format === "coco";
      return new HttpResponse(
        `PK fake patches of ${params.taskId}${coco ? " with annotations.json" : ""}`,
        {
          headers: zipHeaders("parfocal-AT-1-patches.zip"),
        },
      );
    },
  ),
];
