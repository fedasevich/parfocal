import type { RequestHandler } from "msw";
import { getGetMyChecklistMockHandler } from "../generated/api.msw.ts";
import type { Checklist } from "../generated/api.ts";
import { adjudicationDraftOperations } from "./adjudication-handlers.ts";
import { adminDraftOperations } from "./admin-handlers.ts";
import { clinicalDraftOperations } from "./clinical-handlers.ts";
import { checklist, sampleProject } from "./scenario.ts";
import { taskDraftOperations } from "./task-handlers.ts";
import { teamDraftOperations } from "./team-handlers.ts";
import { fakeView } from "./view.ts";

export { getGetEvaluationReportMockHandler } from "./adjudication-handlers.ts";
export {
  getGetAdminOverviewMockHandler,
  getGetInvitePreviewMockHandler,
  getGetSecuritySettingsMockHandler,
  getGetStorageUsageMockHandler,
  getListWebhooksMockHandler,
} from "./admin-handlers.ts";
export {
  getCosignClinicalReportMockHandler,
  getGetClinicalReportMockHandler,
  getGetCosignReviewMockHandler,
  getReturnCosignRequestMockHandler,
} from "./clinical-handlers.ts";
export { getListReviewerWorkloadMockHandler } from "./task-handlers.ts";
export { getListTeamWorkloadMockHandler } from "./team-handlers.ts";

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
  ...taskDraftOperations,
  ...teamDraftOperations,
  ...adminDraftOperations,
  ...clinicalDraftOperations,
  ...adjudicationDraftOperations,
];

export const checklistHandlers = (): RequestHandler[] => [
  getGetMyChecklistMockHandler(() => toChecklist()),
];

export const draftHandlers = (): RequestHandler[] =>
  draftOperations.map((operation) => operation.handler());
