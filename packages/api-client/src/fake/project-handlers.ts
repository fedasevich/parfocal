import { HttpResponse, http, type RequestHandler } from "msw";
import { type ProjectImports, projectImportsSchema } from "../draft/get-project-imports.ts";
import { type ProjectOverview, projectOverviewSchema } from "../draft/get-project-overview.ts";
import { type UploadBatch, uploadBatchSchema } from "../draft/get-upload-batch.ts";
import {
  getGetOpinionFormMockHandler,
  getListClassMappingsMockHandler,
  getListProjectClassesMockHandler,
  getListReviewTasksMockHandler,
  getListSlideAreasMockHandler,
  getListSlideResultSetsMockHandler,
  getListTaxonomyTemplatesMockHandler,
} from "../generated/api.msw.ts";
import type {
  ClassMapping,
  LinkImport,
  LinkImportRequest,
  OpinionForm,
  ProjectClass,
  ResultSet,
  ReviewTask,
  SlideArea,
  SourceListing,
  Template,
} from "../generated/api.ts";
import { countsAsChangesFor, decisionSettingsFor } from "./decision-settings.ts";
import { taskDisplayFor } from "./display-settings.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import {
  cases,
  type ProjectCode,
  people,
  projects,
  resultSets,
  reviewTasks,
  type ScenarioProject,
  type ScenarioReviewTask,
  slides,
} from "./scenario.ts";
import {
  caseSlideCounts,
  classMappings,
  formatCheck,
  objectsPerSlide,
  overviewSeedOf,
  projectImports,
  resultPreview,
  sourceFiles,
  sourceListings,
  taxonomyClasses,
  uploadDone,
  uploadDuplicate,
  uploadExtraResults,
  uploadFolderTree,
  uploadNewClasses,
  uploadProblems,
  uploadResults,
  uploadSlides,
  uploadSourceOutage,
  uploadStorage,
  uploadUnscored,
} from "./scenario-project.ts";
import { rt13 } from "./scenario-review.ts";
import { opinionForms, studyTemplates } from "./scenario-task.ts";
import { toSlideRow } from "./work-handlers.ts";

const projectOf = (idOrCode: string): ScenarioProject =>
  projects.find((candidate) => candidate.id === idOrCode || candidate.code === idOrCode) ??
  (projects[0] as ScenarioProject);

const classUuid = (project: ProjectCode, key: number) =>
  `00000000-0000-4000-8016-${String(Number(project.slice(1)) * 100 + key).padStart(12, "0")}`;

const taxonomyOf = (project: ScenarioProject) =>
  project.taxonomy === "PanNuke" ? taxonomyClasses.pannuke : taxonomyClasses["sentinel-node"];

export const toProjectClasses = (idOrCode: string): ProjectClass[] => {
  const project = projectOf(idOrCode);
  return taxonomyOf(project).map((item) => ({
    id: classUuid(project.code, item.key),
    key: item.key,
    name: item.name,
    colour: item.colour,
  }));
};

export const toClassMappings = (idOrCode: string): ClassMapping[] => {
  const classes = toProjectClasses(idOrCode);
  return classMappings.flatMap((mapping) => {
    const target = classes.find((item) => item.name === mapping.to);
    return target ? [{ source_name: mapping.source, class_id: target.id }] : [];
  });
};

export const toTaxonomyTemplates = (): Template[] => [
  { template: "sentinel-node", classes: [...taxonomyClasses["sentinel-node"]] },
  { template: "pannuke", classes: [...taxonomyClasses.pannuke] },
];

