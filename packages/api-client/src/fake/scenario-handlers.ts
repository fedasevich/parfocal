import { HttpResponse, http, type RequestHandler } from "msw";
import {
  getGetMeMockHandler,
  getGetMyHomeMockHandler,
  getGetSessionMockHandler,
  getListMyReviewTasksMockHandler,
  getListProjectsMockHandler,
} from "../generated/api.msw.ts";
import type {
  Announcement,
  Home,
  HomeProject,
  Me,
  MyStatus,
  MyTask,
  Project,
  ProjectRef,
  Session,
  Workspace,
} from "../generated/api.ts";
import {
  announcements,
  type PersonKey,
  people,
  projectByCode,
  projects,
  resumePoint,
  reviewTasks,
  type ScenarioAnnouncement,
  type ScenarioProject,
  type ScenarioReviewTask,
  sampleProject,
  slideOf,
  slides,
  week,
  workspaces,
} from "./scenario.ts";
import { fakeView } from "./view.ts";

const me = () => people[fakeView().viewer];

const toWorkspace = (workspace: (typeof workspaces)[number]): Workspace => ({
  tenant_id: workspace.id,
  role: me().role,
  admin_rights: false,
  slug: workspace.slug,
  name: workspace.name,
  kind: workspace.kind,
  status: "active",
  organisation_name: workspace.organisation,
});

export const toMe = (): Me => ({
  user_id: me().id,
  display_name: me().name,
  initials: me().key,
  avatar_colour: me().colour,
  title: me().title,
  email: me().email,
  active_tenant_id: workspaces[0]?.id ?? null,
  workspaces: workspaces.map(toWorkspace),
});

export const toSession = (): Session => ({
  subject: me().id,
  name: me().name,
  email: me().email,
  operator: false,
});

const roleIn = (project: ScenarioProject, key: PersonKey) =>
  project.owner === key ? "owner" : project.members.includes(key) ? "reviewer" : null;

export const toProject = (project: ScenarioProject): Project => ({
  id: project.id,
  code: project.code,
  number: Number(project.code.slice(1)),
  name: project.name,
  colour: project.colour,
  privacy_mode: project.privacy,
  template: project.template,
  archived_at: null,
  created_at: project.createdAt,
  my_role: roleIn(project, fakeView().viewer),
  members: project.members.map((key) => ({
    user_id: people[key].id,
    role: roleIn(project, key) ?? "viewer",
  })),
});

export const toProjectRef = (
  project: Pick<ScenarioProject, "id" | "code" | "name">,
): ProjectRef => ({
  id: project.id,
  code: project.code,
  name: project.name,
});

const myStatus = (task: ScenarioReviewTask, done: number, assigned: number): MyStatus => {
  if (task.status === "signed") return "signed-off";
  if (done >= assigned) return "submitted";
  return done > 0 ? "in-review" : "not-started";
};

export const assignedTo = (task: ScenarioReviewTask) =>
  task.split === "even" ? Math.ceil(task.slides / task.reviewers.length) : task.slides;

export const toMyTask = (task: ScenarioReviewTask, viewer = fakeView().viewer): MyTask => {
  const project = projectByCode(task.project);
  const done = task.progress[viewer] ?? 0;
  const assigned = assignedTo(task);
  return {
    id: task.id,
    code: task.code,
    name: task.name,
    project: toProjectRef(project),
    scope: task.scope,
    due_on: task.dueOn,
    blinded: task.blinded,
    start_mode: "guided",
    slides_submitted: done,
    slides_assigned: assigned,
    verdicts: done * 24,
    status: myStatus(task, done, assigned),
    next_slide_id: task.status === "signed" ? null : (slides[0]?.id ?? null),
    created_by_user_id: people[project.owner].id,
  };
};

export const myTasks = () => {
  const viewer = fakeView().viewer;
  return reviewTasks
    .filter((task) => task.reviewers.includes(viewer))
    .map((task) => toMyTask(task, viewer));
};

const stripLength = 4;

const coverStrip = (
  code: string,
  own: { id: string; label: string }[],
  total: number,
  reviewedPercent: number,
) => {
  const shown = Math.min(stripLength, total);
  const seen = Math.round((reviewedPercent / 100) * shown);
  return Array.from({ length: shown }, (_, index) => ({
    id: own[index]?.id ?? `${code}-cover-${index + 1}`,
    label: own[index]?.label ?? `${code} slide ${index + 1}`,
    reviewed: index < seen,
  }));
};

