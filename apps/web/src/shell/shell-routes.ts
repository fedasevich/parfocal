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
  "/projects/$projectId/slides/$slideId_/report",
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
  "/projects/$projectId/slides/$slideId_/report",
  "/projects/$projectId/tasks/new",
  "/projects/$projectId/upload",
  "/tasks/$taskId/evaluation",
]);

const outsideShellScenes: Readonly<Record<string, ReadonlySet<string>>> = {
  "/tasks/$taskId/disagreements": new Set(["adjudicate", "adjdone"]),
};

export function inGlobalShell(match: { routeId: string; search: unknown }): boolean {
  if (!shellRouteIds.has(match.routeId)) return false;
  const scene = (match.search as { scene?: unknown } | undefined)?.scene;
  return !(typeof scene === "string" && outsideShellScenes[match.routeId]?.has(scene));
}