export const toProjectOverview = (idOrCode: string): ProjectOverview => {
  const project = projectOf(idOrCode);
  const seed = overviewSeedOf(project.code);
  return projectOverviewSchema.parse({
    project_id: project.id,
    cases: project.counts.cases,
    slides: project.counts.slides,
    result_sets: project.counts.resultSets,
    objects: seed.objects ?? project.counts.slides * objectsPerSlide,
    reviewed_percent: project.counts.reviewedPercent,
    needs_review: seed.needsReview,
    no_results: seed.noResults,
    case_groups: cases
      .filter((item) => item.project === project.code)
      .map((item) => ({
        label: item.label,
        specimen: item.specimen,
        slide_count: Math.max(
          caseSlideCounts[item.label] ?? 0,
          slides.filter((slide) => slide.caseLabel === item.label).length,
        ),
      })),
    slide_files: slides
      .filter((slide) => slide.project === project.code)
      .map((slide) => ({
        slide_id: slide.id,
        file: slide.file,
        stain: slide.stain,
        remote: slide.remote ?? null,
      })),
    study_template_id:
      studyTemplates.find((template) => template.name === project.studyTemplate)?.id ?? null,
    storage: { used_gb: seed.storageUsedGb, allowance_gb: seed.storageAllowanceGb },
    import_failure: seed.importFailure
      ? {
          file: seed.importFailure.file,
          slide_label: seed.importFailure.slide,
          objects: seed.importFailure.objects,
          reason: seed.importFailure.reason,
        }
      : null,
  });
};

const scopeOf = (task: ScenarioReviewTask): ReviewTask["scope"] => ({
  kind: task.scope,
  count: task.scope === "random-cells" ? 50 : null,
  score: task.scope === "cells-below-score" ? 0.6 : null,
});

export const toReviewTask = (task: ScenarioReviewTask): ReviewTask => {
  const project = projectOf(task.project);
  return {
    id: task.id,
    project_id: project.id,
    number: Number(task.code.slice(3)),
    code: task.code,
    name: task.name,
    kind: "review",
    classes: null,
    split: task.split === "even" ? "even" : "everyone",
    scope: scopeOf(task),
    scopes: [scopeOf(task)],
    opinion_form_version: 1,
    blinded: task.blinded,
    ai_hidden_first_read: false,
    start_mode: "guided",
    due_on: task.dueOn,
    reminder_days: [2, 1],
    study_template_id: null,
    study_template_version: null,
    decision: decisionSettingsFor(task.code),
    counts_as_changes: countsAsChangesFor(task.code),
    display: taskDisplayFor(task.code),
    created_by_user_id: people[project.owner].id,
    created_at: `${task.sentOn}T09:00:00+02:00`,
    slide_count: task.slides,
    reviewer_count: task.reviewers.length,
  };
};

export const toProjectReviewTasks = (idOrCode: string): ReviewTask[] => {
  const project = projectOf(idOrCode);
  return [...reviewTasks, rt13].filter((task) => task.project === project.code).map(toReviewTask);
};

export const toSlideResultSets = (slideId: string): ResultSet[] => {
  const slide = slides.find((candidate) => candidate.id === slideId);
  if (slide === undefined) return [];
  const project = projectOf(slide.project);
  const fileBase = slide.file.replace(/\.\w+$/, "");
  return slide.sets.flatMap((key) => {
    const set = resultSets.find((candidate) => candidate.key === key);
    if (set === undefined || set.source === "reviewed") return [];
    return [
      {
        id: set.id,
        project_id: project.id,
        slide_id: slide.id,
        name: set.name,
        model_version: set.version,
        source: set.source === "run" ? "run" : "import",
        source_file: set.source === "imported" ? `${fileBase}_camelyon.geojson` : null,
        produced_at: `${set.createdOn}T09:00:00+02:00`,
        status: "ready",
        error_code: null,
        cell_count: set.cells,
        region_count: set.regions,
        zone_count: 0,
        created_by_user_id: people[set.by].id,
        created_at: `${set.createdOn}T09:00:00+02:00`,
      },
    ];
  });
};

const fakeAreaBounds = [
  { number: 1, x: 0, y: 0, width: 1024, height: 768, size_mm: 6.2 },
  { number: 2, x: 600, y: 200, width: 80, height: 60, size_mm: 1.6 },
  { number: 3, x: 200, y: 500, width: 48, height: 36, size_mm: 0.15 },
] as const;

