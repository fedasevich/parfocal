export const shellRouteIds: ReadonlySet<string> = new Set([
  "/",
  "/my-work",
  "/projects/new",
  "/projects/$projectId/",
  "/projects/$projectId/cases/new",
  "/projects/$projectId/jobs/$jobId",
  "/projects/$projectId/run-model",
  "/projects/$projectId/slides/$slideId_/co-sign",
  "/projects/$projectId/slides/$slideId_/report",
  "/projects/$projectId/tasks/new",
  "/projects/$projectId/upload",
  "/team",
]);

export const foldedShellRouteIds: ReadonlySet<string> = new Set<string>([
  "/projects/$projectId/slides/$slideId_/co-sign",
  "/projects/$projectId/slides/$slideId_/report",
  "/projects/$projectId/tasks/new",
  "/projects/$projectId/upload",
]);
