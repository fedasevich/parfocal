import type { RequestHandler } from "msw";
import { type SetupWorker, setupWorker } from "msw/browser";
import { skipUnmatched } from "./skip-unmatched.ts";

export async function startFakeWorker(handlers: RequestHandler[]): Promise<SetupWorker> {
  const worker = setupWorker(...skipUnmatched(handlers));
  await worker.start({ onUnhandledFrame: "bypass", quiet: true });
  return worker;
}
