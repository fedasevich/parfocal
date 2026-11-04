import { HttpResponse, http, type RequestHandler } from "msw";
import {
  type ProjectScopeOptions,
  projectScopeOptionsSchema,
} from "../draft/get-project-scope-options.ts";
import {
  type ReviewTaskDefaults,
  reviewTaskDefaultsSchema,
} from "../draft/get-review-task-defaults.ts";
import { type ProjectSlide, projectSlideSchema } from "../draft/list-project-slides.ts";
import { type ReviewerWorkload, reviewerWorkloadSchema } from "../draft/list-reviewer-workload.ts";
import {
  type StudyTemplateReviewDefaults,
  studyTemplateReviewDefaultsSchema,
} from "../draft/list-study-template-review-defaults.ts";
import {
  getCreateReviewTaskMockHandler,
  getListAvailabilityMockHandler,
  getListStudyTemplatesMockHandler,
} from "../generated/api.msw.ts";
import type {
  MemberAvailability,
  ReviewTaskDetail,
  StudyTemplateSummary,
  TaskChange,
  TaskDraft,
} from "../generated/api.ts";
import {
  changeCountsAs,
  decisionSettingsFor,
  keepsAgreeAndDisagree,
  toDecisionSettings,
} from "./decision-settings.ts";
import { taskDisplayFor } from "./display-settings.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { people, projectByCode, projects, reviewTasks } from "./scenario.ts";
import { reportBlocksOf } from "./scenario-admin.ts";
import { rt13 } from "./scenario-review.ts";
import {
  away,
  displayDefault,
  newTask,
  opinionForms,
  resultSetIdOf,
  rois,
  studyTemplates,
  taskCaseId,
  taskReviewers,
  taskSlides,
  taskToday,
  unsureZones,
} from "./scenario-task.ts";
import { toReviewTaskDetail } from "./work-handlers.ts";

const isTaskProject = (projectId: string) =>
  projects.some(
    (project) =>
      project.code === newTask.project && (project.id === projectId || project.code === projectId),
  );

export const toProjectSlides = (projectId: string): ProjectSlide[] =>
  isTaskProject(projectId)
    ? taskSlides.map((slide) =>
        projectSlideSchema.parse({
          id: slide.id,
          label: slide.label,
          stain: slide.stain,
          case:
            slide.caseLabel === null
              ? null
              : {
                  id: taskCaseId(slide.caseLabel),
                  label: slide.caseLabel,
                  specimen: slide.specimen ?? "",
                },
          result_set_ids: slide.sets.map(resultSetIdOf),
        }),
      )
    : [];

export const toReviewTaskDefaults = (): ReviewTaskDefaults =>
  reviewTaskDefaultsSchema.parse({
    code: newTask.code,
    task_id: newTask.id,
    names: (["cam", "sam"] as const).map((key) => ({
      result_set_id: resultSetIdOf(key),
      name: newTask.names[key],
    })),
    slide_ids: newTask.slideIds,
    result_set_id: resultSetIdOf(newTask.resultSet),
    reviewer_ids: newTask.reviewers.map((key) => people[key].id),
    due_on: newTask.dueOn,
    reminder_days: newTask.reminders,
    study_template_id: newTask.studyTemplate.id,
    today: taskToday,
  });

export const toProjectScopeOptions = (): ProjectScopeOptions =>
  projectScopeOptionsSchema.parse({
    rois,
    unsure_zones: unsureZones.map((zone) => ({
      key: zone.key,
      cells_per_slide: zone.cellsPerSlide,
    })),
  });

export const toReviewerWorkload = (): ReviewerWorkload[] =>
  taskReviewers.map((item) =>
    reviewerWorkloadSchema.parse({ user_id: people[item.key].id, open_tasks: item.openTasks }),
  );

export const toStudyTemplateReviewDefaults = (): StudyTemplateReviewDefaults =>
  studyTemplateReviewDefaultsSchema.parse({
    templates: studyTemplates.map((template) => ({
      template_id: template.id,
      scope_kinds: template.scope,
      scope_options: {
        cells: 50,
        low: 0.6,
        rois: ["R1", "R2", "R3", "R4"],
        unsure_zones: ["Z1", "Z2", "Z3"],
      },
      decision: { kind: template.decision, agree_from: 4, disagree_to: 2 },
      display: {
        ...displayDefault,
        sets: { ...displayDefault.sets },
        ...template.display,
      },
      opinion_form: template.form,
    })),
    opinion_forms: opinionForms,
  });

const scopeKindOf = (kinds: string[]) =>
  kinds.includes("regions")
    ? "all-regions"
    : kinds.includes("cells")
      ? "random-cells"
      : kinds.includes("low")
        ? "cells-below-score"
        : kinds.includes("unsure")
          ? "unsure-zones"
          : "inside-rois";

export const toStudyTemplates = (): StudyTemplateSummary[] =>
  studyTemplates.map((template) => ({
    id: template.id,
    name: template.name,
    study_kind: template.kind,
    blocks: reportBlocksOf(template.key),
    presets: {
      objects_to_check: { kind: scopeKindOf(template.scope) },
      blinding: template.blind,
      first_read: template.hide,
      start_mode: template.start,
      split: template.split,
      decision: toDecisionSettings({
        kind: template.decision === "certainty5" ? "certainty" : template.decision,
        question: null,
        agreeFrom: 4,
        disagreeTo: 2,
      }),
    },
    version: template.version,
    built_in: template.builtIn,
    retired_at: template.retired ? `${taskToday}T09:00:00+02:00` : null,
    created_at: "2026-09-01T09:00:00+02:00",
    version_created_at: "2026-10-01T09:00:00+02:00",
    task_count: template.used,
  }));

