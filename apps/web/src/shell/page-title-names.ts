import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export const routeTitleMessages: Readonly<Record<string, MessageDescriptor>> = {
  "/": msg`Home`,
  "/my-work": msg`My work`,
  "/notifications": msg`Notifications`,
  "/search": msg`Search`,
  "/team": msg`Team`,
  "/admin": msg`Admin`,
  "/developer": msg`Developer`,
  "/kpi": msg`Task timing`,
  "/study": msg`Study`,
  "/sign-in": msg`Sign in`,
  "/settings/$section": msg`Settings`,
  "/projects/$projectId/": msg`Project`,
  "/projects/$projectId/upload": msg`Upload`,
  "/projects/$projectId/run-model": msg`Run a model`,
  "/projects/$projectId/slides/$slideId": msg`Slide`,
  "/tasks/$taskId/evaluation": msg`Evaluation report`,
  "/tasks/$taskId/sign-off": msg`Sign off`,
  "/tasks/$taskId/disagreements": msg`Disagreements`,
  "/tasks/$taskId/adjudicate": msg`Adjudication`,
};
