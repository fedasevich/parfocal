import { type FakeJobsScene, scenarioJobs } from "@parfocal/api-client/fake";

const runModelPath = /^\/projects\/[^/]+\/run-model\/?$/;
const jobPath = /^\/projects\/[^/]+\/jobs\/([^/]+)\/?$/;

export function fakeJobsSceneFor(
  pathname: string,
  search: Record<string, unknown>,
): FakeJobsScene | null {
  if (runModelPath.test(pathname)) {
    return search["scene"] === "started" ? "run-started" : "before-run";
  }
  const job = jobPath.exec(pathname)?.[1];
  if (job === scenarioJobs.startedRunId) return "run-started";
  return null;
}
