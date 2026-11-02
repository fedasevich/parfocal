import { HttpResponse, http, type RequestHandler } from "msw";
import { type Checklist, checklistSchema } from "../draft/get-my-checklist.ts";
import { type MyAdjudication, myAdjudicationSchema } from "../draft/list-my-adjudications.ts";
import { type CosignRequest, cosignRequestSchema } from "../draft/list-my-cosign-requests.ts";
import { type SlideThread, slideThreadSchema } from "../draft/list-slide-threads.ts";
import { adjudicationDraftOperations } from "./adjudication-handlers.ts";
import { adminDraftOperations } from "./admin-handlers.ts";
import { clinicalDraftOperations } from "./clinical-handlers.ts";
import { connectModelDraftOperations } from "./connect-model-handlers.ts";
import { jobDraftOperations } from "./job-handlers.ts";
import { projectDraftOperations } from "./project-handlers.ts";
import { reviewDraftOperations } from "./review-handlers.ts";
import {
  adjudications,
  cases,
  checklist,
  cosignRequests,
  people,
  projectByCode,
  reviewTasks,
  sampleProject,
  slideByIndex,
  threads,
} from "./scenario.ts";
import { settingsDraftOperations } from "./settings-handlers.ts";
import { taskDraftOperations } from "./task-handlers.ts";
import { teamDraftOperations } from "./team-handlers.ts";
import { fakeView } from "./view.ts";
import { viewerDraftOperations } from "./viewer-handlers.ts";
import { viewerToolsDraftOperations } from "./viewer-tools-handlers.ts";
import { inScenarioWorkspace } from "./workspace-scene.ts";

export {
  getDecideAdjudicationMockHandler,
  getGetDisagreementQueueMockHandler,
  getGetEvaluationReportMockHandler,
  getGetMyAdjudicationMockHandler,
  getGetSignOffSummaryMockHandler,
  getSendToAdjudicatorMockHandler,
  getStartEvaluationVersionMockHandler,
  getUpdateQueuedObjectMockHandler,
} from "./adjudication-handlers.ts";
export {
  getGetAdminOverviewMockHandler,
  getGetInvitePreviewMockHandler,
  getGetSecuritySettingsMockHandler,
  getGetSignInOptionsMockHandler,
  getGetStorageUsageMockHandler,
  getListAiModelsMockHandler,
  getListJoinableWorkspacesMockHandler,
  getListMemberActivityMockHandler,
  getListWebhooksMockHandler,
  getRequestProjectAccessMockHandler,
} from "./admin-handlers.ts";
export {
  getAmendClinicalReportMockHandler,
  getCosignClinicalReportMockHandler,
  getGetClinicalReportMockHandler,
  getGetCosignReviewMockHandler,
  getListClinicalReportsMockHandler,
  getReturnCosignRequestMockHandler,
  getSendClinicalReportForCosignMockHandler,
  getSignOutClinicalReportMockHandler,
  getWithdrawCosignRequestMockHandler,
} from "./clinical-handlers.ts";
export {
  getConnectLabModelMockHandler,
  getGetLabModelConnectionMockHandler,
} from "./connect-model-handlers.ts";
export {
  getGetModelRunDefaultsMockHandler,
  getListMyJobsMockHandler,
  getMoveModelRunMockHandler,
} from "./job-handlers.ts";
export {
  getGetProjectImportsMockHandler,
  getGetProjectOverviewMockHandler,
  getGetUploadBatchMockHandler,
  getListSourceFilesMockHandler,
} from "./project-handlers.ts";
export {
  getGetDecisionStyleMockHandler,
  getGetSlideAgreementMockHandler,
  getGetTaskDisplayMockHandler,
  getListReviewObjectsMockHandler,
  getListThreadCommentsMockHandler,
} from "./review-handlers.ts";
export { getGetMySettingsMockHandler } from "./settings-handlers.ts";
export {
  getGetProjectScopeOptionsMockHandler,
  getGetReviewTaskDefaultsMockHandler,
  getListProjectSlidesMockHandler,
  getListReviewerWorkloadMockHandler,
  getListStudyTemplateReviewDefaultsMockHandler,
} from "./task-handlers.ts";
export { getListTeamWorkloadMockHandler } from "./team-handlers.ts";
export {
  getGetSlideAiProgressMockHandler,
  getGetSlideResultStatsMockHandler,
} from "./viewer-handlers.ts";
export {
  getListAnnotationLayersMockHandler,
  getListModelTiersMockHandler,
} from "./viewer-tools-handlers.ts";