const toHomeProject = (project: ScenarioProject): HomeProject => {
  const own = slides
    .filter((candidate) => candidate.project === project.code)
    .map((candidate) => ({
      id: candidate.id,
      label: candidate.caseLabel ? `${candidate.caseLabel} ${candidate.label}` : candidate.label,
    }));
  const { counts } = project;
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    colour: project.colour,
    privacy_mode: project.privacy,
    my_role: roleIn(project, fakeView().viewer) ?? "viewer",
    members: project.members.length,
    slides: counts.slides,
    result_sets: counts.resultSets,
    reviewed_slides: Math.round((counts.reviewedPercent / 100) * counts.slides),
    strip: coverStrip(project.code, own, counts.slides, counts.reviewedPercent),
  };
};

const sampleHomeProject = (): HomeProject => ({
  id: sampleProject.id,
  code: sampleProject.code,
  name: sampleProject.name,
  colour: sampleProject.colour,
  privacy_mode: "de-identified",
  my_role: "owner",
  members: sampleProject.members.length,
  slides: sampleProject.counts.slides,
  result_sets: sampleProject.counts.resultSets,
  reviewed_slides: 0,
  strip: coverStrip(sampleProject.code, [], sampleProject.counts.slides, 0),
});

const resumeTarget = (task: ScenarioReviewTask): Home["resume"] => {
  const project = projectByCode(resumePoint.project);
  const resumeSlide = slideOf(resumePoint.project, resumePoint.caseLabel, resumePoint.slideLabel);
  return {
    task_id: task.id,
    task_code: task.code,
    task_name: task.name,
    project: toProjectRef(project),
    slide_id: resumeSlide.id,
    slide_label: resumeSlide.label,
    case_label: resumeSlide.caseLabel,
    position: resumePoint.position,
    slides_assigned: task.slides,
    object_id: resumePoint.object,
    verdicts_on_slide: 38,
    due_on: task.dueOn,
    blinded: task.blinded,
    camera: null,
  };
};

export const toHome = (): Home => {
  const { viewer, firstWeek } = fakeView();
  const task = reviewTasks.find((candidate) => candidate.code === resumePoint.task);
  if (task === undefined) throw new Error(`no scenario task ${resumePoint.task}`);
  const resumes = !firstWeek && task.reviewers.includes(viewer) && task.status !== "signed";
  const mine = projects.filter((candidate) => candidate.members.includes(viewer));
  return {
    resume: resumes ? resumeTarget(task) : null,
    tasks: myTasks(),
    projects: firstWeek
      ? [sampleHomeProject(), ...mine.slice(0, 1).map(toHomeProject)]
      : mine.map(toHomeProject),
    slides_without_results: slides.filter(
      (candidate) => candidate.sets.length === 0 && mine.some((p) => p.code === candidate.project),
    ).length,
    week: {
      since: week.since,
      objects_checked: week.objectsChecked,
      agreed: week.agreed,
      agree_share: week.agreed / week.objectsChecked,
      open_disagreements: week.openDisagreements,
    },
    announcements: announcementsFor(firstWeek).map(toAnnouncement),
  };
};

export const toAnnouncement = (item: ScenarioAnnouncement): Announcement => ({
  id: item.id,
  kind: item.kind,
  text: item.text,
  ends_at: item.endsAt,
  created_by_user_id: null,
  created_at: item.createdAt,
});

const announcementsFor = (firstWeek: boolean) =>
  firstWeek ? announcements.filter((item) => item.kind === "change") : announcements;

const projectNotFound = () =>
  HttpResponse.json(
    { type: "about:blank", title: "Project not found", status: 404, code: "not-found" },
    { status: 404, headers: { "content-type": "application/problem+json" } },
  );

export function scenarioHandlers(): RequestHandler[] {
  return [
    getGetSessionMockHandler(() => toSession()),
    getGetMeMockHandler(() => toMe()),
    getGetMyHomeMockHandler(() => toHome()),
    getListMyReviewTasksMockHandler(() => myTasks()),
    getListProjectsMockHandler(projects.map(toProject)),
    http.get<{ projectId: string }>("*/api/projects/:projectId", ({ params }) => {
      const project = projects.find(
        (candidate) => candidate.id === params.projectId || candidate.code === params.projectId,
      );
      return project === undefined ? projectNotFound() : HttpResponse.json(toProject(project));
    }),
  ];
}
