import type { RequestHandler } from "msw";
import {
  getGetNotificationCountsMockHandler,
  getGetReviewOrderMockHandler,
  getListAnnouncementsMockHandler,
  getListMySlidesMockHandler,
  getListNotificationsMockHandler,
  getListTasksAssignedByMeMockHandler,
  getListVerdictsMockHandler,
  getMarkNotificationsReadMockHandler,
  getSearchMockHandler,
} from "../generated/api.msw.ts";
import type {
  AssignedTask,
  InboxCounts,
  InboxItem,
  MarkRead,
  MyStatus,
  NotificationKind,
  ReviewOrder,
  SearchHit,
  SlideRow,
  State,
  TaskStatus,
  Verdict,
  VerdictValue,
} from "../generated/api.ts";
import {
  announcements,
  cases,
  myWorkSlideIds,
  notifications,
  type PersonKey,
  people,
  projectByCode,
  projects,
  resultSets,
  reviewTasks,
  type ScenarioNotification,
  type ScenarioReviewTask,
  slideByIndex,
  slideDecisions,
  slideReviews,
  slides,
} from "./scenario.ts";
import { assignedTo, toAnnouncement, toProjectRef } from "./scenario-handlers.ts";
import { fakeView } from "./view.ts";

const taskByCode = (code: string): ScenarioReviewTask => {
  const task = reviewTasks.find((candidate) => candidate.code === code);
  if (task === undefined) throw new Error(`no scenario task ${code}`);
  return task;
};

const reviewerState = (done: number, assigned: number, signed: boolean): MyStatus => {
  if (signed) return "signed-off";
  if (done >= assigned) return "submitted";
  return done > 0 ? "in-review" : "not-started";
};

const ownerStatus = (task: ScenarioReviewTask): TaskStatus => {
  if (task.status === "signed") return "signed-off";
  if ((task.ownerView?.openDisagreements ?? 0) > 0) return "disagreements";
  const progress = Object.values(task.ownerView?.progress ?? task.progress);
  return progress.some((done) => (done ?? 0) > 0) ? "in-review" : "not-started";
};

export const toAssignedTask = (task: ScenarioReviewTask): AssignedTask => {
  const progress = task.ownerView?.progress ?? task.progress;
  const assigned = assignedTo(task);
  return {
    id: task.id,
    code: task.code,
    name: task.name,
    project: toProjectRef(projectByCode(task.project)),
    due_on: task.dueOn,
    status: ownerStatus(task),
    open_disagreements: task.ownerView?.openDisagreements ?? 0,
    reviewers: task.reviewers.map((key) => {
      const done = progress[key] ?? 0;
      return {
        user_id: people[key].id,
        slides_submitted: done,
        slides_assigned: assigned,
        state: reviewerState(done, assigned, task.status === "signed"),
      };
    }),
  };
};

export const tasksAssignedBy = (viewer: PersonKey) =>
  reviewTasks
    .filter((task) => projectByCode(task.project).owner === viewer)
    .map(toAssignedTask)
    .sort((a, b) => order(a) - order(b));

const order = (task: AssignedTask) =>
  reviewTasks.findIndex((candidate) => candidate.id === task.id);

const slideStatus = (row: { sets: unknown[]; reviews: unknown[] }): State => {
  if (row.sets.length === 0) return "uploaded";
  return row.reviews.length > 0 ? "in-review" : "ready";
};

export const toSlideRow = (slideId: string): SlideRow => {
  const slide = slides.find((candidate) => candidate.id === slideId);
  if (slide === undefined) throw new Error(`no scenario slide ${slideId}`);
  const project = projectByCode(slide.project);
  const reviews = slideReviews
    .filter((review) => slideByIndex(review.slide).id === slideId)
    .map((review) => {
      const task = taskByCode(review.task);
      return {
        task_id: task.id,
        task_code: task.code,
        user_id: people[review.by].id,
        state: review.state,
      };
    });
  const sets = slide.sets.map((key) => {
    const set = resultSets.find((candidate) => candidate.key === key);
    if (set === undefined) throw new Error(`no scenario result set ${key}`);
    return { id: set.id, name: `${set.name} ${set.version}`, status: "ready" as const };
  });
  const caseId = cases.find((item) => item.label === slide.caseLabel)?.id ?? null;
  return {
    id: slide.id,
    label: slide.label,
    project: toProjectRef(project),
    case_id: caseId,
    case_label: slide.caseLabel,
    result_sets: sets,
    reviews,
    status: slideStatus({ sets, reviews }),
    created_at: "2026-10-12T09:00:00+02:00",
  };
};

