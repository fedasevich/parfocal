import type { RequestHandler } from "msw";
import { getGetMyChecklistMockHandler } from "../generated/api.msw.ts";
import type { Checklist } from "../generated/api.ts";
import { adjudicationDraftOperations } from "./adjudication-handlers.ts";
import { adminDraftOperations } from "./admin-handlers.ts";
import { authDraftOperations } from "./auth-handlers.ts";
import { clinicalDraftOperations } from "./clinical-handlers.ts";
import { connectModelDraftOperations } from "./connect-model-handlers.ts";
import { jobDraftOperations } from "./job-handlers.ts";
import { checklist, sampleProject } from "./scenario.ts";
import { taskDraftOperations } from "./task-handlers.ts";
import { teamDraftOperations } from "./team-handlers.ts";
import { fakeView } from "./view.ts";
import { viewerToolsDraftOperations } from "./viewer-tools-handlers.ts";

export { getGetEvaluationReportMockHandler } from "./adjudication-handlers.ts";
export {
  getGetAdminOverviewMockHandler,
  getGetInvitePreviewMockHandler,
  getGetSecuritySettingsMockHandler,
  getGetSignInOptionsMockHandler,
  getGetStorageUsageMockHandler,
  getListAiModelsMockHandler,
  getListWebhooksMockHandler,
} from "./admin-handlers.ts";
export {
  getRequestPasswordResetMockHandler,
  getRequestSignInLinkMockHandler,
  getResetPasswordMockHandler,
  getSignInWithCodeMockHandler,
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
  getMoveModelRunMockHandler,
} from "./job-handlers.ts";
export {
  getListReviewerWorkloadMockHandler,
  getListStudyTemplateReviewDefaultsMockHandler,
} from "./task-handlers.ts";
export { getListTeamWorkloadMockHandler } from "./team-handlers.ts";
export { getTypeOutlinesMockHandler } from "./viewer-tools-handlers.ts";

export type DraftOperation = {
  operationId: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  handler: () => RequestHandler;
};

export const toChecklist = (): Checklist => ({
  hidden: !fakeView().firstWeek,
  steps: checklist.map((step) => ({ ...step, done: fakeView().firstWeek ? step.done : true })),
  sample_project: {
    id: sampleProject.id,
    code: sampleProject.code,
    name: sampleProject.name,
    slides: sampleProject.counts.slides,
  },
});

export const draftOperations: DraftOperation[] = [
  ...jobDraftOperations,
  ...taskDraftOperations,
  ...teamDraftOperations,
  ...adminDraftOperations,
  ...authDraftOperations,
  ...clinicalDraftOperations,
  ...connectModelDraftOperations,
  ...adjudicationDraftOperations,
  ...viewerToolsDraftOperations,
];

export const checklistHandlers = (): RequestHandler[] => [
  getGetMyChecklistMockHandler(() => toChecklist()),
];

export const draftHandlers = (): RequestHandler[] =>
  draftOperations.map((operation) => operation.handler());
