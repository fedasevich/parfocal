import { HttpResponse, http } from "msw";
import { type SlideAiProgress, slideAiProgressSchema } from "../draft/get-slide-ai-progress.ts";
import { type SlideResultStats, slideResultStatsSchema } from "../draft/get-slide-result-stats.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { reviewsA1 } from "./review-verdicts.ts";
import { people, resultSets } from "./scenario.ts";
import {
  aiAgainstReviewed,
  aiStillReading,
  classCounts,
  modelAgainstModel,
  objectsOnA1,
  reviewerAgainstReviewer,
  scoreBins,
} from "./scenario-viewer.ts";
import { fakeViewerScene } from "./viewer-scene.ts";

const setId = (key: string) => resultSets.find((set) => set.key === key)?.id ?? key;

export const toSlideResultStats = (taskId: string, slideId: string): SlideResultStats => {
  const seeded = reviewsA1(taskId, slideId);
  return slideResultStatsSchema.parse({
    task_id: taskId,
    slide_id: slideId,
    object_count: seeded ? objectsOnA1 : 0,
    class_counts: seeded
      ? classCounts.map((row) => ({ class_name: row.className, count: row.count }))
      : [],
    score_bins: seeded ? scoreBins : scoreBins.map(() => 0),
    ai_vs_reviewed: {
      dice: aiAgainstReviewed.dice,
      cells_agree_percent: aiAgainstReviewed.cellsAgreePercent,
      objects: seeded ? aiAgainstReviewed.objects : [],
    },
    model_vs_model: {
      set_a_id: setId("cam"),
      set_b_id: setId("sam"),
      dice: modelAgainstModel.dice,
      only_in_a: seeded ? modelAgainstModel.onlyInA : [],
    },
    reviewers: {
      user_ids: reviewerAgainstReviewer.reviewers.map((key) => people[key].id),
      kappa: seeded ? reviewerAgainstReviewer.kappa : null,
      objects: seeded ? reviewerAgainstReviewer.objects : [],
    },
  });
};

export const toSlideAiProgress = (slideId: string): SlideAiProgress =>
  slideAiProgressSchema.parse(
    fakeViewerScene() === "running"
      ? {
          slide_id: slideId,
          state: "running",
          steps: aiStillReading.steps,
          found: aiStillReading.found,
        }
      : { slide_id: slideId, state: "ready", steps: [], found: [] },
  );

export const getGetSlideResultStatsMockHandler = (overrideResponse?: SlideResultStats) =>
  http.get<{ taskId: string; slideId: string }>(
    "*/api/review-tasks/:taskId/slides/:slideId/result-stats",
    ({ params }) =>
      HttpResponse.json(overrideResponse ?? toSlideResultStats(params.taskId, params.slideId)),
  );

export const getGetSlideAiProgressMockHandler = (overrideResponse?: SlideAiProgress) =>
  http.get<{ slideId: string }>("*/api/slides/:slideId/ai-progress", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toSlideAiProgress(params.slideId)),
  );

export const viewerDraftOperations: DraftOperation[] = [
  {
    operationId: "getSlideResultStats",
    method: "get",
    path: "/api/review-tasks/{task_id}/slides/{slide_id}/result-stats",
    handler: () => getGetSlideResultStatsMockHandler(),
  },
  {
    operationId: "getSlideAiProgress",
    method: "get",
    path: "/api/slides/{slide_id}/ai-progress",
    handler: () => getGetSlideAiProgressMockHandler(),
  },
];
