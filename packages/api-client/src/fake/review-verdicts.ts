import type { ReviewOrder, Verdict } from "../generated/api.ts";
import { reviewTasks, slideByIndex } from "./scenario.ts";
import {
  lenkaDecisionsInReview,
  reviewDecisionTimes,
  reviewObjects,
  rt16,
} from "./scenario-review.ts";
import { fakeView } from "./view.ts";

export const reviewedSlide = slideByIndex(1);

export const reviewsA1 = (taskId: string, slideId: string) => {
  const task = [...reviewTasks, rt16].find((candidate) => candidate.id === taskId);
  return (
    (task?.code === "RT-14" || task?.code === "RT-16") &&
    slideId === reviewedSlide.id &&
    fakeView().viewer === "LM"
  );
};

export const reviewOrderFor = (taskId: string, slideId: string): ReviewOrder => {
  const objects = reviewsA1(taskId, slideId) ? reviewObjects : [];
  return {
    task_id: taskId,
    slide_id: slideId,
    total: objects.length,
    offset: 0,
    objects: objects.map((item, index) => ({
      object: item.object,
      kind: item.kind,
      number: index + 1,
    })),
  };
};

export const verdictsFor = (taskId: string, slideId: string): Verdict[] => {
  if (!reviewsA1(taskId, slideId)) return [];
  const decided = lenkaDecisionsInReview();
  return reviewObjects.flatMap((item, index) => {
    const decision = decided.get(item.object);
    if (decision === undefined) return [];
    return [
      {
        object: item.object,
        kind: item.kind,
        number: index + 1,
        value: decision.value,
        reason: decision.reason,
        reason_class_id: null,
        note: decision.note,
        updated_at: reviewDecisionTimes(index),
      },
    ];
  });
};
