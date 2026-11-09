import { HttpResponse, http, type RequestHandler } from "msw";
import {
  getGetMeMockHandler,
  getGetMyHomeMockHandler,
  getGetSessionMockHandler,
  getListMyReviewTasksMockHandler,
  getListProjectsMockHandler,
  getListTenantMembersMockHandler,
} from "../generated/api.msw.ts";
import type {
  Announcement,
  Home,
  HomeProject,
  Me,
  Member,
  MyStatus,
  MyTask,
  Project,
  ProjectChange,
  ProjectRef,
  ProjectRole,
  Session,
  SignOutRight,
  Workspace,
} from "../generated/api.ts";
import { viewerPartsOf } from "./analysis-templates.ts";
import { currentAnnouncements } from "./announcement-board.ts";
import { profileChangeHandler, withProfileChanges } from "./profile-changes.ts";
import { linkImportHandler, sourceFilesHandler } from "./project-handlers.ts";
import {
  changeProjectDefaults,
  clinicalRoleOf,
  clinicalSignOutOf,
  projectDefaultsOf,
  setClinicalSignOut,
} from "./project-settings.ts";
import { storedResume } from "./resume-handlers.ts";
import {
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
  scenarioNow,
  slideOf,
  slides,
  week,
  workspaces,
} from "./scenario.ts";
import { adminRightsHolders, workspaceBrands } from "./scenario-admin.ts";
import { fakeView } from "./view.ts";
import {
  activeFakeWorkspace,
  inScenarioWorkspace,
  switchFakeWorkspace,
} from "./workspace-scene.ts";

const me = () => people[fakeView().viewer];

const toWorkspace = (workspace: (typeof workspaces)[number], index: number): Workspace => ({
  tenant_id: workspace.id,
  role: me().role,
  admin_rights: adminRightsHolders.includes(me().key),
  slug: workspace.slug,
  name: workspace.name,
  kind: workspace.kind,
  status: "active",
  organisation_name: workspace.organisation,
  logo: workspaceBrands[index]?.logo ?? workspace.name.slice(0, 2).toUpperCase(),
  logo_colour: workspaceBrands[index]?.colour ?? "#2f6fdf",
});

const scenarioMe = (): Me => ({
  user_id: me().id,
  display_name: me().name,
  initials: me().key,
  avatar_colour: me().colour,
  title: me().title,
  email: me().email,
  specialties: ["Breast", "Lymph nodes"],
  active_tenant_id: activeFakeWorkspace(),
  workspaces: workspaces.map(toWorkspace),
});

export const toMe = (): Me => withProfileChanges(scenarioMe());

export const toMembers = (): Member[] =>
  Object.values(people).map((person) => ({
    user_id: person.id,
    display_name: person.name,
    initials: person.key,
    avatar_colour: person.colour,
    title: person.title,
    role: person.role,
    admin_rights: adminRightsHolders.includes(person.key),
  }));

export const toSession = (): Session => ({
  subject: me().id,
  name: me().name,
  email: me().email,
  operator: false,
});

const roleIn = (project: ScenarioProject, key: PersonKey) =>
  project.owner === key ? "owner" : project.members.includes(key) ? "reviewer" : null;

const signOutIn = (project: ScenarioProject, role: ProjectRole): SignOutRight | null => {
  if (project.privacy !== "clinical") return null;
  return role === "viewer" ? "never" : "own";
};

export const toProject = (project: ScenarioProject): Project => ({
  id: project.id,
  code: project.code,
  number: Number(project.code.slice(1)),
  name: project.name,
  sample: false,
  colour: project.colour,
  privacy_mode: project.privacy,
  template: project.template,
  viewer_parts: viewerPartsOf(project.template),
  ...projectDefaultsOf(project),
  archived_at: null,
  created_at: project.createdAt,
  my_role: clinicalRoleOf(project, fakeView().viewer) ?? roleIn(project, fakeView().viewer),
  members: project.members.map((key) => {
    const clinical = clinicalRoleOf(project, key);
    const role = clinical ?? roleIn(project, key) ?? "viewer";
    return {
      user_id: people[key].id,
      role,
      sign_out: clinical === null ? signOutIn(project, role) : clinicalSignOutOf(key),
    };
  }),
});

