import type {
  AddedDraft,
  Annotation,
  EditDraft,
  FirstRead,
  ReviewEdit,
  ReviewedLayer,
  ReviewOrder,
  Verdict,
} from "../generated/api.ts";
import { resultSets, reviewTasks, slideByIndex } from "./scenario.ts";
import {
  lenkaDecisionsInReview,
  nextSlideFacts,
  reviewDecisionTimes,
  reviewObjects,
  rt16,
  rt17,
} from "./scenario-review.ts";
import { taskSlides } from "./scenario-task.ts";
import { annotateStoredOrder } from "./shared-layer-handlers.ts";
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

const nextSlide = slideByIndex(2);

const reviewsNext = (taskId: string, slideId: string) =>
  slideId === nextSlide.id && reviewsA1(taskId, reviewedSlide.id);

const firstReads = new Map<string, FirstRead>();
const addedObjects = new Map<string, Annotation[]>();

const firstReadKey = (taskId: string, slideId: string) => `${taskId}/${slideId}`;

const readsFirst = (taskId: string, slideId: string) =>
  taskId === rt17.id && slideId === reviewedSlide.id && fakeView().viewer === "LM";

export const firstReadOpen = (taskId: string, slideId: string) =>
  taskId === rt17.id && !firstReads.has(firstReadKey(taskId, slideId));

const rt17Slides = () =>
  taskSlides.filter((slide) => slide.sets.some((key) => key === rt17.resultSet));

export const aiHiddenOnSlide = (slideId: string) =>
  rt17.reviewers.includes(fakeView().viewer) &&
  rt17Slides().some((slide) => slide.id === slideId) &&
  firstReadOpen(rt17.id, slideId);

export const aiHiddenForResultSet = (resultSetId: string) => {
  const set = resultSets.find((candidate) => candidate.id === resultSetId);
  return (
    set !== undefined &&
    rt17Slides().some(
      (slide) => slide.sets.some((key) => key === set.key) && aiHiddenOnSlide(slide.id),
    )
  );
};

export const firstReadOf = (taskId: string, slideId: string) =>
  firstReads.get(firstReadKey(taskId, slideId));

export const recordFirstRead = (
  taskId: string,
  slideId: string,
  reviewerId: string,
  answers: Record<string, unknown>,
): FirstRead => {
  const recorded: FirstRead = {
    reviewer_id: reviewerId,
    recorded_at: new Date().toISOString(),
    form_version: 1,
    answers: structuredClone(answers),
    added: structuredClone(addedOn(taskId, slideId)),
  };
  firstReads.set(firstReadKey(taskId, slideId), recorded);
  return recorded;
};

export const addedOn = (taskId: string, slideId: string): Annotation[] =>
  addedObjects.get(firstReadKey(taskId, slideId)) ?? [];

