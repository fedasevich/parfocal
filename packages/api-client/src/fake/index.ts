import { faker } from "@faker-js/faker";
import type { RequestHandler } from "msw";
import { getParfocalAPIMock } from "../generated/api.msw.ts";
import { adjudicationHandlers } from "./adjudication-handlers.ts";
import { adminHandlers } from "./admin-handlers.ts";
import { annotationHandlers } from "./annotation-handlers.ts";
import { caseHandlers } from "./case-handlers.ts";
import { caseReportHandlers, cosignRequestHandlers } from "./case-report-handlers.ts";
import { connectModelHandlers } from "./connect-model-handlers.ts";
import { consoleHandlers } from "./console-handlers.ts";
import { coverageHandlers, tissueHandlers } from "./coverage-handlers.ts";
import { createdRecordHandlers } from "./create-handlers.ts";
import { checklistHandlers, draftHandlers } from "./draft-handlers.ts";
import { jobHandlers } from "./job-handlers.ts";
import { projectHandlers } from "./project-handlers.ts";
import { reportLinkHandlers } from "./report-link-handlers.ts";
import { reportPreviewHandlers } from "./report-preview-handlers.ts";
import { resumeHandlers } from "./resume-handlers.ts";
import { reviewHandlers } from "./review-handlers.ts";
import { scenarioHandlers } from "./scenario-handlers.ts";
import { settingsHandlers } from "./settings-handlers.ts";
import { sharedLayerHandlers } from "./shared-layer-handlers.ts";
import { taskHandlers } from "./task-handlers.ts";
import { teamActionHandlers } from "./team-handlers.ts";
import { tileAccessHandlers } from "./tile-access-handlers.ts";
import { uploadHandlers } from "./upload-handlers.ts";
import { viewerToolsHandlers } from "./viewer-tools-handlers.ts";
import { workHandlers } from "./work-handlers.ts";
import { workspaceJoinHandlers } from "./workspace-join-handlers.ts";

export type FakeApiScope = "all" | "drafts";

export const fakeDataSeed = 4812;

export function fakeApiHandlers(scope: FakeApiScope): RequestHandler[] {
  if (scope === "drafts") return draftHandlers();
  faker.seed(fakeDataSeed);
  return [
    ...draftHandlers(),
    ...scenarioHandlers(),
    ...reviewHandlers(),
    ...projectHandlers(),
    ...workHandlers(),
    ...checklistHandlers(),
    ...taskHandlers(),
    ...jobHandlers(),
    ...adminHandlers(),
    ...workspaceJoinHandlers(),
    ...connectModelHandlers(),
    ...adjudicationHandlers(),
    ...reportPreviewHandlers(),
    ...caseHandlers(),
    ...caseReportHandlers(),
    ...cosignRequestHandlers(),
    ...createdRecordHandlers(),
    ...uploadHandlers(),
    ...settingsHandlers(),
    ...consoleHandlers(),
    ...teamActionHandlers(),
    ...tileAccessHandlers(),
    ...coverageHandlers(),
    ...tissueHandlers(),
    ...annotationHandlers(),
    ...sharedLayerHandlers(),
    ...resumeHandlers(),
    ...reportLinkHandlers(),
    ...viewerToolsHandlers(),
    ...getParfocalAPIMock(),
  ];
}

