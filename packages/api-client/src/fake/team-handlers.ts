import { HttpResponse, http } from "msw";
import {
  type TeamReviewer,
  TeamReviewerStatus,
  type TeamTask,
  type TeamWorkload,
  teamWorkloadSchema,
} from "../draft/list-team-workload.ts";
import { type Nudge, type Reassignment, ReassignWhat } from "../draft/team-actions.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import {
  type PersonKey,
  people,
  projectByCode,
  reviewTasks,
  type ScenarioReviewTask,
} from "./scenario.ts";
import { away, newTask } from "./scenario-task.ts";
import {
  awaySceneAbsence,
  lastDecisions,
  minutesPerSlide,
  overdueNow,
  sentTaskAt,
  sentTaskSlides,
  teamNow,
} from "./scenario-team.ts";
import { type FakeTeamScene, fakeTeamScene, nextActionId, teamActions } from "./team-scene.ts";
import { fakeView } from "./view.ts";

type TeamStatus = keyof typeof TeamReviewerStatus;

const dayNumber = (day: string) => {
  const [year = 0, month = 1, date = 1] = day.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 86_400_000;
};

export function teamReviewerStatus(row: {
  done: number;
  assigned: number;
  today: string;
  sentOn: string;
  dueOn: string;
  awayUntil: string | null;
}): TeamStatus {
  const now = dayNumber(row.today);
  const sent = dayNumber(row.sentOn);
  const due = dayNumber(row.dueOn);
  const share = due > sent ? Math.min(1, Math.max(0, (now - sent) / (due - sent))) : 1;
  if (row.assigned - row.done <= 0) return TeamReviewerStatus.done;
  if (row.awayUntil !== null) return TeamReviewerStatus.away;
  if (row.done === 0 && now <= due) return TeamReviewerStatus["not-started"];
  if (now > due || row.done / row.assigned < share) return TeamReviewerStatus.behind;
  return TeamReviewerStatus["on-track"];
}

type TeamSource = {
  code: string;
  id: string;
  name: string;
  project: ScenarioReviewTask["project"];
  reviewers: PersonKey[];
  slides: number;
  split: ScenarioReviewTask["split"];
  progress: Partial<Record<PersonKey, number>>;
  sentOn: string;
  sentAt: string;
  dueOn: string;
  signedOn: string | null;
};

const fromScenario = (task: ScenarioReviewTask): TeamSource => ({
  code: task.code,
  id: task.id,
  name: task.name,
  project: task.project,
  reviewers: task.reviewers,
  slides: task.slides,
  split: task.split,
  progress: task.progress,
  sentOn: task.sentOn,
  sentAt: `${task.sentOn}T09:00:00+02:00`,
  dueOn: task.dueOn,
  signedOn: task.status === "signed" ? (task.signedOn ?? task.dueOn) : null,
});

const sentTask = (): TeamSource => ({
  code: newTask.code,
  id: newTask.id,
  name: newTask.names[newTask.resultSet],
  project: newTask.project,
  reviewers: newTask.reviewers,
  slides: sentTaskSlides,
  split: "all",
  progress: {},
  sentOn: newTask.sentOn,
  sentAt: sentTaskAt,
  dueOn: newTask.dueOn,
  signedOn: null,
});

const isSigned = (task: TeamSource) => task.signedOn !== null;

const teamSources = (scene: FakeTeamScene) => [
  ...reviewTasks.map(fromScenario),
  ...(scene.sent ? [sentTask()] : []),
];

const sourceById = (taskId: string) =>
  teamSources(fakeTeamScene()).find((task) => task.id === taskId || task.code === taskId);

const keyOf = (userId: string) =>
  (Object.keys(people) as PersonKey[]).find((key) => people[key].id === userId);

export const teamAsOf = (scene: FakeTeamScene = fakeTeamScene()) =>
  scene.now === "overdue" ? overdueNow : teamNow;

const awayUntil = (key: PersonKey, today: string, scene: FakeTeamScene) => {
  const absences = [...away, ...(scene.away === awaySceneAbsence.key ? [awaySceneAbsence] : [])];
  const found = absences.find((item) => item.key === key && item.until >= today.slice(0, 10));
  return found?.until ?? null;
};

type Row = { key: PersonKey; done: number; assigned: number; assignedAt: string };

