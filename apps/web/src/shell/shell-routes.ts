export const shellRouteIds: ReadonlySet<string> = new Set([
  "/",
  "/my-work",
  "/projects/$projectId/",
  "/projects/$projectId/tasks/new",
  "/team",
]);

export const foldedShellRouteIds: ReadonlySet<string> = new Set<string>([
  "/projects/$projectId/tasks/new",
]);