export type DraftOperation = {
  operationId: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  handler: () => RequestHandler;
};

const taskByCode = (code: string) => {
  const task = reviewTasks.find((candidate) => candidate.code === code);
  if (task === undefined) throw new Error(`no scenario task ${code}`);
  return task;
};

export const toMyAdjudications = (): MyAdjudication[] =>
  adjudications
    .filter((item) => inScenarioWorkspace() && item.adjudicator === fakeView().viewer)
    .map((item) => {
      const task = taskByCode(item.task);
      const project = projectByCode(task.project);
      const slide = slideByIndex(item.slide);
      return myAdjudicationSchema.parse({
        id: item.id,
        task_id: task.id,
        task_code: task.code,
        task_name: task.name,
        project: { id: project.id, code: project.code, name: project.name },
        asked_by_user_id: people[item.askedBy].id,
        slide_id: slide.id,
        slide_label: slide.label,
        objects: item.objects,
        decided: item.decided,
        sent_at: item.sentAt,
      });
    });

export const toMyCosignRequests = (): CosignRequest[] =>
  cosignRequests
    .filter((item) => item.to === fakeView().viewer)
    .map((item) => {
      const project = projectByCode(item.project);
      return cosignRequestSchema.parse({
        id: item.id,
        from_user_id: people[item.from].id,
        case_id: cases.find((candidate) => candidate.label === item.caseLabel)?.id ?? null,
        case_label: item.caseLabel,
        slide_id: slideByIndex(item.slide).id,
        project: { id: project.id, code: project.code, name: project.name },
        sent_at: item.sentAt,
      });
    });

export const toChecklist = (): Checklist =>
  checklistSchema.parse({
    hidden: !fakeView().firstWeek,
    steps: checklist.map((step) => ({ ...step, done: fakeView().firstWeek ? step.done : true })),
    sample_project: {
      id: sampleProject.id,
      code: sampleProject.code,
      name: sampleProject.name,
      slides: sampleProject.counts.slides,
    },
  });

export const toSlideThreads = (slideId: string): SlideThread[] =>
  threads
    .filter((item) => slideByIndex(item.slide).id === slideId)
    .map((item) =>
      slideThreadSchema.parse({
        id: item.id,
        slide_id: slideId,
        task_id: taskByCode(item.task).id,
        anchor: item.anchor,
        replies: item.replies,
        resolved: !item.open,
      }),
    );

export const getListMyAdjudicationsMockHandler = (overrideResponse?: MyAdjudication[]) =>
  http.get("*/api/me/adjudications", () =>
    HttpResponse.json(overrideResponse ?? toMyAdjudications()),
  );

export const getListMyCosignRequestsMockHandler = (overrideResponse?: CosignRequest[]) =>
  http.get("*/api/me/cosign-requests", () =>
    HttpResponse.json(overrideResponse ?? toMyCosignRequests()),
  );

export const getGetMyChecklistMockHandler = (overrideResponse?: Checklist) =>
  http.get("*/api/me/checklist", () => HttpResponse.json(overrideResponse ?? toChecklist()));

export const getListSlideThreadsMockHandler = (overrideResponse?: SlideThread[]) =>
  http.get<{ slideId: string }>("*/api/slides/:slideId/threads", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toSlideThreads(params.slideId)),
  );

export const draftOperations: DraftOperation[] = [
  {
    operationId: "listMyAdjudications",
    method: "get",
    path: "/api/me/adjudications",
    handler: () => getListMyAdjudicationsMockHandler(),
  },
  {
    operationId: "listMyCosignRequests",
    method: "get",
    path: "/api/me/cosign-requests",
    handler: () => getListMyCosignRequestsMockHandler(),
  },
  {
    operationId: "getMyChecklist",
    method: "get",
    path: "/api/me/checklist",
    handler: () => getGetMyChecklistMockHandler(),
  },
  {
    operationId: "listSlideThreads",
    method: "get",
    path: "/api/slides/{slide_id}/threads",
    handler: () => getListSlideThreadsMockHandler(),
  },
  ...jobDraftOperations,
  ...taskDraftOperations,
  ...projectDraftOperations,
  ...teamDraftOperations,
  ...adminDraftOperations,
  ...reviewDraftOperations,
  ...clinicalDraftOperations,
  ...settingsDraftOperations,
  ...connectModelDraftOperations,
  ...viewerDraftOperations,
  ...adjudicationDraftOperations,
  ...viewerToolsDraftOperations,
];

export const draftHandlers = (): RequestHandler[] =>
  draftOperations.map((operation) => operation.handler());