export const addObject = (taskId: string, slideId: string, draft: AddedDraft): Annotation => {
  const kept = addedOn(taskId, slideId);
  const number = kept.length + 1;
  const now = new Date().toISOString();
  const added: Annotation = {
    id: crypto.randomUUID(),
    slide_id: slideId,
    kind: draft.kind,
    number,
    code: `${draft.kind === "cell" ? "C" : "T"}${number}⁺`,
    geometry: { ...draft.geometry },
    class_id: draft.class_id ?? null,
    task_id: taskId,
    version: 1,
    created_by_user_id: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  addedObjects.set(firstReadKey(taskId, slideId), [...kept, added]);
  return added;
};

export const objectsOn = (taskId: string, slideId: string) => {
  if (taskId === rt17.id && firstReadOpen(taskId, slideId)) return [];
  if (readsFirst(taskId, slideId)) return reviewObjects;
  if (reviewsA1(taskId, slideId)) return reviewObjects;
  if (reviewsNext(taskId, slideId)) {
    return reviewObjects.filter(
      (item, index) => item.kind === "cell" || index < nextSlideFacts.regions,
    );
  }
  return [];
};

export const reviewOrderFor = (taskId: string, slideId: string): ReviewOrder => {
  const annotated = annotateStoredOrder(taskId, slideId);
  if (annotated !== null) {
    return {
      task_id: taskId,
      slide_id: slideId,
      total: annotated.length,
      offset: 0,
      objects: annotated,
    };
  }
  const objects = objectsOn(taskId, slideId);
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

const savedDecisions = new Map<string, Map<string, Verdict | null>>();

const savedKey = (taskId: string, slideId: string) => `${taskId}/${slideId}`;

export const rememberDecision = (
  taskId: string,
  slideId: string,
  object: string,
  decision: Verdict | null,
) => {
  const key = savedKey(taskId, slideId);
  const kept = savedDecisions.get(key) ?? new Map<string, Verdict | null>();
  kept.set(object, decision);
  savedDecisions.set(key, kept);
};

const startingDecisions = (taskId: string, slideId: string): Verdict[] => {
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
        style: "agree",
        answer: decision.value,
        answer_class_id: null,
        value: decision.value,
        reasons: decision.reason ? [decision.reason] : [],
        reason_class_id: null,
        note: decision.note,
        updated_at: reviewDecisionTimes(index),
      },
    ];
  });
};

export const verdictsFor = (taskId: string, slideId: string): Verdict[] => {
  const kept = savedDecisions.get(savedKey(taskId, slideId));
  const starting = startingDecisions(taskId, slideId);
  if (kept === undefined) return starting;
  const merged = new Map<string, Verdict>(starting.map((item) => [item.object, item]));
  for (const [object, decision] of kept) {
    if (decision === null) merged.delete(object);
    else merged.set(object, decision);
  }
  const order = new Map(reviewObjects.map((item, index) => [item.object, index]));
  return [...merged.values()].sort(
    (a, b) => (order.get(a.object) ?? 0) - (order.get(b.object) ?? 0),
  );
};

const editsKey = "parfocal.fake.review-edits";

type EditStore = Record<string, Record<string, ReviewEdit>>;

let editsMemory: EditStore = {};

const editSession = (): Storage | null =>
  typeof sessionStorage === "undefined" ? null : sessionStorage;

const readEdits = (): EditStore => {
  const stored = editSession()?.getItem(editsKey);
  return stored === null || stored === undefined ? editsMemory : (JSON.parse(stored) as EditStore);
};

const writeEdits = (store: EditStore) => {
  editsMemory = store;
  editSession()?.setItem(editsKey, JSON.stringify(store));
};

const noReviewer = "00000000-0000-4000-8000-000000000000";

export const rememberEdit = (
  taskId: string,
  slideId: string,
  object: string,
  draft: EditDraft | null,
) => {
  const key = savedKey(taskId, slideId);
  const store = readEdits();
  const kept = { ...store[key] };
  if (draft === null) delete kept[object];
  else {
    kept[object] = {
      object,
      kind: object.includes("C") ? "cell" : "region",
      number: Number(object.replace(/\D/g, "").slice(-3)) || 0,
      split: "train",
      class_id: draft.class_id ?? null,
      geometry: (draft.geometry as ReviewEdit["geometry"]) ?? null,
      deleted: draft.deleted ?? false,
      retired: null,
      merged_into: null,
      updated_at: "2026-10-15T10:53:00+02:00",
    };
  }
  writeEdits({ ...store, [key]: kept });
  return kept[object];
};

export const reviewedLayerFor = (taskId: string, slideId: string): ReviewedLayer => {
  const edits = Object.values(readEdits()[savedKey(taskId, slideId)] ?? {});
  return {
    task_id: taskId,
    slide_id: slideId,
    result_set_id: noReviewer,
    reviewer_id: noReviewer,
    edits,
    added: [],
    summary: {
      regions: null,
      cells: null,
      retyped: 0,
      reshaped: edits.filter((item) => item.geometry !== null).length,
      deleted: 0,
      split: 0,
      merged: 0,
      added: 0,
    },
  };
};