export const toSlideAreas = (slideId: string): SlideArea[] => {
  const set = toSlideResultSets(slideId).find((candidate) => candidate.region_count > 0);
  if (set === undefined) return [];
  return fakeAreaBounds.map((area) => ({
    ...area,
    object: `T${area.number}`,
    result_set_id: set.id,
  }));
};

export const toUploadBatch = (idOrCode: string): UploadBatch => {
  const project = projectOf(idOrCode);
  return uploadBatchSchema.parse({
    project_id: project.id,
    slides: uploadSlides.map((slide, index) => ({
      name: slide.name,
      format: slide.format,
      size_gb: slide.sizeGb,
      case_label: slide.caseLabel,
      steps: slide.steps,
      steps_done: slide.stepsDone,
      running: slide.running,
      progress: slide.progress,
      extra_result: uploadExtraResults[index],
    })),
    results: uploadResults.map((result) => ({
      name: result.name,
      detail: result.detail,
      pairings: {
        auto: { warn: null, ...result.pairings.auto },
        name: { warn: null, ...result.pairings.name },
        id: { warn: null, ...result.pairings.id },
      },
    })),
    folder_tree: uploadFolderTree,
    problems: uploadProblems.map((problem) => ({ ...problem, lines: [...problem.lines] })),
    new_classes: uploadNewClasses,
    unscored_rows: uploadUnscored,
    duplicate: { slide: uploadDuplicate.slide, uploaded_on: uploadDuplicate.uploadedOn },
    storage: {
      needed_gb: uploadStorage.neededGb,
      left_gb: uploadStorage.leftGb,
      allowance_gb: overviewSeedOf(project.code).storageAllowanceGb ?? 525,
      trimmed_gb: uploadStorage.trimmedGb,
      trimmed_slides: uploadStorage.trimmedSlides,
    },
    source_outage: uploadSourceOutage,
    done: { minutes: uploadDone.minutes, first_ids: uploadDone.firstIds },
    result_preview: resultPreview,
    format_check: formatCheck,
  });
};

export const toSourceListing = (address: string): SourceListing => {
  const listing =
    address === sourceListings.remote.address ? sourceListings.remote : sourceListings.link;
  return {
    address: address || listing.address,
    kind: listing.kind,
    files: sourceFiles.map((file) => ({
      name: file.name,
      detail: file.detail,
      size_gb: file.sizeGb,
      size_bytes: Math.round(file.sizeGb * 1024 ** 3),
      in_project: file.inProject,
      case: null,
      refused: null,
      message: null,
      result: file.result,
    })),
    others: [],
  };
};

export const toProjectImports = (idOrCode: string): ProjectImports => {
  const project = projectOf(idOrCode);
  return projectImportsSchema.parse({
    project_id: project.id,
    watched_folder: projectImports.watchedFolder,
    webhook: {
      url: projectImports.webhook.url,
      secret_end: projectImports.webhook.secretEnd,
      abilities: projectImports.webhook.abilities,
      on: projectImports.webhook.on,
    },
    events_out: {
      endpoint: projectImports.eventsOut.endpoint,
      last_call: projectImports.eventsOut.lastCall,
      events: projectImports.eventsOut.events,
      on: projectImports.eventsOut.on,
    },
    token: projectImports.token,
    last_arrival: projectImports.lastArrival,
    arrivals: projectImports.arrivals,
  });
};

const questionKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

