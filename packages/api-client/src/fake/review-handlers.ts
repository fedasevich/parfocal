import { HttpResponse, http, type RequestHandler } from "msw";
import { type SlideAgreement, slideAgreementSchema } from "../draft/get-slide-agreement.ts";
import { type TaskDisplay, taskDisplaySchema } from "../draft/get-task-display.ts";
import { type ReviewObjects, reviewObjectsSchema } from "../draft/list-review-objects.ts";
import { type ThreadComment, threadCommentSchema } from "../draft/list-thread-comments.ts";
import {
  getClearReviewEditMockHandler,
  getClearVerdictMockHandler,
  getCreateThreadMockHandler,
  getGetOpinionMockHandler,
  getGetReviewedLayerMockHandler,
  getGetSlideNeighboursMockHandler,
  getListMentionableMembersMockHandler,
  getListProjectClassesMockHandler,
  getListThreadsMockHandler,
  getSaveOpinionMockHandler,
  getSaveReviewEditMockHandler,
  getSaveVerdictMockHandler,
  getSubmitSlideReviewMockHandler,
} from "../generated/api.msw.ts";
import type {
  EditDraft,
  Mentionable,
  Neighbours,
  Opinion,
  OpinionChange,
  ProjectClass,
  TaskStates,
  Thread,
  ThreadCreate,
  VerdictDraft,
} from "../generated/api.ts";
import { countedAs, decisionSettingsFor } from "./decision-settings.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import {
  objectsOn,
  rememberDecision,
  rememberEdit,
  reviewedLayerFor,
  reviewedSlide,
  reviewsA1,
} from "./review-verdicts.ts";
import { people, projectByCode, reviewTasks, slideByIndex, slides, threads } from "./scenario.ts";
import {
  addedByLenka,
  agreementWithSimona,
  lenkaOpinion,
  opinionQuestions,
  reviewObjects,
  rt13,
  rt16,
  sentinelClasses,
  slideOrder,
  taskDisplay,
  visibleComments,
} from "./scenario-review.ts";
import { fakeView } from "./view.ts";
import { toReviewTaskDetail, toTaskStates } from "./work-handlers.ts";

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
    objects: objectsOn(taskId, slideId).map((item, index) => ({
      object: item.object,
      kind: item.kind,
      number: index + 1,
      class_name: item.className,
      score: item.score,
      size_mm: item.sizeMm,
      other_class: item.otherClass,
    })),
    added: reviewsA1(taskId, slideId) ? addedByLenka : [],
  });

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

const postedThreads: Thread[] = [];
const postedComments: ThreadComment[] = [];

export const resetFakeThreads = () => {
  postedThreads.length = 0;
  postedComments.length = 0;
};

export const toThreadComments = (threadId: string): ThreadComment[] => {
  const posted = postedComments.filter((item) => item.thread_id === threadId);
  if (posted.length > 0) return posted;
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

export const toThreads = (taskId: string, slideId: string, resolved: boolean | null): Thread[] => {
  const task = taskById(taskId);
  if (task === undefined) return [];
  const project = projectByCode(task.project);
  const posted = postedThreads.filter(
    (item) =>
      item.task_id === task.id &&
      item.slide_id === slideId &&
      (resolved === null || (item.resolved_at === null) === !resolved),
  );
  const seeded: Thread[] = threads
    .filter((item) => item.task === task.code && slideByIndex(item.slide).id === slideId)
    .filter((item) => resolved === null || item.open === !resolved)
    .map((item) => ({
      id: item.id,
      project_id: project.id,
      task_id: task.id,
      slide_id: slideId,
      title: item.title,
      anchor: {
        kind: item.anchor.endsWith("⁺") ? "roi" : "object",
        object_id: item.anchor,
        geometry: null,
        offset: null,
      },
      created_by: people[item.by].id,
      created_at: item.at,
      resolved_at: item.open ? null : item.last,
      resolved_by: item.open ? null : people[item.by].id,
      message_count: item.replies + 1,
      last_message_at: item.last,
    }));
  return [...seeded, ...posted];
};

export const toMentionable = (taskId: string): Mentionable[] => {
  const task = taskById(taskId);
  const viewer = fakeView().viewer;
  const researcher = projectByCode(task?.project ?? "P07").owner;
  const blindedFromPeers = (task?.blinded ?? false) && viewer !== researcher;
  return Object.values(people)
    .filter((person) => person.key !== viewer)
    .filter((person) => !blindedFromPeers || person.key === researcher)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => ({
      user_id: person.id,
      display_name: person.name,
      initials: person.key,
      avatar_colour: person.colour,
    }));
};

export const toSlideAgreement = (taskId: string, slideId: string): SlideAgreement =>
  slideAgreementSchema.parse({
    task_id: taskId,
    slide_id: slideId,
    with_user_id: reviewsA1(taskId, slideId) ? people[agreementWithSimona.with].id : null,
    agree: reviewsA1(taskId, slideId) ? agreementWithSimona.agree : 0,
    total: reviewsA1(taskId, slideId) ? agreementWithSimona.total : 0,
  });

const savedOpinions = new Map<string, Record<string, unknown>>();

