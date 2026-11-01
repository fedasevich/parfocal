import { HttpResponse, http, type RequestHandler } from "msw";
import { type DecisionStyle, decisionStyleSchema } from "../draft/get-decision-style.ts";
import { type SlideAgreement, slideAgreementSchema } from "../draft/get-slide-agreement.ts";
import { type TaskDisplay, taskDisplaySchema } from "../draft/get-task-display.ts";
import { type ReviewObjects, reviewObjectsSchema } from "../draft/list-review-objects.ts";
import { type ThreadComment, threadCommentSchema } from "../draft/list-thread-comments.ts";
import {
  getGetOpinionFormMockHandler,
  getGetOpinionMockHandler,
  getGetSlideNeighboursMockHandler,
  getListProjectClassesMockHandler,
  getSaveVerdictMockHandler,
  getSubmitSlideReviewMockHandler,
} from "../generated/api.msw.ts";
import type {
  Neighbours,
  Opinion,
  OpinionForm,
  ProjectClass,
  TaskStates,
  VerdictDraft,
} from "../generated/api.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { reviewedSlide, reviewsA1 } from "./review-verdicts.ts";
import { people, projectByCode, reviewTasks, slides, threads } from "./scenario.ts";
import {
  addedByLenka,
  agreementWithSimona,
  decisionStyles,
  lenkaOpinion,
  opinionQuestions,
  reviewObjects,
  rt16,
  sentinelClasses,
  slideOrder,
  taskDisplay,
  visibleComments,
} from "./scenario-review.ts";
import { fakeView } from "./view.ts";
import { toReviewTaskDetail } from "./work-handlers.ts";

const taskById = (taskId: string) => [...reviewTasks, rt16].find((task) => task.id === taskId);

const slideSummary = (slideId: string) => {
  const slide = slides.find((candidate) => candidate.id === slideId) ?? reviewedSlide;
  return { label: slide.label, case_label: slide.caseLabel, stain: slide.stain };
};

export const toReviewObjects = (taskId: string, slideId: string): ReviewObjects =>
  reviewObjectsSchema.parse({
    task_id: taskId,
    slide_id: slideId,
    slide: slideSummary(slideId),
    objects: reviewsA1(taskId, slideId)
      ? reviewObjects.map((item, index) => ({
          object: item.object,
          kind: item.kind,
          number: index + 1,
          class_name: item.className,
          score: item.score,
          size_mm: item.sizeMm,
          other_class: item.otherClass,
        }))
      : [],
    added: reviewsA1(taskId, slideId) ? addedByLenka : [],
  });

export const toDecisionStyle = (taskId: string): DecisionStyle => {
  const style = decisionStyles[taskById(taskId)?.code ?? "RT-14"] ?? decisionStyles["RT-14"];
  return decisionStyleSchema.parse({
    task_id: taskId,
    kind: style?.kind ?? "agree",
    question: style?.question ?? null,
    agree_from: style?.agreeFrom ?? 4,
    disagree_to: style?.disagreeTo ?? 2,
  });
};

export const toTaskDisplay = (taskId: string): TaskDisplay => {
  const task = taskById(taskId);
  const display = taskDisplay[task?.code ?? ""] ?? { locks: [], presets: [] };
  return taskDisplaySchema.parse({
    task_id: taskId,
    task_code: task?.code ?? "",
    locks: display.locks.map((lock) => ({
      ...lock,
      value: lock.setting === "order" ? "ai" : "hidden",
    })),
    presets: display.presets,
  });
};

export const toThreadComments = (threadId: string): ThreadComment[] => {
  const thread = threads.find((item) => item.id === threadId);
  if (thread === undefined) return [];
  const task = [...reviewTasks, rt16].find((item) => item.code === thread.task);
  const researcher = projectByCode(task?.project ?? "P07").owner;
  return visibleComments(fakeView().viewer, task?.blinded ?? false, researcher)
    .filter((item) => item.anchor === thread.anchor)
    .map((item) =>
      threadCommentSchema.parse({
        id: item.id,
        thread_id: threadId,
        author_id: people[item.by].id,
        author_is_researcher: item.by === researcher,
        text: item.text,
        reply_to: item.replyTo,
        created_at: item.at,
      }),
    );
};

export const toSlideAgreement = (taskId: string, slideId: string): SlideAgreement =>
  slideAgreementSchema.parse({
    task_id: taskId,
    slide_id: slideId,
    with_user_id: reviewsA1(taskId, slideId) ? people[agreementWithSimona.with].id : null,
    agree: reviewsA1(taskId, slideId) ? agreementWithSimona.agree : 0,
    total: reviewsA1(taskId, slideId) ? agreementWithSimona.total : 0,
  });

export const toOpinion = (): Opinion => ({
  reviewer_id: people[fakeView().viewer].id,
  form_version: 1,
  questions: opinionQuestions,
  answers: fakeView().viewer === "LM" ? lenkaOpinion : {},
  draft: true,
  updated_at: "2026-10-15T10:52:00+02:00",
});

export const toOpinionForm = (projectId: string): OpinionForm => ({
  project_id: projectId,
  version: 1,
  questions: opinionQuestions,
  created_at: "2026-09-02T09:00:00Z",
});

