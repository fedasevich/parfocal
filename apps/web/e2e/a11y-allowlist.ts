export type AllowedViolation = { rule: string; routes: readonly string[]; todo: string };

export const allowedViolations: readonly AllowedViolation[] = [
  {
    rule: "color-contrast",
    todo: "TODO text or tags below 4.5:1, mostly the red tag at 16 percent mix and muted table text",
    routes: [
      "/admin*",
      "/my-work",
      "/projects/:id*",
      "/projects/:id/slides/:id*",
      "/projects/:id/slides/:id/annotate-task*",
      "/projects/:id/slides/:id/live",
      "/projects/:id/upload*",
      "/settings/shortcuts*",
      "/setup*",
      "/sign-in*",
      "/tasks/:id/disagreements",
      "/tasks/:id/guided*",
      "/tasks/:id/sign-off",
    ],
  },
  {
    rule: "link-in-text-block",
    todo: "TODO a link inside a sentence needs an underline or 3:1 contrast against the text",
    routes: ["/projects/:id/tasks/new*"],
  },
  {
    rule: "nested-interactive",
    todo: "TODO a row or card holds a control inside another control",
    routes: [
      "/tasks/:id/guided*",
      "/my-work",
      "/projects/:id/upload*",
      "/tasks/:id/disagreements*",
    ],
  },
];

export function isAllowed(rule: string, route: string): boolean {
  return allowedViolations.some(
    (entry) =>
      entry.rule === rule &&
      entry.routes.some((pattern) =>
        pattern.endsWith("*")
          ? route === pattern.slice(0, -1) || route.startsWith(`${pattern.slice(0, -1)}?`)
          : pattern === route,
      ),
  );
}
