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
    rule: "scrollable-region-focusable",
    todo: "TODO a scrolling region cannot be reached with the keyboard",
    routes: [
      "/admin*",
      "/developer*",
      "/projects/:id/cases/:id/report*",
      "/projects/:id/upload*",
      "/spikes/worklist",
    ],
  },
  {
    rule: "target-size",
    todo: "TODO a control is smaller than 24 by 24 pixels",
    routes: [
      "/my-work",
      "/projects/:id*",
      "/projects/:id/slides/:id*",
      "/projects/:id/slides/:id/annotate*",
      "/projects/:id/slides/:id/live",
      "/settings/shortcuts*",
      "/setup*",
      "/sign-in*",
      "/sign-up",
      "/tasks/:id/cells*",
      "/tasks/:id/disagreements*",
      "/tasks/:id/guided*",
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
