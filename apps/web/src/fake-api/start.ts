import { fakeApiHandlers } from "@parfocal/api-client/fake";
import { startFakeWorker } from "@parfocal/api-client/fake/browser";
import type { FakeApiMode } from "../config.ts";

export async function startFakeApi(mode: Exclude<FakeApiMode, "off">): Promise<void> {
  await startFakeWorker(mode === "all" ? fakeApiHandlers() : []);
}
