export type AllowedViolation = { rule: string; route: string; todo: string };

export const allowedViolations: readonly AllowedViolation[] = [
  {
    rule: "label-content-name-mismatch",
    route: "/projects/:id/slides/:id",
    todo: "TODO the area rows in the object list name a control by its measurements, not by its visible text",
  },
  {
    rule: "label-content-name-mismatch",
    route: "/tasks/:id/comments",
    todo: "TODO the accessible name of a Base UI control must contain its visible text",
  },
  {
    rule: "label-content-name-mismatch",
    route: "/projects/:id/slides/:id/annotate-task?scene=*",
    todo: "TODO the accessible name of two Base UI controls must contain their visible text",
  },
  {
    rule: "color-contrast",
    route: "/projects/:id/slides/:id/annotate-task?scene=*",
    todo: "TODO the red decision tag in the object list is below 4.5:1",
  },
  {
    rule: "color-contrast",
    route: "/projects/:id/slides/:id/live",
    todo: "TODO the imported result set tag is below 4.5:1",
  },
  {
    rule: "color-contrast",
    route: "/tasks/:id/disagreements",
    todo: "TODO the done row tag in the disagreements table is below 4.5:1",
  },
  {
    rule: "target-size",
    route: "/tasks/:id/disagreements?scene=*",
    todo: "TODO the accent link is smaller than 24 by 24 pixels",
  },
  {
    rule: "target-size",
    route: "/sign-in",
    todo: "TODO the control at the right edge of the sign in card is smaller than 24 by 24 pixels",
  },
];

export function isAllowed(rule: string, route: string): boolean {
  return allowedViolations.some(
    (entry) =>
      entry.rule === rule &&
      (entry.route.endsWith("*")
        ? route.startsWith(entry.route.slice(0, -1))
        : entry.route === route),
  );
}