export const toOpinion = (taskId = "", slideId = ""): Opinion => ({
  reviewer_id: people[fakeView().viewer].id,
  form_version: 1,
  questions: opinionQuestions,
  answers: Object.fromEntries(
    Object.entries({
      ...(fakeView().viewer === "LM" ? lenkaOpinion : {}),
      ...savedOpinions.get(`${taskId}/${slideId}`),
    }).filter(([, value]) => value !== null),
  ),
  draft: true,
  read: "single",
  updated_at: "2026-10-15T10:52:00+02:00",
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
  left_open: 0,
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
    http.get<{ taskId: string }>("*/api/review-tasks/:taskId", ({ params }) => {
      const extra = [rt13, rt16].find((task) => task.id === params.taskId);
      return extra ? HttpResponse.json(toReviewTaskDetail(extra)) : undefined;
    }),
    http.get<{ taskId: string }>("*/api/review-tasks/:taskId/states", ({ params }) =>
      params.taskId === rt13.id ? HttpResponse.json(toTaskStates(rt13)) : undefined,
    ),
    getGetOpinionMockHandler(({ params }) =>
      toOpinion(String(params["taskId"]), String(params["slideId"])),
    ),
    getSaveOpinionMockHandler(async ({ request, params }) => {
      const taskId = String(params["taskId"]);
      const slideId = String(params["slideId"]);
      const change = (await request.json()) as OpinionChange;
      const key = `${taskId}/${slideId}`;
      const kept = { ...savedOpinions.get(key) };
      for (const [question, value] of Object.entries(change.answers)) kept[question] = value;
      savedOpinions.set(key, kept);
      return toOpinion(taskId, slideId);
    }),
    getListThreadsMockHandler(({ params, request }) => {
      const asked = new URL(request.url).searchParams.get("resolved");
      return toThreads(
        String(params["taskId"]),
        String(params["slideId"]),
        asked === null ? null : asked === "true",
      );
    }),
    getCreateThreadMockHandler(async ({ params, request }) => {
      const body = (await request.json()) as ThreadCreate;
      const task = taskById(String(params["taskId"]));
      const viewer = people[fakeView().viewer];
      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      const message = {
        id: crypto.randomUUID(),
        author_id: viewer.id,
        body: body.body,
        mentions: [],
        created_at: at,
      };
      const thread: Thread = {
        id,
        project_id: projectByCode(task?.project ?? "P07").id,
        task_id: String(params["taskId"]),
        slide_id: String(params["slideId"]),
        title: body.title,
        anchor: body.anchor,
        created_by: viewer.id,
        created_at: at,
        resolved_at: null,
        resolved_by: null,
        message_count: 1,
        last_message_at: at,
      };
      postedThreads.push(thread);
      postedComments.push(
        threadCommentSchema.parse({
          id: message.id,
          thread_id: id,
          author_id: viewer.id,
          author_is_researcher: false,
          text: body.body,
          reply_to: null,
          created_at: at,
        }),
      );
      return { ...thread, messages: [message] };
    }),
    getListMentionableMembersMockHandler(({ params }) => toMentionable(String(params["taskId"]))),
    getListProjectClassesMockHandler(({ params }) => toProjectClasses(String(params["projectId"]))),
    getGetSlideNeighboursMockHandler(({ params }) => toNeighbours(String(params["slideId"]))),
    getSaveVerdictMockHandler(async ({ request, params }) => {
      const body = (await request.json()) as VerdictDraft;
      const objectId = String(params["objectId"]);
      const index = reviewObjects.findIndex((item) => item.object === objectId);
      const settings = decisionSettingsFor(taskById(String(params["taskId"]))?.code ?? "RT-14");
      const answer = body.answer ?? body.value ?? "unsure";
      const aiClass = sentinelClasses.find((item) => item.name === reviewObjects[index]?.className);
      const saved = {
        object: objectId,
        kind: reviewObjects[index]?.kind === "cell" ? ("cell" as const) : ("region" as const),
        number: index + 1,
        style: settings.style,
        answer,
        answer_class_id: body.answer_class_id ?? null,
        value: countedAs(settings, answer, body.answer_class_id, aiClass?.key),
        reasons: body.reasons ?? [],
        reason_class_id: body.reason_class_id ?? null,
        note: body.note ?? null,
        updated_at: "2026-10-15T10:52:00+02:00",
      };
      rememberDecision(String(params["taskId"]), String(params["slideId"]), objectId, saved);
      return saved;
    }),
    getClearVerdictMockHandler(({ params }) => {
      rememberDecision(
        String(params["taskId"]),
        String(params["slideId"]),
        String(params["objectId"]),
        null,
      );
    }),
    getSaveReviewEditMockHandler(async ({ request, params }) => {
      const draft = (await request.json()) as EditDraft;
      const saved = rememberEdit(
        String(params["taskId"]),
        String(params["slideId"]),
        String(params["objectId"]),
        draft,
      );
      if (saved === undefined) throw new Error("edit was not kept");
      return saved;
    }),
    getClearReviewEditMockHandler(({ params }) => {
      rememberEdit(
        String(params["taskId"]),
        String(params["slideId"]),
        String(params["objectId"]),
        null,
      );
    }),
    getGetReviewedLayerMockHandler(({ params }) =>
      reviewedLayerFor(String(params["taskId"]), String(params["slideId"])),
    ),
    getSubmitSlideReviewMockHandler(({ params }) =>
      submittedStates(String(params["taskId"]), String(params["slideId"])),
    ),
  ];
}
