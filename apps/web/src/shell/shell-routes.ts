export const shellRouteIds: ReadonlySet<string> = new Set([
  "/",
  "/my-work",
  "/search",
  "/projects/new",
  "/projects/$projectId/",
  "/projects/$projectId/cases/new",
  "/projects/$projectId/jobs/$jobId",
  "/projects/$projectId/run-model",
  "/projects/$projectId/slides/$slideId_/co-sign",
  "/projects/$projectId/cases/$caseId/report",
  "/projects/$projectId/tasks/new",
  "/projects/$projectId/upload",
  "/team",
  "/settings/$section",
  "/tasks/$taskId/disagreements",
  "/tasks/$taskId/sign-off",
  "/tasks/$taskId/evaluation",
]);

export const foldedShellRouteIds: ReadonlySet<string> = new Set<string>([
  "/projects/$projectId/slides/$slideId_/co-sign",
  "/projects/$projectId/cases/$caseId/report",
  "/projects/$projectId/tasks/new",
  "/projects/$projectId/upload",
  "/tasks/$taskId/evaluation",
]);

export function inGlobalShell(match: { routeId: string }): boolean {
  return shellRouteIds.has(match.routeId);
}