const perReviewer = (task: TeamSource, index: number) => {
  if (task.split === "all") return task.slides;
  const count = task.reviewers.length;
  return Math.floor(task.slides / count) + (index < task.slides % count ? 1 : 0);
};

const reviewerRows = (task: TeamSource, asOf: string): Row[] => {
  let rows: Row[] = task.reviewers.map((key, index) => ({
    key,
    done: task.progress[key] ?? 0,
    assigned: perReviewer(task, index),
    assignedAt: task.sentAt,
  }));
  for (const move of teamActions().reassignments.filter((item) => item.task === task.id)) {
    rows = rows
      .map((row) =>
        row.key === move.from ? { ...row, assigned: move.what === "all" ? 0 : row.done } : row,
      )
      .filter((row) => row.assigned > 0);
    rows.push({ key: move.to, done: 0, assigned: move.slides, assignedAt: asOf });
  }
  return rows;
};

const lastDecisionAt = (task: TeamSource, row: Row, asOf: string) => {
  const seeded = lastDecisions.find((item) => item.task === task.code && item.by === row.key);
  if (seeded) return seeded.at;
  return row.done > 0 ? `${asOf.slice(0, 10)}T09:00:00+02:00` : null;
};

const nudgedAt = (task: TeamSource, key: PersonKey) =>
  teamActions()
    .nudges.filter((nudge) => nudge.task === task.id && nudge.to === key)
    .at(-1)?.at ?? null;

const toTeamReviewer = (task: TeamSource, row: Row, asOf: string, scene: FakeTeamScene) => {
  const until = awayUntil(row.key, asOf, scene);
  const reviewer: TeamReviewer = {
    user_id: people[row.key].id,
    slides_done: row.done,
    slides_assigned: row.assigned,
    status: teamReviewerStatus({
      done: row.done,
      assigned: row.assigned,
      today: asOf,
      sentOn: task.sentOn,
      dueOn: task.dueOn,
      awayUntil: until,
    }),
    minutes_left: Math.max(0, row.assigned - row.done) * minutesPerSlide,
    away_until: until,
    assigned_at: row.assignedAt,
    last_decision_at: lastDecisionAt(task, row, asOf),
    nudged_at: nudgedAt(task, row.key),
  };
  return reviewer;
};

const toTeamTask = (task: TeamSource, asOf: string, scene: FakeTeamScene): TeamTask => {
  const project = projectByCode(task.project);
  return {
    id: task.id,
    code: task.code,
    name: task.name,
    project: { id: project.id, code: project.code, name: project.name },
    slides: task.slides,
    split: task.split,
    sent_on: task.sentOn,
    due_on: task.dueOn,
    signed_on: task.signedOn,
    reviewers: reviewerRows(task, asOf).map((row) => toTeamReviewer(task, row, asOf, scene)),
  };
};

export function toTeamWorkload(
  viewer: PersonKey = fakeView().viewer,
  scene: FakeTeamScene = fakeTeamScene(),
): TeamWorkload {
  const asOf = teamAsOf(scene);
  const mine = teamSources(scene).filter((task) => projectByCode(task.project).owner === viewer);
  return teamWorkloadSchema.parse({
    as_of: asOf,
    open: mine
      .filter((task) => !isSigned(task))
      .sort((a, b) => dayNumber(a.dueOn) - dayNumber(b.dueOn))
      .map((task) => toTeamTask(task, asOf, scene)),
    done: mine
      .filter(isSigned)
      .sort((a, b) => dayNumber(b.signedOn ?? "") - dayNumber(a.signedOn ?? ""))
      .map((task) => toTeamTask(task, asOf, scene)),
  });
}

