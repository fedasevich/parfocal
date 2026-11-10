export type AllowedViolation = { rule: string; routes: readonly string[]; todo: string };

export const allowedViolations: readonly AllowedViolation[] = [
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
