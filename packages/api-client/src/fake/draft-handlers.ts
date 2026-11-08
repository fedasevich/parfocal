import { HttpResponse, http, type RequestHandler } from "msw";
import { type Checklist, checklistSchema } from "../draft/get-my-checklist.ts";
import { type SlideThread, slideThreadSchema } from "../draft/list-slide-threads.ts";
import { adjudicationDraftOperations } from "./adjudication-handlers.ts";
import { adminDraftOperations } from "./admin-handlers.ts";
import { authDraftOperations } from "./auth-handlers.ts";
import { clinicalDraftOperations } from "./clinical-handlers.ts";
import { connectModelDraftOperations } from "./connect-model-handlers.ts";
import { jobDraftOperations } from "./job-handlers.ts";
import { projectDraftOperations } from "./project-handlers.ts";
import { reviewDraftOperations } from "./review-handlers.ts";
import { checklist, reviewTasks, sampleProject, slideByIndex, threads } from "./scenario.ts";
import { signUpDraftOperations } from "./sign-up-handlers.ts";
import { taskDraftOperations } from "./task-handlers.ts";
import { teamDraftOperations } from "./team-handlers.ts";
import { fakeView } from "./view.ts";
import { viewerDraftOperations } from "./viewer-handlers.ts";
import { viewerToolsDraftOperations } from "./viewer-tools-handlers.ts";

export {
  getDecideAdjudicationMockHandler,
  getGetDisagreementQueueMockHandler,
  getGetEvaluationReportMockHandler,
  getGetMyAdjudicationMockHandler,
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
  getListWebhooksMockHandler,
  getRequestProjectAccessMockHandler,
} from "./admin-handlers.ts";
export {
  getRequestPasswordResetMockHandler,
  getRequestSignInLinkMockHandler,
  getResetPasswordMockHandler,
  getSignInWithCodeMockHandler,
  getSignInWithPasswordMockHandler,
  getStartSsoMockHandler,
} from "./auth-handlers.ts";
export {
  getCosignClinicalReportMockHandler,
  getGetClinicalReportMockHandler,
  getGetCosignReviewMockHandler,
  getReturnCosignRequestMockHandler,
} from "./clinical-handlers.ts";
export { getGetLabModelConnectionMockHandler } from "./connect-model-handlers.ts";
export {
  getGetModelRunDefaultsMockHandler,
  getListMyJobsMockHandler,
  getMoveModelRunMockHandler,
} from "./job-handlers.ts";
export {
  getGetProjectImportsMockHandler,
  getGetProjectOverviewMockHandler,
  getGetUploadBatchMockHandler,
} from "./project-handlers.ts";
export {
  getGetSlideAgreementMockHandler,
  getGetTaskDisplayMockHandler,
  getListReviewObjectsMockHandler,
  getListThreadCommentsMockHandler,
} from "./review-handlers.ts";
export {
  getConfirmEmailMockHandler,
  getCreateAccountMockHandler,
  getResendEmailCodeMockHandler,
} from "./sign-up-handlers.ts";
export {
  getGetProjectScopeOptionsMockHandler,
  getGetReviewTaskDefaultsMockHandler,
  getListProjectSlidesMockHandler,
  getListReviewerWorkloadMockHandler,
  getListStudyTemplateReviewDefaultsMockHandler,
} from "./task-handlers.ts";
export { getListTeamWorkloadMockHandler } from "./team-handlers.ts";
export {
  getGetResultSetTyperMockHandler,
  getGetSlideAiProgressMockHandler,
  getGetSlideResultStatsMockHandler,
} from "./viewer-handlers.ts";
export {
  getListAnnotationLayersMockHandler,
  getTypeOutlinesMockHandler,
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

export const getGetMyChecklistMockHandler = (overrideResponse?: Checklist) =>
  http.get("*/api/me/checklist", () => HttpResponse.json(overrideResponse ?? toChecklist()));

export const getListSlideThreadsMockHandler = (overrideResponse?: SlideThread[]) =>
  http.get<{ slideId: string }>("*/api/slides/:slideId/threads", ({ params }) =>
    HttpResponse.json(overrideResponse ?? toSlideThreads(params.slideId)),
  );

export const draftOperations: DraftOperation[] = [
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
  ...authDraftOperations,
  ...signUpDraftOperations,
  ...reviewDraftOperations,
  ...clinicalDraftOperations,
  ...connectModelDraftOperations,
  ...viewerDraftOperations,
  ...adjudicationDraftOperations,
  ...viewerToolsDraftOperations,
];

export const draftHandlers = (): RequestHandler[] =>
  draftOperations.map((operation) => operation.handler());