const problem = (status: number, title: string, code: string, detail: string) =>
  HttpResponse.json(
    { type: "about:blank", title, status, code, detail },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const notFound = () => problem(404, "Review task not found", "not-found", "No such review task.");

export const getListTeamWorkloadMockHandler = (overrideResponse?: TeamWorkload) =>
  http.get("*/api/me/team", () => HttpResponse.json(overrideResponse ?? toTeamWorkload()));

export const getNudgeReviewerMockHandler = (overrideResponse?: Nudge) =>
  http.post<{ taskId: string }, { user_id?: string; message?: string }>(
    "*/api/review-tasks/:taskId/nudges",
    async ({ params, request }) => {
      if (overrideResponse) return HttpResponse.json(overrideResponse, { status: 201 });
      const task = sourceById(params.taskId);
      if (task === undefined) return notFound();
      const body = await request.json();
      const to = keyOf(body.user_id ?? "");
      if (to === undefined || !(body.message ?? "").trim()) {
        return problem(422, "Nudge is not valid", "validation", "Pick a reviewer and a message.");
      }
      const nudge = {
        id: nextActionId(60),
        task: task.id,
        to,
        message: body.message ?? "",
        at: teamAsOf(),
      };
      teamActions().nudges.push(nudge);
      const created: Nudge = {
        id: nudge.id,
        task_id: task.id,
        user_id: people[to].id,
        sent_at: nudge.at,
      };
      return HttpResponse.json(created, { status: 201 });
    },
  );

export const getCancelNudgeMockHandler = () =>
  http.delete<{ taskId: string; nudgeId: string }>(
    "*/api/review-tasks/:taskId/nudges/:nudgeId",
    ({ params }) => {
      const store = teamActions();
      store.nudges = store.nudges.filter((nudge) => nudge.id !== params.nudgeId);
      return new HttpResponse(null, { status: 204 });
    },
  );

export const getReassignSlidesMockHandler = (overrideResponse?: Reassignment) =>
  http.post<
    { taskId: string },
    { from_user_id?: string; to_user_id?: string; what?: string; note?: string | null }
  >("*/api/review-tasks/:taskId/reassignments", async ({ params, request }) => {
    if (overrideResponse) return HttpResponse.json(overrideResponse, { status: 201 });
    const task = sourceById(params.taskId);
    if (task === undefined) return notFound();
    const body = await request.json();
    const from = keyOf(body.from_user_id ?? "");
    const to = keyOf(body.to_user_id ?? "");
    const what = body.what === ReassignWhat.all ? ReassignWhat.all : ReassignWhat["not-started"];
    const row = reviewerRows(task, teamAsOf()).find((candidate) => candidate.key === from);
    if (from === undefined || to === undefined || row === undefined) {
      return problem(422, "Reassignment is not valid", "validation", "Pick who takes the slides.");
    }
    if (from === to || task.reviewers.includes(to)) {
      return problem(
        409,
        "Already reviews this task",
        "conflict",
        `${people[to].name} already has slides in ${task.code}.`,
      );
    }
    const slides = what === ReassignWhat.all ? row.assigned : row.assigned - row.done;
    const move = {
      id: nextActionId(61),
      task: task.id,
      from,
      to,
      what,
      slides,
      note: body.note ?? null,
    };
    teamActions().reassignments.push(move);
    const created: Reassignment = {
      id: move.id,
      task_id: task.id,
      from_user_id: people[from].id,
      to_user_id: people[to].id,
      what,
      slides_moved: slides,
    };
    return HttpResponse.json(created, { status: 201 });
  });

export const getUndoReassignmentMockHandler = () =>
  http.delete<{ taskId: string; reassignmentId: string }>(
    "*/api/review-tasks/:taskId/reassignments/:reassignmentId",
    ({ params }) => {
      const store = teamActions();
      store.reassignments = store.reassignments.filter((move) => move.id !== params.reassignmentId);
      return new HttpResponse(null, { status: 204 });
    },
  );

export const teamDraftOperations: DraftOperation[] = [
  {
    operationId: "listTeamWorkload",
    method: "get",
    path: "/api/me/team",
    handler: () => getListTeamWorkloadMockHandler(),
  },
  {
    operationId: "nudgeReviewer",
    method: "post",
    path: "/api/review-tasks/{task_id}/nudges",
    handler: () => getNudgeReviewerMockHandler(),
  },
  {
    operationId: "cancelNudge",
    method: "delete",
    path: "/api/review-tasks/{task_id}/nudges/{nudge_id}",
    handler: () => getCancelNudgeMockHandler(),
  },
  {
    operationId: "reassignSlides",
    method: "post",
    path: "/api/review-tasks/{task_id}/reassignments",
    handler: () => getReassignSlidesMockHandler(),
  },
  {
    operationId: "undoReassignment",
    method: "delete",
    path: "/api/review-tasks/{task_id}/reassignments/{reassignment_id}",
    handler: () => getUndoReassignmentMockHandler(),
  },
];
