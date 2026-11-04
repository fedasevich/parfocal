import { HttpResponse, http } from "msw";
import { type ResultSetTyper, resultSetTyperSchema } from "../draft/get-result-set-typer.ts";
import { type SlideAiProgress, slideAiProgressSchema } from "../draft/get-slide-ai-progress.ts";
import { type SlideResultStats, slideResultStatsSchema } from "../draft/get-slide-result-stats.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { reviewsA1 } from "./review-verdicts.ts";
import { people, resultSets } from "./scenario.ts";
import { typers } from "./scenario-typers.ts";
import {
  aiAgainstReviewed,
  aiStillReading,
  classCounts,
  modelAgainstModel,
  objectsOnA1,
  reviewerAgainstReviewer,
  scoreBins,
} from "./scenario-viewer.ts";
import { fakeViewerScene, nextFakeProgressRead } from "./viewer-scene.ts";

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

const foundAfter = (reads: number) => [
  ...aiStillReading.found,
  ...aiStillReading.later.slice(0, Math.max(0, reads - 1)),
];

const stepsAfter = (reads: number) =>
  aiStillReading.steps.map((step) =>
    step.state === "running"
      ? { ...step, percent: Math.min(95, step.percent + 10 * Math.max(0, reads - 1)) }
      : step,
  );

export const toSlideAiProgress = (slideId: string): SlideAiProgress => {
  if (fakeViewerScene() !== "running") {
    return slideAiProgressSchema.parse({ slide_id: slideId, state: "ready", steps: [], found: [] });
  }
  const reads = nextFakeProgressRead();
  return slideAiProgressSchema.parse({
    slide_id: slideId,
    state: "running",
    steps: stepsAfter(reads),
    found: foundAfter(reads),
  });
};

export const toResultSetTyper = (resultSetId: string): ResultSetTyper | undefined => {
  const key = resultSets.find((set) => set.id === resultSetId)?.key;
  const typer = key === undefined ? undefined : typers[key];
  if (typer === undefined) return undefined;
  return resultSetTyperSchema.parse({
    result_set_id: resultSetId,
    name: typer.name,
    calibrated: typer.calibrated,
    checked_on_held_out: typer.checkedOnHeldOut,
    band_accuracy: typer.bandAccuracy,
    test_set_accuracy: typer.testSetAccuracy,
    test_set_confident_share: typer.testSetConfidentShare,
    test_set_unsure_share: typer.testSetUnsureShare,
    validated_sites: typer.validatedSites,
  });
};

export const getGetResultSetTyperMockHandler = (overrideResponse?: ResultSetTyper) =>
  http.get<{ resultSetId: string }>("*/api/result-sets/:resultSetId/typer", ({ params }) => {
    const typer = overrideResponse ?? toResultSetTyper(params.resultSetId);
    return typer === undefined ? new HttpResponse(null, { status: 404 }) : HttpResponse.json(typer);
  });

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
    operationId: "getResultSetTyper",
    method: "get",
    path: "/api/result-sets/{result_set_id}/typer",
    handler: () => getGetResultSetTyperMockHandler(),
  },
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