export const toOpinionForm = (idOrCode: string): OpinionForm => {
  const project = projectOf(idOrCode);
  const form = opinionForms.find((item) => item.key === "default") ?? opinionForms[0];
  return {
    project_id: project.id,
    version: 1,
    created_at: project.createdAt,
    questions: (form?.questions ?? []).map((question) => {
      const base = {
        key: questionKey(question.label),
        label: question.label,
        required: question.required,
        quick: false,
      };
      if (question.kind === "scale") return { ...base, kind: "scale", min: 1, max: 5 };
      if (question.kind === "choice") {
        return {
          ...base,
          kind: "choice",
          options: ["None", "Missed tumor", "False tumor", "Wrong cell types", "Boundaries"],
        };
      }
      if (question.kind === "yesno") return { ...base, kind: "yesno" };
      return { ...base, kind: "text", max_length: 2000 };
    }),
  };
};

export const projectSlideRows = (idOrCode: string) => {
  const project = projectOf(idOrCode);
  return slides
    .filter((slide) => slide.project === project.code)
    .map((slide) => toSlideRow(slide.id));
};

export const getGetProjectOverviewMockHandler = (overrideResponse?: ProjectOverview) =>
  http.get<{ projectId: string }>("*/api/projects/:projectId/overview", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toProjectOverview(params.projectId)),
  );

export const getGetUploadBatchMockHandler = (overrideResponse?: UploadBatch) =>
  http.get<{ projectId: string }>("*/api/projects/:projectId/upload-batch", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toUploadBatch(params.projectId)),
  );

export const sourceFilesHandler = (overrideResponse?: SourceListing) =>
  http.get("*/api/projects/:projectId/source-files", ({ request }) =>
    HttpResponse.json(
      overrideResponse ?? toSourceListing(new URL(request.url).searchParams.get("address") ?? ""),
    ),
  );

export const linkImportHandler = () =>
  http.post("*/api/projects/:projectId/link-imports", async ({ request }) => {
    const { names } = (await request.json()) as LinkImportRequest;
    const started: LinkImport["started"] = names.map((name, index) => ({
      name,
      upload_id: `00000000-0000-4000-8099-${String(index * 2 + 1).padStart(12, "0")}`,
      kind: "slide",
      job_id: `00000000-0000-4000-8099-${String(index * 2 + 2).padStart(12, "0")}`,
    }));
    return HttpResponse.json({ started, left_out: [] } satisfies LinkImport, { status: 202 });
  });

export const getGetProjectImportsMockHandler = (overrideResponse?: ProjectImports) =>
  http.get<{ projectId: string }>("*/api/projects/:projectId/imports", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toProjectImports(params.projectId)),
  );

export const projectDraftOperations: DraftOperation[] = [
  {
    operationId: "getProjectOverview",
    method: "get",
    path: "/api/projects/{project_id}/overview",
    handler: () => getGetProjectOverviewMockHandler(),
  },
  {
    operationId: "getUploadBatch",
    method: "get",
    path: "/api/projects/{project_id}/upload-batch",
    handler: () => getGetUploadBatchMockHandler(),
  },
  {
    operationId: "getProjectImports",
    method: "get",
    path: "/api/projects/{project_id}/imports",
    handler: () => getGetProjectImportsMockHandler(),
  },
];

export function projectHandlers(): RequestHandler[] {
  return [
    http.get("*/api/me/slides", ({ request }) => {
      const projectId = new URL(request.url).searchParams.get("project_id");
      if (!projectId) return undefined;
      return HttpResponse.json({ slides: projectSlideRows(projectId), next_cursor: null });
    }),
    getGetOpinionFormMockHandler(({ params }) => toOpinionForm(String(params.projectId))),
    getListReviewTasksMockHandler(({ params }) => toProjectReviewTasks(String(params.projectId))),
    getListSlideResultSetsMockHandler(({ params }) => toSlideResultSets(String(params.slideId))),
    getListSlideAreasMockHandler(({ params }) => toSlideAreas(String(params.slideId))),
    getListProjectClassesMockHandler(({ params }) => toProjectClasses(String(params.projectId))),
    getListClassMappingsMockHandler(({ params }) => toClassMappings(String(params.projectId))),
    getListTaxonomyTemplatesMockHandler(() => toTaxonomyTemplates()),
  ];
}