export const toProjectClasses = (projectId: string): ProjectClass[] =>
  sentinelClasses.map((item) => ({
    id: `${projectId}-class-${item.key}`,
    key: item.key,
    name: item.name,
    colour: item.colour,
  }));

const slideRef = (slide: (typeof slides)[number]) => ({
  id: slide.id,
  label: slide.label,
  case_label: slide.caseLabel,
});

export const toNeighbours = (slideId: string): Neighbours => {
  const current = slides.find((slide) => slide.id === slideId) ?? reviewedSlide;
  const ownSlides = slides.filter((slide) => slide.project === current.project);
  const at = ownSlides.indexOf(current);
  const previous = ownSlides[at - 1];
  const next = ownSlides[at + 1];
  const position = current.id === reviewedSlide.id ? slideOrder.position : slideOrder.position + 1;
  return {
    current: slideRef(current),
    previous: previous ? slideRef(previous) : null,
    next: next ? slideRef(next) : null,
    position,
    total: slideOrder.total,
    at_end: position === slideOrder.total,
  };
};

const submittedStates = (taskId: string, slideId: string): TaskStates => ({
  task_id: taskId,
  signed_off_at: null,
  slides: [
    {
      slide_id: slideId,
      state: "submitted",
      reviewers: [
        { user_id: people.LM.id, state: "submitted", submitted_at: "2026-10-15T10:58:00+02:00" },
      ],
    },
  ],
});

export const getListReviewObjectsMockHandler = (overrideResponse?: ReviewObjects) =>
  http.get<{ taskId: string; slideId: string }>(
    "*/api/review-tasks/:taskId/slides/:slideId/objects",
    ({ params }) =>
      HttpResponse.json(overrideResponse ?? toReviewObjects(params.taskId, params.slideId)),
  );

export const getGetDecisionStyleMockHandler = (overrideResponse?: DecisionStyle) =>
  http.get<{ taskId: string }>("*/api/review-tasks/:taskId/decision-style", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toDecisionStyle(params.taskId)),
  );

export const getGetTaskDisplayMockHandler = (overrideResponse?: TaskDisplay) =>
  http.get<{ taskId: string }>("*/api/review-tasks/:taskId/display", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toTaskDisplay(params.taskId)),
  );

export const getListThreadCommentsMockHandler = (overrideResponse?: ThreadComment[]) =>
  http.get<{ threadId: string }>("*/api/threads/:threadId/comments", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toThreadComments(params.threadId)),
  );

export const getGetSlideAgreementMockHandler = (overrideResponse?: SlideAgreement) =>
  http.get<{ taskId: string; slideId: string }>(
    "*/api/review-tasks/:taskId/slides/:slideId/agreement",
    ({ params }) =>
      HttpResponse.json(overrideResponse ?? toSlideAgreement(params.taskId, params.slideId)),
  );

export const reviewDraftOperations: DraftOperation[] = [
  {
    operationId: "listReviewObjects",
    method: "get",
    path: "/api/review-tasks/{task_id}/slides/{slide_id}/objects",
    handler: () => getListReviewObjectsMockHandler(),
  },
  {
    operationId: "getDecisionStyle",
    method: "get",
    path: "/api/review-tasks/{task_id}/decision-style",
    handler: () => getGetDecisionStyleMockHandler(),
  },
  {
    operationId: "getTaskDisplay",
    method: "get",
    path: "/api/review-tasks/{task_id}/display",
    handler: () => getGetTaskDisplayMockHandler(),
  },
  {
    operationId: "listThreadComments",
    method: "get",
    path: "/api/threads/{thread_id}/comments",
    handler: () => getListThreadCommentsMockHandler(),
  },
  {
    operationId: "getSlideAgreement",
    method: "get",
    path: "/api/review-tasks/{task_id}/slides/{slide_id}/agreement",
    handler: () => getGetSlideAgreementMockHandler(),
  },
];

export function reviewHandlers(): RequestHandler[] {
  return [
    http.get<{ taskId: string }>("*/api/review-tasks/:taskId", ({ params }) =>
      params.taskId === rt16.id ? HttpResponse.json(toReviewTaskDetail(rt16)) : undefined,
    ),
    getGetOpinionMockHandler(() => toOpinion()),
    getGetOpinionFormMockHandler(({ params }) => toOpinionForm(String(params["projectId"]))),
    getListProjectClassesMockHandler(({ params }) => toProjectClasses(String(params["projectId"]))),
    getGetSlideNeighboursMockHandler(({ params }) => toNeighbours(String(params["slideId"]))),
    getSaveVerdictMockHandler(async ({ request, params }) => {
      const body = (await request.json()) as VerdictDraft;
      const objectId = String(params["objectId"]);
      const index = reviewObjects.findIndex((item) => item.object === objectId);
      return {
        object: objectId,
        kind: reviewObjects[index]?.kind === "cell" ? "cell" : "region",
        number: index + 1,
        value: body.value,
        reason: body.reason ?? null,
        reason_class_id: body.reason_class_id ?? null,
        note: body.note ?? null,
        updated_at: "2026-10-15T10:52:00+02:00",
      };
    }),
    getSubmitSlideReviewMockHandler(({ params }) =>
      submittedStates(String(params["taskId"]), String(params["slideId"])),
    ),
  ];
}
