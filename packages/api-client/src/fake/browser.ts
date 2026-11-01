import type { RequestHandler } from "msw";
import { type SetupWorker, setupWorker } from "msw/browser";

export async function startFakeWorker(handlers: RequestHandler[]): Promise<SetupWorker> {
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledFrame: "bypass", quiet: true });
  return worker;
}