export const toAvailability = (): MemberAvailability[] =>
  away.map((item) => ({
    user_id: people[item.key].id,
    status: "away",
    until: item.until,
    note: null,
  }));

export const toCreatedTask = (projectId: string, draft: TaskDraft): ReviewTaskDetail => ({
  id: newTask.id,
  project_id: projectId,
  number: Number(newTask.code.slice(3)),
  code: newTask.code,
  name: draft.name,
  split: draft.split,
  scope: draft.scope,
  scopes: [draft.scope, ...(draft.extra_scopes ?? [])],
  opinion_form_version: draft.opinion_form_version ?? 1,
  blinded: draft.blinded ?? true,
  ai_hidden_first_read: draft.ai_hidden_first_read ?? false,
  start_mode: draft.start_mode ?? "guided",
  due_on: draft.due_on ?? null,
  reminder_days: draft.reminder_days ?? [],
  study_template_id: draft.study_template_id ?? null,
  study_template_version: draft.study_template_version ?? null,
  decision: {
    style: draft.decision?.style ?? "certainty",
    counts_as: draft.decision?.counts_as ?? ["disagree", "disagree", "unsure", "agree", "agree"],
    question: draft.decision?.question ?? null,
  },
  counts_as_changes: [],
  display: draft.display ?? taskDisplayFor(newTask.code),
  created_by_user_id: people.DH.id,
  created_at: `${newTask.sentOn}T14:30:00+02:00`,
  slide_count: draft.result_sets?.length ?? draft.slide_ids?.length ?? 0,
  reviewer_count: draft.reviewer_ids.length,
  slides: (draft.result_sets ?? []).map((set) => ({
    slide_id: set.slide_id,
    result_set_id: set.result_set_id,
    reviewer_ids: draft.reviewer_ids,
  })),
});

export const getListProjectSlidesMockHandler = (overrideResponse?: ProjectSlide[]) =>
  http.get<{ projectId: string }>("*/api/projects/:projectId/slides", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toProjectSlides(params.projectId)),
  );

export const getGetReviewTaskDefaultsMockHandler = (overrideResponse?: ReviewTaskDefaults) =>
  http.get("*/api/projects/:projectId/review-tasks/defaults", () =>
    HttpResponse.json(overrideResponse ?? toReviewTaskDefaults()),
  );

export const getGetProjectScopeOptionsMockHandler = (overrideResponse?: ProjectScopeOptions) =>
  http.get("*/api/projects/:projectId/scope-options", () =>
    HttpResponse.json(overrideResponse ?? toProjectScopeOptions()),
  );

export const getListReviewerWorkloadMockHandler = (overrideResponse?: ReviewerWorkload[]) =>
  http.get("*/api/tenant/workload", () =>
    HttpResponse.json(overrideResponse ?? toReviewerWorkload()),
  );

export const getListStudyTemplateReviewDefaultsMockHandler = (
  overrideResponse?: StudyTemplateReviewDefaults,
) =>
  http.get("*/api/study-templates/review-defaults", () =>
    HttpResponse.json(overrideResponse ?? toStudyTemplateReviewDefaults()),
  );

export const taskDraftOperations: DraftOperation[] = [
  {
    operationId: "listProjectSlides",
    method: "get",
    path: "/api/projects/{project_id}/slides",
    handler: () => getListProjectSlidesMockHandler(),
  },
  {
    operationId: "getReviewTaskDefaults",
    method: "get",
    path: "/api/projects/{project_id}/review-tasks/defaults",
    handler: () => getGetReviewTaskDefaultsMockHandler(),
  },
  {
    operationId: "getProjectScopeOptions",
    method: "get",
    path: "/api/projects/{project_id}/scope-options",
    handler: () => getGetProjectScopeOptionsMockHandler(),
  },
  {
    operationId: "listReviewerWorkload",
    method: "get",
    path: "/api/tenant/workload",
    handler: () => getListReviewerWorkloadMockHandler(),
  },
  {
    operationId: "listStudyTemplateReviewDefaults",
    method: "get",
    path: "/api/study-templates/review-defaults",
    handler: () => getListStudyTemplateReviewDefaultsMockHandler(),
  },
];

const problem = (status: number, code: string, title: string) =>
  HttpResponse.json({ type: "about:blank", title, status, code }, { status });

const changeTask = http.patch<{ taskId: string }>(
  "*/api/review-tasks/:taskId",
  async ({ params, request }) => {
    const task = [...reviewTasks, rt13].find((candidate) => candidate.id === params.taskId);
    if (task === undefined) return undefined;
    const body = (await request.json()) as TaskChange;
    const after = body.decision?.counts_as;
    if (after === undefined || after === null) return HttpResponse.json(toReviewTaskDetail(task));
    if (task.status === "signed")
      return problem(409, "counts-as-signed-off", "Counts as cannot change after sign-off");
    if (!keepsAgreeAndDisagree(after))
      return problem(422, "counts-as-incomplete", "Counts as needs an agree and a disagree answer");
    if (decisionSettingsFor(task.code).style === "certainty")
      changeCountsAs(
        task.code,
        after,
        people[projectByCode(task.project).owner].id,
        new Date().toISOString(),
      );
    return HttpResponse.json(toReviewTaskDetail(task));
  },
);

export function taskHandlers(): RequestHandler[] {
  return [
    changeTask,
    getListStudyTemplatesMockHandler(toStudyTemplates()),
    getListAvailabilityMockHandler(toAvailability()),
    getCreateReviewTaskMockHandler(async ({ request, params }) =>
      toCreatedTask(String(params["projectId"]), (await request.json()) as TaskDraft),
    ),
  ];
}
