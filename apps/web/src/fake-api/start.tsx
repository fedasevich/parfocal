import { fakeApiHandlers, scenario, setFakeView } from "@parfocal/api-client/fake";
import { startFakeWorker } from "@parfocal/api-client/fake/browser";
import type { QueryClient } from "@tanstack/react-query";
import { fixClock } from "../clock.ts";
import type { createAppRouter } from "../router.ts";
import { mountFakeDataBadge } from "./badge.tsx";
import type { FakeScope } from "./badge-state.ts";
import { fakeViewFor } from "./view-rules.ts";

type AppRouter = ReturnType<typeof createAppRouter>;

export async function startFakeApi(
  scope: FakeScope,
  queryClient: QueryClient,
  router: AppRouter,
): Promise<void> {
  if (scope === "all") fixClock(new Date(scenario.scenarioNow));
  const search = Object.fromEntries(new URLSearchParams(window.location.search));
  setFakeView(fakeViewFor(window.location.pathname, search));
  await startFakeWorker(fakeApiHandlers(scope));
  mountFakeDataBadge(scope, queryClient);
  router.subscribe("onBeforeNavigate", ({ toLocation }) => {
    if (setFakeView(fakeViewFor(toLocation.pathname, toLocation.search))) {
      void queryClient.resetQueries();
    }
  });
}