const taskIdOf = (code: string) => taskByCode(code).id;

const appLink = (item: ScenarioNotification): string => {
  const p07 = projectByCode("P07");
  const a1 = slideByIndex(1);
  if (item.kind === "mention" || item.kind === "reply") {
    const object = encodeURIComponent(item.objectId ?? "");
    return `/projects/${p07.id}/slides/${a1.id}?task=${taskIdOf("RT-14")}&object=${object}`;
  }
  if (item.kind === "task-signed-off") return `/tasks/${taskIdOf("RT-09")}/evaluation`;
  if (item.kind === "task-assigned") return `/tasks/${taskIdOf("RT-14")}/guided?slide=${a1.id}`;
  return `/projects/${p07.id}?tab=slides`;
};

const targetOf = (item: ScenarioNotification): Pick<InboxItem, "target_kind" | "target_id"> => {
  if (item.kind === "mention" || item.kind === "reply") {
    return { target_kind: "thread", target_id: item.id };
  }
  if (item.kind === "task-assigned") return { target_kind: "task", target_id: taskIdOf("RT-14") };
  if (item.kind === "task-signed-off") {
    return { target_kind: "evaluation", target_id: taskIdOf("RT-09") };
  }
  return { target_kind: "job", target_id: item.id };
};

const notificationKinds = [
  "mention",
  "reply",
  "model-run-finished",
  "model-run-paused",
  "upload-done",
  "task-signed-off",
  "task-assigned",
] as const satisfies readonly NotificationKind[];

export function createInbox() {
  const read = new Set(notifications.filter((item) => item.read).map((item) => item.id));

  const toItem = (item: ScenarioNotification): InboxItem => ({
    id: item.id,
    kind: item.kind,
    link: appLink(item),
    ...targetOf(item),
    payload: {
      actor_user_id: item.actor === null ? null : people[item.actor].id,
      title: item.title,
      detail: item.detail,
      quote: item.quote ?? null,
      object_id: item.objectId ?? null,
      slide_label: item.slideLabel ?? null,
      action: item.action,
    },
    project_id: projectByCode("P07").id,
    task_id: item.kind === "task-signed-off" ? taskIdOf("RT-09") : taskIdOf("RT-14"),
    case_id: null,
    muted: false,
    read: read.has(item.id),
    read_at: read.has(item.id) ? item.createdAt : null,
    created_at: item.createdAt,
  });

  const list = (url: URL): InboxItem[] => {
    const kinds = url.searchParams.getAll("kind");
    const readParam = url.searchParams.get("read");
    return notifications
      .map(toItem)
      .filter((item) => kinds.length === 0 || kinds.includes(item.kind))
      .filter((item) => readParam === null || String(item.read) === readParam);
  };

  const counts = (): InboxCounts => {
    const items = notifications.map(toItem);
    return {
      total: items.length,
      unread: items.filter((item) => !item.read).length,
      kinds: notificationKinds.map((kind) => ({
        kind,
        total: items.filter((item) => item.kind === kind).length,
        unread: items.filter((item) => item.kind === kind && !item.read).length,
      })),
      muted: 0,
      muted_unread: 0,
    };
  };

  const mark = (body: MarkRead) => {
    const before = read.size;
    for (const item of notifications) {
      const chosen =
        body.all === true ||
        (body.ids ?? []).includes(item.id) ||
        (body.kinds ?? []).includes(item.kind);
      if (chosen) read.add(item.id);
    }
    return { marked: read.size - before, unread: notifications.length - read.size };
  };

  return { list, counts, mark };
}

