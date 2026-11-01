import { fakeApiHandlers } from "@parfocal/api-client/fake";
import { startFakeWorker } from "@parfocal/api-client/fake/browser";
import type { QueryClient } from "@tanstack/react-query";
import { mountFakeDataBadge } from "./badge.tsx";
import type { FakeScope } from "./badge-state.ts";

export async function startFakeApi(scope: FakeScope, queryClient: QueryClient): Promise<void> {
  await startFakeWorker(fakeApiHandlers(scope));
  mountFakeDataBadge(scope, queryClient);
}
