import type { RequestHandler } from "msw";
import { getGetMyChecklistMockHandler } from "../generated/api.msw.ts";
import type { Checklist } from "../generated/api.ts";
import { adjudicationDraftOperations } from "./adjudication-handlers.ts";
import { adminDraftOperations } from "./admin-handlers.ts";
import { clinicalDraftOperations } from "./clinical-handlers.ts";
import { jobDraftOperations } from "./job-handlers.ts";
import { projectDraftOperations } from "./project-handlers.ts";
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
  getGetStorageUsageMockHandler,
  getListWebhooksMockHandler,
  getRequestProjectAccessMockHandler,
} from "./admin-handlers.ts";
export {
  getCosignClinicalReportMockHandler,
  getGetClinicalReportMockHandler,
  getGetCosignReviewMockHandler,
  getReturnCosignRequestMockHandler,
} from "./clinical-handlers.ts";
export { getMoveModelRunMockHandler } from "./job-handlers.ts";
export {
  getGetProjectImportsMockHandler,
  getGetProjectOverviewMockHandler,
  getGetUploadBatchMockHandler,
} from "./project-handlers.ts";
export {
  getGetProjectScopeOptionsMockHandler,
  getGetReviewTaskDefaultsMockHandler,
  getListProjectSlidesMockHandler,
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
  ...projectDraftOperations,
  ...teamDraftOperations,
  ...adminDraftOperations,
  ...clinicalDraftOperations,
  ...adjudicationDraftOperations,
  ...viewerToolsDraftOperations,
];

export const checklistHandlers = (): RequestHandler[] => [
  getGetMyChecklistMockHandler(() => toChecklist()),
];

export const draftHandlers = (): RequestHandler[] =>
  draftOperations.map((operation) => operation.handler());
