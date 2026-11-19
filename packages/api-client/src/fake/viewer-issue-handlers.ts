import { HttpResponse, http, type RequestHandler } from "msw";
import { toReviewObjects } from "./review-handlers.ts";
import { fakeViewerIssue } from "./viewer-scene.ts";
import { reviewTaskDetailOf } from "./work-handlers.ts";

const taskGone = () =>
  HttpResponse.json(
    { type: "about:blank", title: "Review task not found", status: 404, code: "not-found" },
    { status: 404 },
  );

export const viewerIssueHandlers = (): RequestHandler[] => [
  http.get<{ taskId: string }>("*/api/review-tasks/:taskId", ({ params }) => {
    const issue = fakeViewerIssue();
    if (issue === "withdrawn") return taskGone();
    if (issue !== "noresults") return undefined;
    const detail = reviewTaskDetailOf(params.taskId);
    return HttpResponse.json({
      ...detail,
      slides: detail.slides.map((slide) => ({ ...slide, result_set_id: null })),
    });
  }),
  http.get<{ taskId: string; slideId: string }>(
    "*/api/review-tasks/:taskId/slides/:slideId/objects",
    ({ params }) =>
      fakeViewerIssue() === "noresults"
        ? HttpResponse.json({ ...toReviewObjects(params.taskId, params.slideId), objects: [] })
        : undefined,
  ),
];