const deletedProjects = new Set<string>();

const projectNamed = (projectId: string) =>
  projects.find(
    (candidate) =>
      !deletedProjects.has(candidate.id) &&
      (candidate.id === projectId || candidate.code === projectId),
  );

const nameMismatch = () =>
  HttpResponse.json(
    {
      type: "about:blank",
      title: "Type the project name exactly to delete it",
      status: 400,
      code: "project-name-mismatch",
    },
    { status: 400, headers: { "content-type": "application/problem+json" } },
  );

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

let arrivedTaskCount = 0;

export const arriveFakeWorklistTask = () => {
  arrivedTaskCount += 1;
};

export const resetFakeWorklistArrivals = () => {
  arrivedTaskCount = 0;
};

const arrivedTasks = (viewer: PersonKey): MyTask[] => {
  const template = reviewTasks.find((task) => task.reviewers.includes(viewer));
  if (template === undefined) return [];
  return Array.from({ length: arrivedTaskCount }, (_, index) => ({
    ...toMyTask(template, viewer),
    id: `00000000-0000-4000-8007-0000000009${String(index).padStart(2, "0")}`,
    code: `RT-${90 + index}`,
    name: "Task that arrived live",
    status: "not-started" as const,
  }));
};

export const myTasks = () => {
  if (!inScenarioWorkspace()) return [];
  const viewer = fakeView().viewer;
  return [
    ...reviewTasks
      .filter((task) => task.reviewers.includes(viewer))
      .map((task) => toMyTask(task, viewer)),
    ...arrivedTasks(viewer),
  ];
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
    mode: "guided",
    camera: null,
  };
};

const storedTarget = (viewer: PersonKey): Home["resume"] => {
  const stored = storedResume();
  if (stored === null) return null;
  const task = reviewTasks.find((candidate) => candidate.id === stored.task_id);
  const slide = slides.find((candidate) => candidate.id === stored.slide_id);
  if (task === undefined || slide === undefined) return null;
  if (!task.reviewers.includes(viewer) || task.status === "signed") return null;
  const derived = resumeTarget(task);
  if (derived === null) return null;
  const same = slide.id === derived.slide_id;
  return {
    ...derived,
    slide_id: slide.id,
    slide_label: slide.label,
    case_label: slide.caseLabel,
    position: same
      ? derived.position
      : slides.filter((candidate) => candidate.project === task.project).indexOf(slide),
    verdicts_on_slide: same ? derived.verdicts_on_slide : 0,
    object_id: stored.object_id ?? null,
    mode: stored.mode,
    camera: stored.camera ?? null,
  };
};

export const toHome = (): Home => {
  const { viewer, firstWeek } = fakeView();
  const task = reviewTasks.find((candidate) => candidate.code === resumePoint.task);
  if (task === undefined) throw new Error(`no scenario task ${resumePoint.task}`);
  const resumes = !firstWeek && task.reviewers.includes(viewer) && task.status !== "signed";
  const mine = projects.filter((candidate) => candidate.members.includes(viewer));
  return {
    resume: firstWeek ? null : (storedTarget(viewer) ?? (resumes ? resumeTarget(task) : null)),
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
  created_by_user_id: item.createdBy ?? null,
  created_at: item.createdAt,
});

const announcementsFor = (firstWeek: boolean) =>
  firstWeek
    ? currentAnnouncements().filter((item) => item.kind === "change")
    : currentAnnouncements();

const emptyWorkspaceHome = (home: Home): Home => ({
  ...home,
  resume: null,
  tasks: [],
  projects: [],
  slides_without_results: 0,
  week: { ...home.week, objects_checked: 0, agreed: 0, agree_share: 0, open_disagreements: 0 },
});

