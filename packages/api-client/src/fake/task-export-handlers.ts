import { HttpResponse, http, type RequestHandler } from "msw";
import { annotateStubTaskId } from "./scenario-review.ts";
import { taskHasSignedOffSlide } from "./shared-layer-handlers.ts";

const zipHeaders = (name: string) => ({
  "content-type": "application/zip",
  "content-disposition": `attachment; filename="${name}"`,
});

const cuttingPolls = 1;
const polled = new Map<string, number>();
const formats = new Map<string, string>();

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
      const body = (await request.json()) as { format?: string };
      const jobId = crypto.randomUUID();
      formats.set(jobId, body.format ?? "masks");
      return HttpResponse.json({ job_id: jobId }, { status: 202 });
    },
  ),
  http.get<{ taskId: string; jobId: string }>(
    "*/api/review-tasks/:taskId/patch-exports/:jobId/status",
    ({ params }) => {
      const seen = (polled.get(params.jobId) ?? 0) + 1;
      polled.set(params.jobId, seen);
      const state = seen <= cuttingPolls ? "cutting" : "done";
      return HttpResponse.json({ job_id: params.jobId, state });
    },
  ),
  http.get<{ taskId: string; jobId: string }>(
    "*/api/review-tasks/:taskId/patch-exports/:jobId",
    ({ params }) => {
      if ((polled.get(params.jobId) ?? 0) <= cuttingPolls) {
        return refused("patch-export-not-ready", "The patches of this task are still being cut");
      }
      const coco = formats.get(params.jobId) === "coco";
      return new HttpResponse(
        `PK fake patches of ${params.taskId}${coco ? " with annotations.json" : ""}`,
        {
          headers: zipHeaders("parfocal-AT-1-patches.zip"),
        },
      );
    },
  ),
];
