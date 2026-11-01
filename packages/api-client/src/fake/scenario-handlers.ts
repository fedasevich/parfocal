import { HttpResponse, http, type RequestHandler } from "msw";
import {
  getGetMeMockHandler,
  getGetMyHomeMockHandler,
  getGetSessionMockHandler,
  getListMyReviewTasksMockHandler,
  getListProjectsMockHandler,
} from "../generated/api.msw.ts";
import type {
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
  type PersonKey,
  people,
  projectByCode,
  projects,
  resultSets,
  resumePoint,
  reviewTasks,
  type ScenarioProject,
  type ScenarioReviewTask,
  signedInAs,
  slideOf,
  slides,
  workspaces,
} from "./scenario.ts";

const me = people[signedInAs];

const toWorkspace = (workspace: (typeof workspaces)[number]): Workspace => ({
  tenant_id: workspace.id,
  role: me.role,
  admin_rights: false,
  slug: workspace.slug,
  name: workspace.name,
  kind: workspace.kind,
  status: "active",
  organisation_name: workspace.organisation,
});

export const toMe = (): Me => ({
  user_id: me.id,
  display_name: me.name,
  initials: me.key,
  avatar_colour: me.colour,
  title: me.title,
  email: me.email,
  active_tenant_id: workspaces[0]?.id ?? null,
  workspaces: workspaces.map(toWorkspace),
});

export const toSession = (): Session => ({
  subject: me.id,
  name: me.name,
  email: me.email,
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
  my_role: roleIn(project, signedInAs),
  members: project.members.map((key) => ({
    user_id: people[key].id,
    role: roleIn(project, key) ?? "viewer",
  })),
});

const toProjectRef = (project: ScenarioProject): ProjectRef => ({
  id: project.id,
  code: project.code,
  name: project.name,
});

const myStatus = (task: ScenarioReviewTask, done: number): MyStatus => {
  if (task.status === "signed") return "signed-off";
  if (done >= task.slides) return "submitted";
  return done > 0 ? "in-review" : "not-started";
};

export const toMyTask = (task: ScenarioReviewTask): MyTask => {
  const project = projectByCode(task.project);
  const done = task.progress[signedInAs] ?? 0;
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
    slides_assigned: task.slides,
    verdicts: done * 24,
    status: myStatus(task, done),
    next_slide_id: task.status === "signed" ? null : (slides[0]?.id ?? null),
    created_by_user_id: people[project.owner].id,
  };
};

export const myTasks = () =>
  reviewTasks.filter((task) => task.reviewers.includes(signedInAs)).map(toMyTask);

const toHomeProject = (project: ScenarioProject): HomeProject => {
  const own = slides.filter((candidate) => candidate.project === project.code);
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    colour: project.colour,
    privacy_mode: project.privacy,
    my_role: roleIn(project, signedInAs) ?? "viewer",
    members: project.members.length,
    slides: own.length,
    result_sets: resultSets.filter((set) => set.project === project.code).length,
    reviewed_slides: own.filter((candidate) => candidate.state === "ready").length,
    strip: own.map((candidate) => ({
      id: candidate.id,
      label: candidate.caseLabel ? `${candidate.caseLabel} ${candidate.label}` : candidate.label,
      reviewed: candidate.state === "ready",
    })),
  };
};

export const toHome = (): Home => {
  const task = reviewTasks.find((candidate) => candidate.code === resumePoint.task);
  if (task === undefined) throw new Error(`no scenario task ${resumePoint.task}`);
  const project = projectByCode(resumePoint.project);
  const resumeSlide = slideOf(resumePoint.project, resumePoint.caseLabel, resumePoint.slideLabel);
  return {
    resume: {
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
    },
    tasks: myTasks(),
    projects: projects
      .filter((candidate) => candidate.members.includes(signedInAs))
      .map(toHomeProject),
    slides_without_results: slides.filter((candidate) => candidate.state === "processing").length,
    week: {
      since: "2026-10-12",
      objects_checked: 412,
      agreed: 371,
      agree_share: 0.9,
      open_disagreements: 6,
    },
    announcements: [],
  };
};

const projectNotFound = () =>
  HttpResponse.json(
    { type: "about:blank", title: "Project not found", status: 404, code: "not-found" },
    { status: 404, headers: { "content-type": "application/problem+json" } },
  );

export function scenarioHandlers(): RequestHandler[] {
  return [
    getGetSessionMockHandler(toSession()),
    getGetMeMockHandler(toMe()),
    getGetMyHomeMockHandler(toHome()),
    getListMyReviewTasksMockHandler(myTasks()),
    getListProjectsMockHandler(projects.map(toProject)),
    http.get<{ projectId: string }>("*/api/projects/:projectId", ({ params }) => {
      const project = projects.find(
        (candidate) => candidate.id === params.projectId || candidate.code === params.projectId,
      );
      return project === undefined ? projectNotFound() : HttpResponse.json(toProject(project));
    }),
  ];
}
