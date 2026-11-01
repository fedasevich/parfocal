import {
  fakeApiHandlers,
  scenario,
  setFakeConnectModelScene,
  setFakeJobsScene,
  setFakeTeamScene,
  setFakeView,
} from "@parfocal/api-client/fake";
import { startFakeWorker } from "@parfocal/api-client/fake/browser";
import type { QueryClient } from "@tanstack/react-query";
import { fixClock } from "../clock.ts";
import type { createAppRouter } from "../router.ts";
import { mountFakeDataBadge } from "./badge.tsx";
import type { FakeScope } from "./badge-state.ts";
import { fakeConnectModelSceneFor } from "./connect-model-rules.ts";
import { fakeJobsSceneFor } from "./jobs-scene-rules.ts";
import { fakeTeamSceneFor } from "./team-scene-rules.ts";
import { fakeViewFor } from "./view-rules.ts";

type AppRouter = ReturnType<typeof createAppRouter>;

function applyFakeState(pathname: string, search: Record<string, unknown>): boolean {
  const viewChanged = setFakeView(fakeViewFor(pathname, search));
  const sceneChanged = setFakeTeamScene(fakeTeamSceneFor(pathname, search));
  const jobsChanged = setFakeJobsScene(fakeJobsSceneFor(pathname, search));
  const modelChanged = setFakeConnectModelScene(fakeConnectModelSceneFor(pathname, search));
  return viewChanged || sceneChanged || jobsChanged || modelChanged;
}

export async function startFakeApi(
  scope: FakeScope,
  queryClient: QueryClient,
  router: AppRouter,
): Promise<void> {
  if (scope === "all") fixClock(new Date(scenario.scenarioNow));
  const search = Object.fromEntries(new URLSearchParams(window.location.search));
  applyFakeState(window.location.pathname, search);
  await startFakeWorker(fakeApiHandlers(scope));
  mountFakeDataBadge(scope, queryClient);
  router.subscribe("onBeforeNavigate", ({ toLocation }) => {
    if (applyFakeState(toLocation.pathname, toLocation.search)) {
      void queryClient.resetQueries();
    }
  });
}
