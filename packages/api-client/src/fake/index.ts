import { faker } from "@faker-js/faker";
import type { RequestHandler } from "msw";
import { getParfocalAPIMock } from "../generated/api.msw.ts";
import { adminHandlers } from "./admin-handlers.ts";
import { draftHandlers } from "./draft-handlers.ts";
import { jobHandlers } from "./job-handlers.ts";
import { projectHandlers } from "./project-handlers.ts";
import { reviewHandlers } from "./review-handlers.ts";
import { scenarioHandlers } from "./scenario-handlers.ts";
import { taskHandlers } from "./task-handlers.ts";
import { workHandlers } from "./work-handlers.ts";

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
    ...taskHandlers(),
    ...jobHandlers(),
    ...adminHandlers(),
    ...getParfocalAPIMock(),
  ];
}

export * from "../generated/api.msw.ts";
export { resetAdminActions, toInvitePreview, toSignInOptions } from "./admin-handlers.ts";
export { toClinicalReport, toCosignReview } from "./clinical-handlers.ts";
export { type DraftOperation, draftHandlers, draftOperations } from "./draft-handlers.ts";
export {
  type FakeJobsScene,
  fakeJobsState,
  resetJobsState,
  setFakeJobsScene,
} from "./jobs-scene.ts";
export { projectSlideRows, toProjectOverview, toUploadBatch } from "./project-handlers.ts";
export * as scenario from "./scenario.ts";
export * as scenarioAdmin from "./scenario-admin.ts";
export * as scenarioClinical from "./scenario-clinical.ts";
export { scenarioHandlers, toHome, toMe, toMembers, toProject } from "./scenario-handlers.ts";
export * as scenarioJobs from "./scenario-jobs.ts";
export * as scenarioProject from "./scenario-project.ts";
export * as scenarioReview from "./scenario-review.ts";
export * as scenarioTask from "./scenario-task.ts";
export * as scenarioTeam from "./scenario-team.ts";
export { teamReviewerStatus, toTeamWorkload } from "./team-handlers.ts";
export {
  defaultFakeTeamScene,
  type FakeTeamScene,
  fakeTeamScene,
  resetTeamActions,
  setFakeTeamScene,
} from "./team-scene.ts";
export { defaultFakeView, type FakeView, fakeView, setFakeView } from "./view.ts";
export { searchScenario, tasksAssignedBy, toSlideRow } from "./work-handlers.ts";
