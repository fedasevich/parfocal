import { faker } from "@faker-js/faker";
import type { RequestHandler } from "msw";
import { getParfocalAPIMock } from "../generated/api.msw.ts";
import { draftHandlers } from "./draft-handlers.ts";
import { scenarioHandlers } from "./scenario-handlers.ts";
import { workHandlers } from "./work-handlers.ts";

export type FakeApiScope = "all" | "drafts";

export const fakeDataSeed = 4812;

export function fakeApiHandlers(scope: FakeApiScope): RequestHandler[] {
  if (scope === "drafts") return draftHandlers();
  faker.seed(fakeDataSeed);
  return [...draftHandlers(), ...scenarioHandlers(), ...workHandlers(), ...getParfocalAPIMock()];
}

export * from "../generated/api.msw.ts";
export { type DraftOperation, draftHandlers, draftOperations } from "./draft-handlers.ts";
export * as scenario from "./scenario.ts";
export { scenarioHandlers, toHome, toMe, toMembers, toProject } from "./scenario-handlers.ts";
export { defaultFakeView, type FakeView, fakeView, setFakeView } from "./view.ts";
export { searchScenario, tasksAssignedBy, toSlideRow } from "./work-handlers.ts";
