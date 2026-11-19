import { HttpResponse, http, type RequestHandler } from "msw";
import {
  getGetSlideAiProgressMockHandler,
  getGetSlideResultStatsMockHandler,
} from "../generated/api.msw.ts";
import type { ResultSetTyper, SlideAiProgress, SlideResultStats } from "../generated/api.ts";
import { reviewsA1 } from "./review-decisions.ts";
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
import { fakeViewerIssue, fakeViewerScene, nextFakeProgressRead } from "./viewer-scene.ts";

const setId = (key: string) => resultSets.find((set) => set.key === key)?.id ?? key;

export const toSlideResultStats = (taskId: string, slideId: string): SlideResultStats => {
  const seeded = reviewsA1(taskId, slideId);
  return {
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
      objects: seeded ? [...aiAgainstReviewed.objects] : [],
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
      objects: seeded ? [...reviewerAgainstReviewer.objects] : [],
    },
  };
};

const foundAfter = (reads: number) => [
  ...aiStillReading.found,
  ...aiStillReading.later.slice(0, Math.max(0, reads - 1)),
];

const stepsAfter = (reads: number) =>
  aiStillReading.steps.map((step) =>
    step.state === "running"
      ? { ...step, percent: Math.min(95, step.percent + 10 * Math.max(0, reads - 1)) }
      : { ...step },
  );

export const toSlideAiProgress = (slideId: string): SlideAiProgress => {
  if (fakeViewerScene() !== "running" && fakeViewerIssue() !== "running") {
    return { slide_id: slideId, state: "ready", steps: [], found: [] };
  }
  const reads = nextFakeProgressRead();
  return {
    slide_id: slideId,
    state: "running",
    steps: stepsAfter(reads),
    found: foundAfter(reads),
  };
};

export const toResultSetTyper = (resultSetId: string): ResultSetTyper | undefined => {
  const set = resultSets.find((candidate) => candidate.id === resultSetId);
  const typer = set === undefined ? undefined : typers[set.key];
  if (typer === undefined) return undefined;
  return {
    result_set_id: resultSetId,
    name: typer.name,
    calibrated: typer.calibrated,
    checked_on_held_out: typer.checkedOnHeldOut,
    band_accuracy: typer.bandAccuracy,
    test_set_accuracy: typer.testSetAccuracy,
    test_set_confident_share: typer.testSetConfidentShare,
    test_set_unsure_share: typer.testSetUnsureShare,
    validated_sites: [...typer.validatedSites],
  };
};

export const viewerHandlers = (): RequestHandler[] => [
  http.get<{ resultSetId: string }>("*/api/result-sets/:resultSetId/typer", ({ params }) => {
    const typer = toResultSetTyper(params.resultSetId);
    return typer === undefined
      ? HttpResponse.json(
          {
            type: "about:blank",
            title: "This result set has no typer",
            status: 404,
            code: "no-typer",
          },
          { status: 404 },
        )
      : HttpResponse.json(typer);
  }),
  getGetSlideResultStatsMockHandler(({ params }) =>
    toSlideResultStats(String(params.taskId), String(params.slideId)),
  ),
  getGetSlideAiProgressMockHandler(({ params }) => toSlideAiProgress(String(params.slideId))),
];