export * from "../generated/api.msw.ts";
export {
  toDisagreementQueue,
  toEvaluationReport,
  toMyAdjudication,
  toSignOffSummary,
  toTaskEvaluation,
} from "./adjudication-handlers.ts";
export {
  resetAdminActions,
  toAiModels,
  toInvitePreview,
  toSignInOptions,
} from "./admin-handlers.ts";
export { annotationHandlers, resetFakeAnnotations } from "./annotation-handlers.ts";
export { resetSlideEdits } from "./case-handlers.ts";
export { clinicalCaseId, resetFakeCaseReports } from "./case-report-handlers.ts";
export { toClinicalReport, toCosignReview } from "./clinical-handlers.ts";
export {
  brokenLabServer,
  toConnectedModel,
  toLabModelConnection,
  toTestedLabModel,
} from "./connect-model-handlers.ts";
export {
  type FakeConnectModelScene,
  fakeConnectModelScene,
  setFakeConnectModelScene,
} from "./connect-model-scene.ts";
export {
  liveAnnouncements,
  liveWorkspaceSettings,
  resetConsoleActions,
} from "./console-handlers.ts";
export {
  coverageHandlers,
  fakeTissueGrid,
  fakeTissueRows,
  recordFakeCoverage,
  resetFakeCoverage,
  tissueHandlers,
  toSlideCoverage,
  toSlideTissue,
} from "./coverage-handlers.ts";
export { resetCreatedRecords } from "./create-handlers.ts";
export { type DraftOperation, draftHandlers, draftOperations } from "./draft-handlers.ts";
export { toProjectModels } from "./job-handlers.ts";
export {
  type FakeJobsScene,
  fakeJobsState,
  resetJobsState,
  setFakeJobsScene,
} from "./jobs-scene.ts";
export { resetFakeProfile } from "./profile-changes.ts";
export {
  projectSlideRows,
  toProjectOverview,
  toSlideAreas,
  toUploadBatch,
} from "./project-handlers.ts";
export {
  defaultFakeQueueScene,
  type FakeQueueScene,
  fakeQueueScene,
  type QueueStage,
  resetQueueState,
  setFakeQueueScene,
} from "./queue-scene.ts";
export {
  reportLinkHandlers,
  resetFakeReportLinks,
  sharedReportOf,
} from "./report-link-handlers.ts";
export { resetFakeResume, resumeHandlers } from "./resume-handlers.ts";
export { resetFakeThreads } from "./review-handlers.ts";
export * as scenario from "./scenario.ts";
export * as scenarioAdjudication from "./scenario-adjudication.ts";
export * as scenarioAdmin from "./scenario-admin.ts";
export * as scenarioClinical from "./scenario-clinical.ts";
export * as scenarioConnectModel from "./scenario-connect-model.ts";
export {
  arriveFakeWorklistTask,
  resetFakeWorklistArrivals,
  scenarioHandlers,
  toHome,
  toMe,
  toMembers,
  toProject,
} from "./scenario-handlers.ts";
export * as scenarioJobs from "./scenario-jobs.ts";
export * as scenarioProject from "./scenario-project.ts";
export * as scenarioReview from "./scenario-review.ts";
export * as scenarioSettings from "./scenario-settings.ts";
export * as scenarioTask from "./scenario-task.ts";
export * as scenarioTeam from "./scenario-team.ts";
export * as scenarioViewer from "./scenario-viewer.ts";
export { sessionLockHandlers } from "./session-lock.ts";
export {
  resetSettingsActions,
  toPreferences,
  toSessions,
} from "./settings-handlers.ts";
export {
  annotateTaskClasses,
  annotateTaskSlides,
  resetFakeSharedLayer,
  toAnnotateSlideStatus,
  toSharedAiObjects,
} from "./shared-layer-handlers.ts";
export { teamReviewerStatus, toTeamWorkload } from "./team-handlers.ts";
export {
  defaultFakeTeamScene,
  type FakeTeamScene,
  fakeTeamScene,
  resetTeamActions,
  setFakeTeamScene,
} from "./team-scene.ts";
export {
  fakeTileLifetimeSeconds,
  tileAccessHandlers,
  toTileAccess,
} from "./tile-access-handlers.ts";
export { defaultFakeView, type FakeView, fakeView, setFakeView } from "./view.ts";
export { toSlideAiProgress, toSlideResultStats } from "./viewer-handlers.ts";
export {
  type FakeViewerScene,
  fakeViewerScene,
  setFakeAiStreaming,
  setFakeViewerScene,
} from "./viewer-scene.ts";
export {
  fakeTypedOutline,
  fakeTyper,
  toAnnotationLayers,
  toModelTiers,
  toOutlineTypes,
} from "./viewer-tools-handlers.ts";
export {
  bulkSlideRows,
  searchScenario,
  setFakeBulkSlides,
  tasksAssignedBy,
  toSlideRow,
} from "./work-handlers.ts";
export { bringWorkersBack, takeWorkersOffline } from "./worker-outage.ts";
export { setFakeSuspendedWorkspace } from "./workspace-scene.ts";