const searchIndex = (): SearchHit[] => [
  ...projects.map((project) => ({
    kind: "project" as const,
    id: project.id,
    label: `${project.code} · ${project.name}`,
  })),
  ...cases.map((item) => ({
    kind: "case" as const,
    id: item.id,
    label: item.label,
    project: toProjectRef(projectByCode(item.project)),
    case_label: item.label,
  })),
  ...slides.map((slide) => ({
    kind: "slide" as const,
    id: slide.id,
    label: slide.caseLabel ? `${slide.caseLabel} ${slide.label}` : slide.label,
    project: toProjectRef(projectByCode(slide.project)),
    case_label: slide.caseLabel,
    slide_id: slide.id,
  })),
  ...["T1", "T2", "T3", "T4", "T5", "T1·C145", "T2·C145"].map((objectId) => ({
    kind: "object" as const,
    id: `P07/S26-04812/A1/${objectId}`,
    label: `${objectId} on A1`,
    project: toProjectRef(projectByCode("P07")),
    case_label: "S26-04812",
    slide_id: slideByIndex(1).id,
    object_id: objectId,
  })),
  ...Object.values(people).map((person) => ({
    kind: "person" as const,
    id: person.id,
    label: person.name,
  })),
];

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export const searchScenario = (query: string): SearchHit[] => {
  const needle = fold(query.trim());
  if (needle.length < 2) return [];
  return searchIndex()
    .filter((hit) => fold(hit.label).includes(needle))
    .slice(0, 8);
};

const decisionsOf = (taskId: string, slideId: string) => {
  const task = reviewTasks.find((candidate) => candidate.id === taskId);
  return slideDecisions.find(
    (item) => item.task === task?.code && slideByIndex(item.slide).id === slideId,
  );
};

export const reviewOrderOf = (taskId: string, slideId: string): ReviewOrder => ({
  task_id: taskId,
  slide_id: slideId,
  total: decisionsOf(taskId, slideId)?.total ?? 0,
  offset: 0,
  objects: [],
});

export const verdictsOf = (taskId: string, slideId: string): Verdict[] => {
  const decisions = decisionsOf(taskId, slideId);
  if (decisions === undefined) return [];
  const values: VerdictValue[] = [
    ...Array<VerdictValue>(decisions.agree).fill("agree"),
    ...Array<VerdictValue>(decisions.disagree).fill("disagree"),
    ...Array<VerdictValue>(decisions.unsure).fill("unsure"),
  ];
  return values.map((value, index) => {
    const region = index < 5;
    return {
      object: region ? `T${index + 1}` : `T1·C${index + 96}`,
      kind: region ? "region" : "cell",
      number: index + 1,
      value,
      reason: null,
      reason_class_id: null,
      note: null,
      updated_at: "2026-10-15T14:10:00+02:00",
    };
  });
};

export function workHandlers(): RequestHandler[] {
  const inbox = createInbox();
  return [
    getListTasksAssignedByMeMockHandler(() => tasksAssignedBy(fakeView().viewer)),
    getListMySlidesMockHandler(() => ({
      slides: myWorkSlideIds.map(toSlideRow),
      next_cursor: null,
    })),
    getListNotificationsMockHandler(({ request }) => ({
      notifications: inbox.list(new URL(request.url)),
      next_cursor: null,
    })),
    getGetNotificationCountsMockHandler(() => inbox.counts()),
    getMarkNotificationsReadMockHandler(async ({ request }) =>
      inbox.mark((await request.json()) as MarkRead),
    ),
    getSearchMockHandler(({ request }) => {
      const query = new URL(request.url).searchParams.get("q") ?? "";
      return { query, hits: searchScenario(query) };
    }),
    getListAnnouncementsMockHandler(announcements.map(toAnnouncement)),
    getGetReviewOrderMockHandler(({ params }) =>
      reviewOrderOf(String(params["taskId"]), String(params["slideId"])),
    ),
    getListVerdictsMockHandler(({ params }) =>
      verdictsOf(String(params["taskId"]), String(params["slideId"])),
    ),
  ];
}