const switchRefused = (code: "not-a-member" | "tenant-suspended") =>
  HttpResponse.json(
    {
      type: "about:blank",
      title:
        code === "not-a-member"
          ? "You are not a member of this workspace"
          : "This workspace is suspended",
      status: 403,
      code,
    },
    { status: 403, headers: { "content-type": "application/problem+json" } },
  );

const projectNotFound = () =>
  HttpResponse.json(
    { type: "about:blank", title: "Project not found", status: 404, code: "not-found" },
    { status: 404, headers: { "content-type": "application/problem+json" } },
  );

export function scenarioHandlers(): RequestHandler[] {
  return [
    sourceFilesHandler(),
    linkImportHandler(),
    getGetSessionMockHandler(() => toSession()),
    getGetMeMockHandler(() => toMe()),
    profileChangeHandler(scenarioMe),
    getGetMyHomeMockHandler(() =>
      inScenarioWorkspace() ? toHome() : emptyWorkspaceHome(toHome()),
    ),
    getListMyReviewTasksMockHandler(() => myTasks()),
    getListProjectsMockHandler(() =>
      inScenarioWorkspace()
        ? projects.filter((project) => !deletedProjects.has(project.id)).map(toProject)
        : [],
    ),
    http.put("*/api/me/workspace", async ({ request }) => {
      const { tenant_id } = (await request.json()) as { tenant_id: string };
      const outcome = switchFakeWorkspace(tenant_id);
      if (outcome !== "switched") return switchRefused(outcome);
      const chosen = toMe().workspaces.find((workspace) => workspace.tenant_id === tenant_id);
      return HttpResponse.json(chosen);
    }),
    getListTenantMembersMockHandler(toMembers()),
    http.get("*/api/projects/deleted", () =>
      HttpResponse.json(
        projects
          .filter((project) => deletedProjects.has(project.id))
          .map((project) => ({
            id: project.id,
            code: project.code,
            name: project.name,
            colour: project.colour,
            deleted_at: scenarioNow,
          })),
      ),
    ),
    http.post<{ projectId: string }>("*/api/projects/:projectId/undelete", ({ params }) => {
      const project = projects.find((candidate) => candidate.id === params.projectId);
      if (project === undefined) return projectNotFound();
      deletedProjects.delete(project.id);
      return HttpResponse.json(toProject(project));
    }),
    http.get<{ projectId: string }>("*/api/projects/:projectId", ({ params }) => {
      const project = projectNamed(params.projectId);
      return project === undefined ? projectNotFound() : HttpResponse.json(toProject(project));
    }),
    http.patch<{ projectId: string }>("*/api/projects/:projectId", async ({ params, request }) => {
      const project = projectNamed(params.projectId);
      if (project === undefined) return projectNotFound();
      changeProjectDefaults(project, (await request.json()) as ProjectChange);
      return HttpResponse.json(toProject(project));
    }),
    http.delete<{ projectId: string }>("*/api/projects/:projectId", async ({ params, request }) => {
      const project = projectNamed(params.projectId);
      if (project === undefined) return projectNotFound();
      const { name } = (await request.json()) as { name: string };
      if (name.trim() !== project.name.trim()) return nameMismatch();
      deletedProjects.add(project.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.put<{ projectId: string; userId: string }>(
      "*/api/projects/:projectId/members/:userId/sign-out",
      async ({ params, request }) => {
        const project = projectNamed(params.projectId);
        const key = project?.members.find((member) => people[member].id === params.userId);
        if (project === undefined || key === undefined) return projectNotFound();
        const { sign_out } = (await request.json()) as { sign_out: SignOutRight };
        setClinicalSignOut(key, sign_out);
        const shown = toProject(project);
        const nobody = shown.members.every((member) => member.sign_out === "never");
        return HttpResponse.json({ project: shown, warning: nobody ? "no-one-signs-out" : null });
      },
    ),
  ];
}
