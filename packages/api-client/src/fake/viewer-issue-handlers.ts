import { HttpResponse, http, type RequestHandler } from "msw";
import { problemMediaType } from "../problem.ts";
import { projectSlideRows, toSlideResultSets } from "./project-handlers.ts";
import { toReviewObjects } from "./review-handlers.ts";
import { fakeViewerIssue } from "./viewer-scene.ts";
import { reviewTaskDetailOf } from "./work-handlers.ts";

export const fakeWithdrawnAt = "2026-10-16T09:30:00Z";

const taskWithdrawn = () =>
  HttpResponse.json(
    {
      type: "about:blank",
      title: "The task was withdrawn. There is nothing left to decide",
      status: 409,
      code: "task-withdrawn",
    },
    { status: 409 },
  );

const orderNotReady = () =>
  HttpResponse.json(
    {
      type: "about:blank",
      title: "The review order of this slide is still being prepared",
      status: 409,
      code: "review-order-not-ready",
    },
    { status: 409, headers: { "content-type": problemMediaType } },
  );

export const viewerIssueHandlers = (): RequestHandler[] => [
  http.get<{ taskId: string }>("*/api/review-tasks/:taskId", ({ params }) => {
    const issue = fakeViewerIssue();
    if (issue !== "noresults" && issue !== "withdrawn") return undefined;
    const detail = reviewTaskDetailOf(params.taskId);
    if (issue === "withdrawn") {
      return HttpResponse.json({
        ...detail,
        withdrawn_at: fakeWithdrawnAt,
        withdrawn_by_user_id: detail.created_by_user_id,
      });
    }
    return HttpResponse.json({
      ...detail,
      slides: detail.slides.map((slide) => ({ ...slide, result_set_id: null })),
    });
  }),
  http.put("*/api/review-tasks/:taskId/slides/:slideId/decisions/:objectId", () =>
    fakeViewerIssue() === "withdrawn" ? taskWithdrawn() : undefined,
  ),
  http.get<{ taskId: string; slideId: string }>(
    "*/api/review-tasks/:taskId/slides/:slideId/objects",
    ({ params }) =>
      fakeViewerIssue() === "preparing"
        ? orderNotReady()
        : fakeViewerIssue() === "noresults" || fakeViewerIssue() === "empty"
          ? HttpResponse.json({ ...toReviewObjects(params.taskId, params.slideId), objects: [] })
          : undefined,
  ),
  http.get("*/api/me/slides", ({ request }) => {
    const projectId = new URL(request.url).searchParams.get("project_id");
    if (fakeViewerIssue() !== "slidefail" || !projectId) return undefined;
    return HttpResponse.json({
      slides: projectSlideRows(projectId).map((slide) => ({
        ...slide,
        high_power_unreadable: true,
      })),
      next_cursor: null,
    });
  }),
  http.get<{ slideId: string }>("*/api/slides/:slideId/result-sets", ({ params }) => {
    const issue = fakeViewerIssue();
    if (issue !== "importing" && issue !== "importfail") return undefined;
    return HttpResponse.json(
      toSlideResultSets(params.slideId).map((set, index) =>
        index > 0
          ? set
          : issue === "importing"
            ? { ...set, status: "importing" as const }
            : { ...set, status: "failed" as const, error_code: "geometry-unreadable" },
      ),
    );
  }),
  http.post(
    "*/api/slides/:slideId/high-power-failure",
    () => new HttpResponse(null, { status: 204 }),
  ),
];
